// LFF V186 — one-use, variant-scoped, short-lived cross-sell discounts.
// Staged separately from v73-postgres: deploy only after checkout testing.
import { randomBytes } from "node:crypto";
import { authenticate } from "../shopify.server";

const GIFT_PRODUCT_ID = "gid://shopify/Product/16137290481994";
const ONLINE_STORE_PUBLICATION_ID = "gid://shopify/Publication/372216987978";
const SHOP = "lafabricafriki.myshopify.com";
const recentRequests = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_PER_IP = 4;
const MAX_PER_SHOP = 100;
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

const eligibleVariantsQuery = "#graphql query LffEligibleOfferVariants($ids:[ID!]!,$pub:ID!){nodes(ids:$ids){...on ProductVariant{id availableForSale price product{id status title productType tags publishedOnPublication(publicationId:$pub)}}}}";
const issueDiscountMutation = "#graphql mutation LffIssueOffer($input:DiscountCodeBasicInput!){discountCodeBasicCreate(basicCodeDiscount:$input){codeDiscountNode{id} userErrors{field code message}}}";

function failure(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status, headers: HEADERS });
}
function getIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim().slice(0, 80) || "unknown";
}
function throttle(request, shop) {
  const now = Date.now();
  for (const [key, values] of recentRequests) {
    const fresh = values.filter(value => now - value < WINDOW);
    if (fresh.length) recentRequests.set(key, fresh);
    else recentRequests.delete(key);
  }
  const keys = ["ip:" + shop + ":" + getIp(request), "shop:" + shop];
  const limits = [MAX_PER_IP, MAX_PER_SHOP];
  if (keys.some((key, i) => (recentRequests.get(key) || []).length >= limits[i])) return false;
  keys.forEach(key => recentRequests.set(key, [...(recentRequests.get(key) || []), now]));
  return true;
}
function normalizedIds(body) {
  if (!Array.isArray(body?.variantIds) || body.variantIds.length < 1 || body.variantIds.length > 4) return null;
  const vals = body.variantIds.map(value => String(value || "").trim());
  if (!vals.every(v => /^\d{7,20}$/.test(v)) || new Set(vals).size !== vals.length) return null;
  const originals = Array.isArray(body?.originalVariantIds) ? body.originalVariantIds.map(String) : [];
  if (vals.some(v => originals.includes(v))) return null;
  return vals;
}
function excludedProduct(product) {
  if (!product || product.id === GIFT_PRODUCT_ID || product.status !== "ACTIVE") return true;
  const tags = Array.isArray(product.tags) ? product.tags.map(t => String(t).toLowerCase()) : [];
  const combined = [product.title, product.productType, ...tags].join(" ").toLowerCase();
  return /preparaci[oó]n para regalo|lff-regalo-cajita|lff[_-]hidden|lff[_-]oculto|hentai|k-pop|kpop|\blibros\b/.test(combined);
}

export const action = async ({ request }) => {
  if (request.method !== "POST") return failure("Método no permitido.", 405);
  // Shopify verifies the app-proxy signature; never fall back to untrusted shop parameters.
  let ctx;
  try { ctx = await authenticate.public.appProxy(request); }
  catch { return failure("Solicitud no autorizada.", 401); }
  const { admin, session } = ctx || {};
  if (!admin || !session || session.shop !== SHOP) return failure("Tienda no autorizada.", 403);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return failure("Formato no admitido.", 415);
  let body;
  try { body = await request.json(); }
  catch { return failure("Solicitud inválida."); }
  const variants = normalizedIds(body);
  if (!variants) return failure("Selecciona de uno a cuatro artículos nuevos.");
  if (!throttle(request, session.shop)) return failure("Demasiados intentos de oferta. Continúa al pago o vuelve más tarde.", 429);

  try {
    const ids = variants.map(id => "gid://shopify/ProductVariant/" + id);
    const checked = await admin.graphql(eligibleVariantsQuery, {
      variables: { ids, pub: ONLINE_STORE_PUBLICATION_ID }
    });
    const check = await checked.json();
    if (check.errors?.length) throw new Error("Error al verificar las variantes.");
    const rows = check.data?.nodes || [];
    if (rows.length !== ids.length || rows.some((v, i) =>
      !v || v.id !== ids[i] || !v.availableForSale || Number(v.price) <= 0 ||
      !v.product?.publishedOnPublication || excludedProduct(v.product)
    )) return failure("Una recomendación ya no está disponible para esta oferta.", 409);

    const code = "LFF-EXTRA15-" + randomBytes(9).toString("hex").toUpperCase();
    const now = Date.now();
    const input = {
      code,
      title: "LFF V186 · Extra 15 % · Artículos recomendados",
      startsAt: new Date(now - 15000).toISOString(),
      endsAt: new Date(now + 45 * 60 * 1000).toISOString(),
      usageLimit: 1,
      appliesOncePerCustomer: false,
      combinesWith: { orderDiscounts: true, shippingDiscounts: true, productDiscounts: false },
      customerGets: {
        value: { percentage: 0.15 },
        items: { products: { productVariantsToAdd: ids } }
      }
    };
    const result = await admin.graphql(issueDiscountMutation, { variables: { input } });
    const json = await result.json();
    const errors = json.data?.discountCodeBasicCreate?.userErrors || [];
    if (json.errors?.length || errors.length || !json.data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
      console.error("[LFF V186 cross-sell] Shopify rejected discount", json.errors?.map(e => e.message), errors);
      return failure("Shopify no ha podido activar el 15 %. Puedes continuar sin él.", 503);
    }
    return Response.json({ ok: true, code, percent: 15, expiresInSeconds: 2700, variantIds: variants }, { headers: HEADERS });
  } catch (error) {
    console.error("[LFF V186 cross-sell]", error?.message || String(error));
    return failure("No se pudo verificar el descuento. Puedes continuar al pago sin él.", 503);
  }
};
