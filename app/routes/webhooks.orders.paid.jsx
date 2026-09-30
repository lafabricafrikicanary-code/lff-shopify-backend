import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  centsFromShopifyAmount,
  processWebhookOnce,
  recordAudit,
} from "../lib/lff.server";
import {
  classifyTrafficSource,
  cleanEmail,
  markFavoritePurchasesFromOrder,
  numericShopifyId,
} from "../lib/lff-v90.server";

function orderCodes(payload) {
  return (payload.discount_codes || [])
    .map((discount) => String(discount.code || "").toUpperCase())
    .filter(Boolean);
}

function orderTags(payload) {
  if (Array.isArray(payload.tags)) return payload.tags.map((x) => String(x || "").trim()).filter(Boolean);
  return String(payload.tags || "").split(",").map((x) => x.trim()).filter(Boolean);
}

function validationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 15);
  return date;
}

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  await processWebhookOnce({
    id: webhookId,
    shop,
    topic,
    payload,
    handler: async () => {
      const codes = orderCodes(payload);
      const orderGid = String(payload.admin_graphql_api_id || payload.id);
      const customerGid = payload.customer?.admin_graphql_api_id || (payload.customer?.id ? `gid://shopify/Customer/${payload.customer.id}` : null);
      const customerNumericId = numericShopifyId(customerGid);
      const customerEmail = cleanEmail(payload.email || payload.customer?.email) || null;

      // Arcade: un código asignado que aparece en un pedido pagado queda canjeado definitivamente.
      const arcadeCodes = await db.arcadeDiscountCode.findMany({
        where: { shop, code: { in: codes }, status: "assigned" },
        select: { id: true, code: true },
      });
      for (const arcadeCode of arcadeCodes) {
        await db.$transaction([
          db.arcadeDiscountCode.update({ where: { id: arcadeCode.id }, data: { status: "redeemed" } }),
          db.arcadeRedemption.updateMany({ where: { shop, code: arcadeCode.code, status: "issued" }, data: { status: "redeemed", redeemedAt: new Date() } }),
          db.discountIssuance.updateMany({ where: { shop, code: arcadeCode.code }, data: { status: "redeemed" } }),
        ]);
        await recordAudit(shop, "arcade.code_redeemed", { targetType: "arcade_code", targetId: arcadeCode.id, code: arcadeCode.code, orderGid });
      }

      // Recuperación de favoritos: el código de recuperación usado queda marcado como canjeado.
      if (codes.length) {
        await db.retentionCampaign.updateMany({
          where: { shop, code: { in: codes }, status: { in: ["issued", "sent"] } },
          data: { status: "redeemed", redeemedAt: new Date() },
        });
        await db.boxVoucher.updateMany({
          where: { shop, code: { in: codes }, status: "available" },
          data: { status: "redeemed", redeemedAt: new Date() },
        });
      }

      // Si el producto estaba en favoritos de este cliente y ahora aparece pagado, cancelar recuperación.
      await markFavoritePurchasesFromOrder(shop, payload);

      // Vincular cuenta cliente LFF con el customer de Shopify cuando sea posible.
      if (customerEmail && customerGid) {
        await db.customerAccount.updateMany({
          where: { shop, email: customerEmail, shopifyCustomerId: null },
          data: { shopifyCustomerId: customerGid },
        }).catch(() => {});
      }

      // B2B: persistir la actividad/pedido profesional real y marcar la promoción inicial como utilizada.
      const b2bCompany = customerGid
        ? await db.b2BCompany.findFirst({ where: { shop, status: "active", shopifyCustomerId: customerGid } })
        : customerEmail
          ? await db.b2BCompany.findFirst({ where: { shop, status: "active", contactEmail: { equals: customerEmail, mode: "insensitive" } } })
          : null;
      if (b2bCompany) {
        await db.b2BCompany.update({ where: { id: b2bCompany.id }, data: { firstOrderUsed: true, shopifyCustomerId: b2bCompany.shopifyCustomerId || customerGid || null } }).catch(() => {});
        const subtotalCents = centsFromShopifyAmount(payload.current_subtotal_price || payload.subtotal_price);
        const totalCents = centsFromShopifyAmount(payload.current_total_price || payload.total_price);
        await db.b2BOrder.upsert({
          where: { shop_orderGid_companyId: { shop, orderGid, companyId: b2bCompany.id } },
          update: {
            commercialId: b2bCompany.commercialId || null,
            orderName: payload.name || String(payload.order_number || ""),
            subtotalCents,
            totalCents,
            currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null,
            status: "paid",
            paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date(),
            cancelledAt: null,
          },
          create: {
            shop,
            companyId: b2bCompany.id,
            commercialId: b2bCompany.commercialId || null,
            orderGid,
            orderName: payload.name || String(payload.order_number || ""),
            subtotalCents,
            totalCents,
            currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null,
            status: "paid",
            paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date(),
          },
        });
        const quickTag = orderTags(payload).find((tag) => tag.startsWith("LFF_B2BQ_"));
        const quickId = quickTag ? quickTag.slice("LFF_B2BQ_".length) : "";
        if (quickId) {
          await db.b2BQuickOrder.updateMany({
            where: { id: quickId, shop, companyId: b2bCompany.id },
            data: {
              status: "paid",
              orderGid,
              orderName: payload.name || String(payload.order_number || ""),
              professionalTotalCents: totalCents,
              currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null,
              paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date(),
              errorMessage: null,
            },
          }).catch(() => {});
        }
      }

      // Códigos de comerciales/creadores. El último código válido usado cambia la atribución del cliente.
      const codeOwners = codes.length
        ? await db.commercialUser.findMany({ where: { shop, status: "active", captureCode: { in: codes } } })
        : [];
      const codeOwnerByCode = new Map(codeOwners.map((row) => [String(row.captureCode || "").toUpperCase(), row]));
      const codeOwner = [...codes].reverse().map((code) => codeOwnerByCode.get(code)).find(Boolean) || null;
      const personalOwners = codes.length
        ? await db.commercialUser.findMany({ where: { shop, personalCode: { in: codes } } })
        : [];
      const personalOwnerByCode = new Map(personalOwners.map((row) => [String(row.personalCode || "").toUpperCase(), row]));
      const personalOwner = [...codes].reverse().map((code) => personalOwnerByCode.get(code)).find(Boolean) || null;

      const orderName = payload.name || String(payload.order_number || "");
      const orderBasisCents = centsFromShopifyAmount(payload.current_subtotal_price || payload.subtotal_price);
      const orderTotalCents = centsFromShopifyAmount(payload.current_total_price || payload.total_price);

      // Compras propias del comercial: se registran para el panel, pero el código propio no atribuye comisión.
      if (personalOwner) {
        await db.commercialOwnPurchase.upsert({
          where: { shop_orderGid_commercialId: { shop, orderGid, commercialId: personalOwner.id } },
          update: { orderName, totalCents: orderTotalCents, currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null, code: personalOwner.personalCode, paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date() },
          create: { shop, commercialId: personalOwner.id, orderGid, orderName, totalCents: orderTotalCents, currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null, code: personalOwner.personalCode, paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date() },
        }).catch(() => {});
      }

      // Fuente de tráfico/venta propia, sin depender de Shopify Analytics.
      const source = classifyTrafficSource({
        commercialCode: codeOwner?.captureCode || "",
        referrer: payload.referring_site || "",
        medium: payload.source_name || "",
      });
      await db.trafficEvent.create({
        data: {
          shop,
          customerId: customerNumericId || null,
          event: "order_paid",
          source,
          sourceDetail: String(payload.source_name || "").slice(0, 180) || null,
          commercialCode: codeOwner?.captureCode || null,
          companyId: b2bCompany?.id || null,
          path: String(payload.landing_site || "").slice(0, 500) || null,
          referrer: String(payload.referring_site || "").slice(0, 1000) || null,
          metadataJson: JSON.stringify({ orderGid, orderName: payload.name, codes }).slice(0, 12000),
        },
      }).catch(() => {});

      const existingAttribution = customerGid
        ? await db.commercialCustomerAttribution.findUnique({ where: { shop_customerGid: { shop, customerGid } } })
        : customerEmail
          ? await db.commercialCustomerAttribution.findFirst({ where: { shop, customerEmail }, orderBy: { updatedAt: "desc" } })
          : null;
      const customerAlreadyConverted = Boolean(existingAttribution?.firstOrderAt);

      let referrer = existingAttribution
        ? await db.commercialUser.findFirst({ where: { id: existingAttribution.commercialId, shop, status: "active" } })
        : null;

      // Último código válido = referente actual. Si no hay código nuevo, se conserva la última atribución.
      if (codeOwner) {
        referrer = codeOwner;
        if (existingAttribution) {
          await db.commercialCustomerAttribution.update({
            where: { id: existingAttribution.id },
            data: {
              commercialId: codeOwner.id,
              customerGid: existingAttribution.customerGid || customerGid,
              customerEmail: customerEmail || existingAttribution.customerEmail,
              sourceCode: codeOwner.captureCode,
              firstOrderAt: existingAttribution.firstOrderAt || new Date(),
              orderGid,
              status: "active",
            },
          });
        } else if (customerGid || customerEmail) {
          await db.commercialCustomerAttribution.create({
            data: { shop, commercialId: codeOwner.id, customerGid, customerEmail, orderGid, sourceCode: codeOwner.captureCode, firstOrderAt: new Date(), status: "active" },
          });
        }
      } else if (existingAttribution && !existingAttribution.firstOrderAt) {
        await db.commercialCustomerAttribution.update({ where: { id: existingAttribution.id }, data: { firstOrderAt: new Date(), orderGid } }).catch(() => {});
      }

      // Detectar productos propios de YouTubers por la familia vinculada.
      const lines = Array.isArray(payload.line_items) ? payload.line_items : [];
      const productGids = [...new Set(lines.map((line) => line.product_id ? `gid://shopify/Product/${line.product_id}` : null).filter(Boolean))];
      const creatorLinks = productGids.length
        ? await db.creatorProduct.findMany({ where: { shop, productGid: { in: productGids } }, include: { creator: true } })
        : [];
      const creatorByProduct = new Map(creatorLinks.map((link) => [link.productGid, link.creator]));
      const ownBasisByCreator = new Map();

      for (const line of lines) {
        const productGid = line.product_id ? `gid://shopify/Product/${line.product_id}` : null;
        const creator = productGid ? creatorByProduct.get(productGid) : null;
        if (!creator || creator.kind !== "creator" || creator.status !== "active") continue;
        const quantity = Math.max(0, Number(line.current_quantity ?? line.quantity ?? 0) || 0);
        let lineBasis = centsFromShopifyAmount(line.price) * quantity;
        const discounts = Array.isArray(line.discount_allocations) ? line.discount_allocations : [];
        lineBasis -= discounts.reduce((sum, d) => sum + centsFromShopifyAmount(d?.amount), 0);
        lineBasis = Math.max(0, lineBasis);
        ownBasisByCreator.set(creator.id, (ownBasisByCreator.get(creator.id) || 0) + lineBasis);
      }

      // Acumular una sola comisión por persona/pedido; una comisión de creador puede mezclar 30% propio + 10% referido.
      const parts = new Map();
      const addPart = (person, type, basisCents, rateBps) => {
        if (!person || basisCents <= 0 || rateBps <= 0) return;
        const amountCents = Math.round((basisCents * rateBps) / 10000);
        const entry = parts.get(person.id) || { person, basisCents: 0, amountCents: 0, items: [] };
        entry.basisCents += basisCents;
        entry.amountCents += amountCents;
        entry.items.push({ type, basisCents, rateBps, amountCents });
        parts.set(person.id, entry);
      };

      for (const [creatorId, basisCents] of ownBasisByCreator.entries()) {
        const creator = creatorLinks.find((link) => link.creatorId === creatorId)?.creator;
        addPart(creator, "creator_own_brand", basisCents, Number(creator?.ownProductRateBps || 3000));
      }

      if (referrer?.kind === "creator") {
        const ownBasis = ownBasisByCreator.get(referrer.id) || 0;
        const referralBasis = Math.max(0, orderBasisCents - ownBasis);
        addPart(referrer, "creator_referral", referralBasis, Number(referrer.referralRateBps || 1000));
      } else if (referrer) {
        const rateBps = customerAlreadyConverted ? Number(referrer.referralRateBps || 1000) : Number(referrer.firstSaleRateBps || 3000);
        addPart(referrer, customerAlreadyConverted ? "commercial_referral" : "commercial_first_sale", orderBasisCents, rateBps);
      }

      if (!parts.size) {
        await recordAudit(shop, "order.paid_without_commission", { targetType: "order", targetId: orderGid, codes, creatorProducts: creatorLinks.length });
        return;
      }

      for (const entry of parts.values()) {
        const only = entry.items.length === 1 ? entry.items[0] : null;
        const commissionType = only?.type || "creator_mixed";
        const rateBps = only?.rateBps || 0;
        await db.commission.upsert({
          where: { shop_orderGid_commercialId: { shop, orderGid, commercialId: entry.person.id } },
          update: { basisCents: entry.basisCents, rateBps, amountCents: entry.amountCents, commissionType, detailsJson: JSON.stringify(entry.items), status: "pending_validation", validationDate: validationDate() },
          create: { shop, commercialId: entry.person.id, orderGid, orderName, basisCents: entry.basisCents, rateBps, amountCents: entry.amountCents, commissionType, detailsJson: JSON.stringify(entry.items), validationDate: validationDate() },
        });
        await recordAudit(shop, "commission.created_from_order", {
          targetType: "order",
          targetId: orderGid,
          commercialId: entry.person.id,
          kind: entry.person.kind || "commercial",
          source: codeOwner?.id === entry.person.id ? "capture_code" : ownBasisByCreator.has(entry.person.id) ? "creator_own_brand" : "existing_attribution",
          code: codeOwner?.id === entry.person.id ? codeOwner.captureCode : existingAttribution?.sourceCode || null,
          basisCents: entry.basisCents,
          amountCents: entry.amountCents,
          parts: entry.items,
        });
      }
    },
  });

  return new Response();
};
