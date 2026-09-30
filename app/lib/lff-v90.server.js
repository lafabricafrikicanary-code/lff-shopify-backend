import { createHash } from "node:crypto";
import db from "../db.server";
import { makeCode, recordAudit } from "./lff.server";

export const RETENTION_PERCENT = 20;
export const RETENTION_VALID_DAYS = 5;
export const DEFAULT_RETENTION_WAIT_HOURS = 48;

export function shopDomain() {
  return process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
}

export function asShopifyGid(type, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://shopify/")) return raw;
  const numeric = raw.match(/\d+/)?.[0] || "";
  return numeric ? `gid://shopify/${type}/${numeric}` : raw;
}

export function numericShopifyId(value) {
  const raw = String(value || "");
  return raw.match(/(\d+)(?:\D*)$/)?.[1] || "";
}

export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

export function retentionWaitHours() {
  const configured = Number(process.env.LFF_RETENTION_WAIT_HOURS || DEFAULT_RETENTION_WAIT_HOURS);
  return Number.isFinite(configured) && configured >= 1 ? Math.min(configured, 24 * 30) : DEFAULT_RETENTION_WAIT_HOURS;
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

export function favoriteIdentity(request, body = {}) {
  const customerId = numericShopifyId(body.customerId);
  if (customerId) return { identityKey: `customer:${customerId}`, customerId };
  const email = cleanEmail(body.email || body.customerEmail);
  if (email) return { identityKey: `email:${createHash("sha256").update(email).digest("hex")}`, customerEmail: email };
  const visitorId = cleanText(body.visitorId, 160);
  if (visitorId) return { identityKey: `visitor:${createHash("sha256").update(visitorId).digest("hex")}`, visitorId };
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const ua = request.headers.get("user-agent") || "";
  const fallback = createHash("sha256").update(`${forwarded}|${ua}`).digest("hex");
  return { identityKey: `anon:${fallback}` };
}

export async function upsertFavorite(request, body, shop = shopDomain()) {
  const productGid = asShopifyGid("Product", body.id || body.productId || body.productGid);
  if (!productGid) throw new Error("Falta el producto del favorito.");
  const identity = favoriteIdentity(request, body);
  const now = new Date();
  const action = String(body.action || "added").toLowerCase();
  const data = {
    visitorId: identity.visitorId || cleanText(body.visitorId, 160) || null,
    customerId: identity.customerId || numericShopifyId(body.customerId) || null,
    customerEmail: identity.customerEmail || cleanEmail(body.email || body.customerEmail) || null,
    productHandle: cleanText(body.productHandle || body.handle, 180) || null,
    productTitle: cleanText(body.title || body.productTitle, 220) || null,
    productImage: cleanText(body.image || body.productImage, 1200) || null,
  };

  const existing = await db.favorite.findUnique({
    where: { shop_identityKey_productGid: { shop, identityKey: identity.identityKey, productGid } },
  });

  let favorite;
  if (action === "removed") {
    if (!existing) return { favorite: null, campaign: null, removed: false };
    favorite = await db.favorite.update({
      where: { id: existing.id },
      data: { ...data, status: "removed", removedAt: now },
    });
    await db.retentionCampaign.updateMany({
      where: { favoriteId: favorite.id, status: "waiting" },
      data: { status: "cancelled" },
    });
    await recordAudit(shop, "retention.favorite_removed", { targetType: "favorite", targetId: favorite.id, productGid }).catch(() => {});
    return { favorite, campaign: null, removed: true };
  }

  favorite = existing
    ? await db.favorite.update({
        where: { id: existing.id },
        data: { ...data, status: "active", removedAt: null, lastFavoritedAt: now },
      })
    : await db.favorite.create({
        data: {
          shop,
          identityKey: identity.identityKey,
          productGid,
          ...data,
          status: "active",
          firstFavoritedAt: now,
          lastFavoritedAt: now,
        },
      });

  let campaign = await db.retentionCampaign.findUnique({ where: { favoriteId: favorite.id } });
  const alreadyTerminal = campaign && ["issued", "sent", "redeemed", "purchased", "expired"].includes(campaign.status);
  if (!alreadyTerminal) {
    const eligibleAt = addHours(now, retentionWaitHours());
    campaign = campaign
      ? await db.retentionCampaign.update({
          where: { id: campaign.id },
          data: {
            customerId: data.customerId,
            customerEmail: data.customerEmail,
            status: "waiting",
            eligibleAt,
          },
        })
      : await db.retentionCampaign.create({
          data: {
            shop,
            favoriteId: favorite.id,
            productGid,
            customerId: data.customerId,
            customerEmail: data.customerEmail,
            percent: RETENTION_PERCENT,
            status: "waiting",
            eligibleAt,
          },
        });
  }

  await recordAudit(shop, "retention.favorite_added", {
    targetType: "favorite",
    targetId: favorite.id,
    productGid,
    eligibleAt: campaign?.eligibleAt,
  }).catch(() => {});
  return { favorite, campaign, removed: false };
}

export async function releaseMatureCommissions(shop, commercialId = null) {
  const now = new Date();
  const where = {
    shop,
    status: "pending_validation",
    validationDate: { lte: now },
    ...(commercialId ? { commercialId } : {}),
  };
  const result = await db.commission.updateMany({ where, data: { status: "available" } });
  if (result.count) {
    await recordAudit(shop, "commission.validation_released", {
      targetType: "commission",
      targetId: commercialId || "batch",
      count: result.count,
    }).catch(() => {});
  }
  return result.count;
}

function orderProductGids(payload) {
  return [...new Set((payload.line_items || []).map((line) => asShopifyGid("Product", line.product_id)).filter(Boolean))];
}

export async function markFavoritePurchasesFromOrder(shop, payload) {
  const productGids = orderProductGids(payload);
  if (!productGids.length) return 0;
  const customerId = numericShopifyId(payload.customer?.id || payload.customer?.admin_graphql_api_id);
  const email = cleanEmail(payload.email || payload.customer?.email);
  const identityFilters = [];
  if (customerId) identityFilters.push({ customerId });
  if (email) identityFilters.push({ customerEmail: email });
  if (!identityFilters.length) return 0;
  const favorites = await db.favorite.findMany({
    where: { shop, productGid: { in: productGids }, status: { in: ["active", "removed"] }, OR: identityFilters },
  });
  if (!favorites.length) return 0;
  const now = new Date();
  const orderGid = String(payload.admin_graphql_api_id || payload.id || "");
  await db.$transaction(favorites.map((favorite) => db.favorite.update({
    where: { id: favorite.id },
    data: { status: "purchased", purchasedAt: now, orderGid },
  })));
  await db.retentionCampaign.updateMany({
    where: { favoriteId: { in: favorites.map((f) => f.id) }, status: { in: ["waiting", "issued", "sent"] } },
    data: { status: "purchased", purchasedAt: now },
  });
  await recordAudit(shop, "retention.purchase_detected", {
    targetType: "order",
    targetId: orderGid,
    favorites: favorites.map((f) => f.id),
    productGids,
  }).catch(() => {});
  return favorites.length;
}

async function customerEmailFromShopify(admin, customerId) {
  if (!admin || !customerId) return "";
  const gid = asShopifyGid("Customer", customerId);
  const response = await admin.graphql(
    `#graphql
      query LffRetentionCustomer($id: ID!) {
        customer(id: $id) { id email }
      }`,
    { variables: { id: gid } },
  );
  const json = await response.json();
  return cleanEmail(json.data?.customer?.email);
}

export async function createProductPercentageCode(admin, input) {
  const customerIds = (input.customerIds || []).map((id) => asShopifyGid("Customer", id)).filter(Boolean);
  const productIds = (input.productIds || []).map((id) => asShopifyGid("Product", id)).filter(Boolean);
  if (!productIds.length) throw new Error("El descuento de recuperación necesita un producto.");
  const context = customerIds.length ? { customers: { add: customerIds } } : { all: "ALL" };
  const response = await admin.graphql(
    `#graphql
      mutation LffRetentionDiscount($discount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $discount) {
          codeDiscountNode { id }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        discount: {
          title: input.title,
          code: input.code,
          startsAt: input.startsAt || new Date().toISOString(),
          endsAt: input.endsAt || null,
          usageLimit: input.usageLimit ?? 1,
          appliesOncePerCustomer: true,
          context,
          customerGets: {
            value: { percentage: Number(input.percent) / 100 },
            items: { products: { productsToAdd: productIds } },
          },
          combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
        },
      },
    },
  );
  const json = await response.json();
  const root = json.data?.discountCodeBasicCreate;
  const errors = root?.userErrors || json.errors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  if (!root?.codeDiscountNode?.id) throw new Error("Shopify no confirmó el descuento de recuperación.");
  return root.codeDiscountNode;
}

export async function processDueRetentionCampaigns(admin, shop = shopDomain(), limit = 25) {
  const now = new Date();
  const due = await db.retentionCampaign.findMany({
    where: { shop, status: "waiting", eligibleAt: { lte: now }, favorite: { status: "active", purchasedAt: null } },
    include: { favorite: true },
    orderBy: { eligibleAt: "asc" },
    take: Math.max(1, Math.min(Number(limit) || 25, 100)),
  });
  const results = [];
  for (const campaign of due) {
    try {
      const expiresAt = addDays(now, RETENTION_VALID_DAYS);
      let email = cleanEmail(campaign.customerEmail || campaign.favorite.customerEmail);
      const customerId = campaign.customerId || campaign.favorite.customerId;
      if (!email && customerId) email = await customerEmailFromShopify(admin, customerId).catch(() => "");
      if (!email && !customerId) {
        await db.retentionCampaign.update({ where: { id: campaign.id }, data: { status: "waiting_contact" } });
        await recordAudit(shop, "retention.awaiting_contact", {
          targetType: "retention_campaign",
          targetId: campaign.id,
          productGid: campaign.productGid,
        }).catch(() => {});
        results.push({ id: campaign.id, ok: true, skipped: true, reason: "no_reachable_customer" });
        continue;
      }
      const code = makeCode("LFF20FAV", campaign.favorite.productTitle || numericShopifyId(campaign.productGid) || "PRODUCTO");
      const discount = await createProductPercentageCode(admin, {
        title: `LFF Recuperacion favorito 20% - ${campaign.favorite.productTitle || numericShopifyId(campaign.productGid)}`,
        code,
        percent: RETENTION_PERCENT,
        productIds: [campaign.productGid],
        customerIds: customerId ? [customerId] : [],
        endsAt: expiresAt.toISOString(),
        usageLimit: 1,
      });
      const updated = await db.retentionCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "issued",
          code,
          shopifyDiscountId: discount.id,
          customerEmail: email || null,
          issuedAt: now,
          expiresAt,
        },
      });
      if (email) {
        await db.outboundMessage.create({
          data: {
            shop,
            channel: "email",
            recipient: email,
            template: "favorite_recovery_20",
            relatedType: "retention_campaign",
            relatedId: campaign.id,
            status: "pending_provider",
            payloadJson: JSON.stringify({ code, percent: RETENTION_PERCENT, expiresAt, productGid: campaign.productGid, productTitle: campaign.favorite.productTitle }),
          },
        });
      }
      await recordAudit(shop, "retention.discount_issued", {
        targetType: "retention_campaign",
        targetId: campaign.id,
        code,
        productGid: campaign.productGid,
        expiresAt,
        deliveryPrepared: Boolean(email),
      }).catch(() => {});
      results.push({ id: updated.id, ok: true, code, emailPrepared: Boolean(email) });
    } catch (error) {
      results.push({ id: campaign.id, ok: false, error: error.message });
    }
  }
  await db.retentionCampaign.updateMany({
    where: { shop, status: { in: ["issued", "sent"] }, expiresAt: { lt: now } },
    data: { status: "expired" },
  });
  return results;
}

export function classifyTrafficSource(body = {}) {
  const explicit = String(body.source || "").trim().toLowerCase();
  if (["commercials", "web", "companies", "marketing"].includes(explicit)) return explicit;
  if (body.commercialCode) return "commercials";
  if (body.companyId || /b2b|empresa|tienda/i.test(String(body.medium || ""))) return "companies";
  if (body.campaign || /utm|ads|meta|google|instagram|tiktok|newsletter|email/i.test(`${body.medium || ""} ${body.referrer || ""}`)) return "marketing";
  return "web";
}
