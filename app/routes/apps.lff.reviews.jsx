import db from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { uploadDataUrlToShopifyFiles } from "../lib/lff-media.server";
import { asShopifyGid, cleanText } from "../lib/lff-v90.server";
import { recordAudit } from "../lib/lff.server";

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

function reviewPublic(row) {
  return {
    id: row.id,
    name: row.name,
    productId: row.productGid,
    productHandle: row.productHandle,
    productTitle: row.productTitle,
    rating: row.rating,
    text: row.body,
    image: row.imageUrl || "",
    createdAt: row.createdAt,
  };
}

export const loader = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
    const productGid = asShopifyGid("Product", url.searchParams.get("productId"));
    const handle = cleanText(url.searchParams.get("handle"), 180).toLowerCase();
    const whereProduct = productGid
      ? { productGid }
      : handle
        ? { productHandle: { equals: handle, mode: "insensitive" } }
        : null;
    if (!whereProduct) return Response.json({ ok: false, error: "Falta el producto." }, { status: 400 });
    const rows = await db.productReview.findMany({
      where: { shop, status: "approved", hidden: false, ...whereProduct },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const average = rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : 0;
    return Response.json({ ok: true, reviews: rows.map(reviewPublic), count: rows.length, average });
  } catch (error) {
    console.error("[LFF REVIEWS PUBLIC GET]", error);
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
};

export const action = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
    const body = await bodyData(request);
    const name = cleanText(body.name || body.review_name, 60);
    const text = cleanText(body.text || body.review_text, 1000);
    const orderRef = cleanText(body.orderRef || body.review_order, 80);
    const rating = Math.max(1, Math.min(5, Number(body.rating || body.review_rating) || 5));
    const productGid = asShopifyGid("Product", body.productId || body.productGid);
    const productHandle = cleanText(body.productHandle || body.handle, 180).toLowerCase() || null;
    const productTitle = cleanText(body.productTitle, 220) || null;
    if (!name || !text) throw new Error("Completa nombre y reseña.");
    if (!productGid && !productHandle) throw new Error("Falta el producto de la reseña.");
    const consent = body.consent === true || body.consent === "true" || body.review_consent === "on";
    if (!consent) throw new Error("Debes autorizar la publicación de la reseña.");

    let uploaded = null;
    const imageData = String(body.imageData || body.image || "");
    if (imageData.startsWith("data:image/")) {
      const { admin } = await unauthenticated.admin(shop);
      if (!admin) throw new Error("No hay sesión offline de Shopify para guardar la imagen.");
      uploaded = await uploadDataUrlToShopifyFiles(admin, imageData, {
        filename: `review-${Date.now()}.png`,
        alt: `Reseña de ${name} · La Fábrica Friki`,
        maxBytes: 3 * 1024 * 1024,
      });
    }

    const review = await db.productReview.create({
      data: {
        shop,
        productGid: productGid || null,
        productHandle,
        productTitle,
        category: cleanText(body.category, 120) || null,
        name,
        orderRef: orderRef || null,
        rating,
        body: text,
        imageFileId: uploaded?.id || null,
        imageUrl: uploaded?.url || null,
        source: "customer_web",
        status: "pending",
        hidden: false,
      },
    });
    await recordAudit(shop, "review.submitted", { targetType: "product_review", targetId: review.id, productGid, productHandle }).catch(() => {});
    return Response.json({ ok: true, id: review.id, status: "pending" });
  } catch (error) {
    console.error("[LFF REVIEWS PUBLIC POST]", error);
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
};
