import { authenticate } from "../shopify.server";
import { upsertFavorite } from "../lib/lff-v90.server";

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export const action = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
    const body = await bodyData(request);
    const result = await upsertFavorite(request, body, shop);
    return Response.json({
      ok: true,
      favoriteId: result.favorite?.id || null,
      status: result.favorite?.status || (result.removed ? "removed" : "ignored"),
      campaignStatus: result.campaign?.status || null,
      eligibleAt: result.campaign?.eligibleAt || null,
    });
  } catch (error) {
    console.error("[LFF RETENTION FAVORITE]", error);
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
};
