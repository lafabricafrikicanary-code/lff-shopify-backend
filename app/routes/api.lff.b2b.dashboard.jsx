import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { requireB2BSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";
import { cleanText, shopDomain } from "../lib/lff-v90.server";

function publicThread(thread) {
  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    messages: (thread.messages || []).map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })),
  };
}

function publicQuickOrder(row) {
  let items = [];
  try { items = JSON.parse(row.itemsJson || "[]"); } catch (_) {}
  return {
    id: row.id,
    draftOrderGid: row.draftOrderGid,
    draftOrderName: row.draftOrderName,
    orderGid: row.orderGid,
    orderName: row.orderName,
    status: row.status,
    discountPercent: row.discountPercent,
    originalSubtotalCents: row.originalSubtotalCents,
    professionalTotalCents: row.professionalTotalCents,
    currency: row.currency || "EUR",
    invoiceUrl: row.invoiceUrl,
    errorMessage: row.errorMessage,
    items,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paidAt: row.paidAt,
  };
}

async function threadsFor(company) {
  return db.chatThread.findMany({
    where: { shop: company.shop, ownerType: "b2b", ownerId: company.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
}

async function adminClient() {
  const { admin } = await unauthenticated.admin(shopDomain());
  if (!admin) throw new Error("No hay sesión offline de Shopify disponible para esta tienda.");
  return admin;
}

function gqlPayloadError(payload, key) {
  const top = payload?.errors?.map((x) => x.message).filter(Boolean) || [];
  const user = payload?.data?.[key]?.userErrors?.map((x) => x.message).filter(Boolean) || [];
  const errors = [...top, ...user];
  if (errors.length) throw new Error(errors.join(" · "));
  return payload?.data?.[key];
}

function cents(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function discountPercentFor(company) {
  if (String(company.priceTier || "").startsWith("referred")) return company.firstOrderUsed ? 55 : 63;
  return 60;
}

async function searchCatalog(admin, rawQuery = "") {
  const q = cleanText(rawQuery, 100).replace(/[():'"\\]/g, " ").replace(/\s+/g, " ").trim();
  const query = q ? `status:active ${q}` : "status:active";
  const response = await admin.graphql(
    `#graphql
      query LffB2BCatalog($query: String!) {
        products(first: 40, query: $query, sortKey: TITLE) {
          nodes {
            id
            title
            handle
            status
            featuredMedia { preview { image { url altText } } }
          }
        }
      }`,
    { variables: { query } },
  );
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error(payload.errors.map((x) => x.message).join(" · "));
  return (payload?.data?.products?.nodes || []).map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    image: p.featuredMedia?.preview?.image?.url || "",
    imageAlt: p.featuredMedia?.preview?.image?.altText || p.title,
  }));
}

async function productVariants(admin, productId) {
  const id = String(productId || "");
  if (!id.startsWith("gid://shopify/Product/")) throw new Error("Producto no válido.");
  let after = null;
  let product = null;
  const variants = [];
  for (let page = 0; page < 6; page += 1) {
    const response = await admin.graphql(
      `#graphql
        query LffB2BVariants($id: ID!, $after: String) {
          product(id: $id) {
            id title handle
            featuredMedia { preview { image { url altText } } }
            variants(first: 250, after: $after) {
              nodes {
                id title sku price availableForSale inventoryQuantity
                selectedOptions { name value }
                image { url altText }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
      { variables: { id, after } },
    );
    const payload = await response.json();
    if (payload?.errors?.length) throw new Error(payload.errors.map((x) => x.message).join(" · "));
    const p = payload?.data?.product;
    if (!p) throw new Error("No se encontró el producto.");
    if (!product) product = { id: p.id, title: p.title, handle: p.handle, image: p.featuredMedia?.preview?.image?.url || "" };
    variants.push(...(p.variants?.nodes || []).map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || "",
      price: Number(v.price || 0),
      priceCents: cents(v.price),
      available: Boolean(v.availableForSale),
      inventoryQuantity: Number(v.inventoryQuantity || 0),
      selectedOptions: v.selectedOptions || [],
      image: v.image?.url || "",
      imageAlt: v.image?.altText || "",
    })));
    if (!p.variants?.pageInfo?.hasNextPage) break;
    after = p.variants.pageInfo.endCursor;
  }
  return { product, variants };
}

async function resolveOrderVariants(admin, lines) {
  const ids = lines.map((x) => x.variantId);
  const response = await admin.graphql(
    `#graphql
      query LffB2BResolveVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id title sku price availableForSale inventoryQuantity
            selectedOptions { name value }
            product { id title handle status }
          }
        }
      }`,
    { variables: { ids } },
  );
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error(payload.errors.map((x) => x.message).join(" · "));
  const nodes = (payload?.data?.nodes || []).filter(Boolean);
  const byId = new Map(nodes.map((x) => [x.id, x]));
  return lines.map((line) => {
    const v = byId.get(line.variantId);
    if (!v || v.product?.status !== "ACTIVE") throw new Error("Uno de los artículos ya no está disponible.");
    if (!v.availableForSale) throw new Error(`${v.product?.title || "Un artículo"} · ${v.title} no está disponible ahora mismo.`);
    const priceCents = cents(v.price);
    return {
      variantId: v.id,
      quantity: line.quantity,
      productId: v.product?.id,
      productTitle: v.product?.title || "Producto",
      productHandle: v.product?.handle || "",
      variantTitle: v.title,
      sku: v.sku || "",
      priceCents,
      selectedOptions: v.selectedOptions || [],
    };
  });
}

async function createQuickOrder(company, rawLines) {
  if (!Array.isArray(rawLines)) throw new Error("El pedido no contiene artículos.");
  const merged = new Map();
  for (const raw of rawLines) {
    const variantId = String(raw?.variantId || "");
    const quantity = Math.max(0, Math.min(500, Math.floor(Number(raw?.quantity || 0))));
    if (!variantId.startsWith("gid://shopify/ProductVariant/") || !quantity) continue;
    merged.set(variantId, Math.min(500, (merged.get(variantId) || 0) + quantity));
  }
  const lines = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
  if (!lines.length) throw new Error("Añade al menos una variante al pedido.");
  if (lines.length > 200) throw new Error("El pedido rápido admite hasta 200 variantes distintas por pedido.");
  const totalUnits = lines.reduce((sum, x) => sum + x.quantity, 0);
  if (totalUnits > 2500) throw new Error("El pedido supera el máximo de 2.500 unidades. Divide el pedido en dos.");

  const admin = await adminClient();
  const resolved = await resolveOrderVariants(admin, lines);
  const originalSubtotalCents = resolved.reduce((sum, x) => sum + (x.priceCents * x.quantity), 0);
  const discountPercent = discountPercentFor(company);
  const expectedProfessionalCents = Math.round(originalSubtotalCents * (100 - discountPercent) / 100);
  if (expectedProfessionalCents < 10000) {
    const missing = ((10000 - expectedProfessionalCents) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
    throw new Error(`El pedido profesional mínimo es de 100 €. Faltan ${missing}.`);
  }

  const quick = await db.b2BQuickOrder.create({
    data: {
      shop: company.shop,
      companyId: company.id,
      commercialId: company.commercialId || null,
      status: "creating",
      discountPercent,
      originalSubtotalCents,
      professionalTotalCents: expectedProfessionalCents,
      currency: "EUR",
      itemsJson: JSON.stringify(resolved),
    },
  });

  try {
    const input = {
      email: company.contactEmail || undefined,
      phone: company.phone || undefined,
      note: `Pedido rápido profesional · ${company.companyName}`,
      tags: ["LFF_B2B", `LFF_B2BQ_${quick.id}`, `LFF_COMPANY_${company.id}`],
      customAttributes: [
        { key: "LFF B2B company", value: company.id },
        { key: "LFF B2B tier", value: company.priceTier || "direct_60" },
        { key: "LFF B2B quick order", value: quick.id },
      ],
      acceptAutomaticDiscounts: false,
      allowDiscountCodesInCheckout: false,
      lineItems: resolved.map((x) => ({ variantId: x.variantId, quantity: x.quantity })),
      appliedDiscount: {
        title: `Precio profesional LFF · -${discountPercent}%`,
        description: company.firstOrderUsed || !String(company.priceTier || "").startsWith("referred") ? "Tarifa profesional" : "Primera compra profesional referida",
        value: discountPercent,
        valueType: "PERCENTAGE",
      },
      ...(company.shopifyCustomerId ? { purchasingEntity: { customerId: company.shopifyCustomerId }, useCustomerDefaultAddress: true } : {}),
    };
    const response = await admin.graphql(
      `#graphql
        mutation LffB2BQuickOrder($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id name status invoiceUrl
              totalPriceSet { shopMoney { amount currencyCode } }
              subtotalPriceSet { shopMoney { amount currencyCode } }
            }
            userErrors { field message }
          }
        }`,
      { variables: { input } },
    );
    const payload = await response.json();
    const result = gqlPayloadError(payload, "draftOrderCreate");
    const draft = result?.draftOrder;
    if (!draft?.id || !draft?.invoiceUrl) throw new Error("Shopify no devolvió un enlace de pago para el pedido.");
    const professionalTotalCents = cents(draft.totalPriceSet?.shopMoney?.amount || expectedProfessionalCents / 100);
    const currency = draft.totalPriceSet?.shopMoney?.currencyCode || "EUR";
    const updated = await db.b2BQuickOrder.update({
      where: { id: quick.id },
      data: {
        draftOrderGid: draft.id,
        draftOrderName: draft.name || null,
        status: "open",
        professionalTotalCents,
        currency,
        invoiceUrl: draft.invoiceUrl,
        errorMessage: null,
      },
    });
    await recordAudit(company.shop, "b2b.quick_order_created", { actor: company.contactEmail, targetType: "b2b_quick_order", targetId: quick.id, draftOrderGid: draft.id, units: totalUnits, discountPercent, totalCents: professionalTotalCents }).catch(() => {});
    return publicQuickOrder(updated);
  } catch (error) {
    await db.b2BQuickOrder.update({ where: { id: quick.id }, data: { status: "failed", errorMessage: cleanText(error.message, 1000) } }).catch(() => {});
    throw error;
  }
}

async function dashboardData(company) {
  const [threads, orders, quickOrders] = await Promise.all([
    threadsFor(company),
    db.b2BOrder.findMany({ where: { shop: company.shop, companyId: company.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.b2BQuickOrder.findMany({ where: { shop: company.shop, companyId: company.id }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const commercial = company.commercialId ? await db.commercialUser.findUnique({ where: { id: company.commercialId }, select: { id: true, name: true, status: true } }) : null;
  const discountPercent = discountPercentFor(company);
  return {
    ok: true,
    company: {
      id: company.id,
      companyName: company.companyName,
      contactName: company.contactName,
      contactEmail: company.contactEmail,
      status: company.status,
      priceTier: company.priceTier,
      firstOrderPromo: discountPercent === 63,
      discountPercent,
      minimumOrderCents: 10000,
      commercial,
    },
    orders: orders.map((o) => ({ id: o.id, orderName: o.orderName, subtotalCents: o.subtotalCents, totalCents: o.totalCents, refundedCents: o.refundedCents, currency: o.currency, status: o.status, paidAt: o.paidAt, createdAt: o.createdAt })),
    quickOrders: quickOrders.map(publicQuickOrder),
    threads: threads.map(publicThread),
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { company } = await requireB2BSession(request);
    return json(request, await dashboardData(company));
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: 401 });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { company } = await requireB2BSession(request);
    const body = await bodyData(request);
    const intent = String(body.intent || "send-message");

    if (intent === "send-message") {
      const message = cleanText(body.message, 3000);
      if (!message) throw new Error("Escribe un mensaje.");
      let thread = body.threadId ? await db.chatThread.findFirst({ where: { id: String(body.threadId), shop: company.shop, ownerType: "b2b", ownerId: company.id } }) : null;
      if (!thread) thread = await db.chatThread.create({ data: { shop: company.shop, subject: `Soporte · ${company.companyName}`, channel: "b2b", ownerType: "b2b", ownerId: company.id, status: "open" } });
      const created = await db.chatMessage.create({ data: { threadId: thread.id, author: company.companyName, body: message } });
      await db.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      await recordAudit(company.shop, "b2b.chat_message", { actor: company.contactEmail, targetType: "chat_thread", targetId: thread.id, messageId: created.id }).catch(() => {});
      const threads = await threadsFor(company);
      return json(request, { ok: true, threads: threads.map(publicThread) });
    }

    if (intent === "catalog-search") {
      const admin = await adminClient();
      return json(request, { ok: true, products: await searchCatalog(admin, body.query || "") });
    }

    if (intent === "product-variants") {
      const admin = await adminClient();
      return json(request, { ok: true, ...(await productVariants(admin, body.productId)) });
    }

    if (intent === "quick-order-create") {
      const quickOrder = await createQuickOrder(company, body.lines || []);
      const data = await dashboardData(company);
      return json(request, { ...data, quickOrder });
    }

    throw new Error("Acción B2B no reconocida.");
  } catch (error) {
    const status = /sesión|caducad/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
