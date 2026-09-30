import db from "../db.server";
import { authenticate } from "../shopify.server";
import { classifyTrafficSource, cleanText } from "../lib/lff-v90.server";
import { upsertTrafficPresence } from "../lib/lff-v91.server";

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
    if (body.analyticsConsent === false || body.analyticsConsent === "false") {
      return Response.json({ ok: true, skipped: true, reason: "analytics_consent_false" });
    }
    const source = classifyTrafficSource(body);
    const event = cleanText(body.event || "page_view", 80) || "page_view";
    await upsertTrafficPresence(request, shop, body, source).catch((error) => console.warn("[LFF TRAFFIC PRESENCE]", error.message));
    if (event === "heartbeat") return Response.json({ ok: true, heartbeat: true, source });
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;
    const row = await db.trafficEvent.create({
      data: {
        shop,
        visitorId: cleanText(body.visitorId, 180) || null,
        customerId: cleanText(body.customerId, 100) || null,
        sessionKey: cleanText(body.sessionKey, 180) || null,
        event,
        source,
        sourceDetail: cleanText(body.sourceDetail, 180) || null,
        path: cleanText(body.path, 500) || null,
        referrer: cleanText(body.referrer, 1000) || null,
        campaign: cleanText(body.campaign || body.utm_campaign, 180) || null,
        medium: cleanText(body.medium || body.utm_medium, 180) || null,
        content: cleanText(body.content || body.utm_content, 180) || null,
        term: cleanText(body.term || body.utm_term, 180) || null,
        commercialCode: cleanText(body.commercialCode, 80) || null,
        companyId: cleanText(body.companyId, 100) || null,
        metadataJson: metadata ? JSON.stringify(metadata).slice(0, 12000) : null,
      },
    });
    return Response.json({ ok: true, id: row.id, source });
  } catch (error) {
    console.error("[LFF ANALYTICS EVENT]", error);
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
};
