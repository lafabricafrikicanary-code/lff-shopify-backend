import db from "../db.server";
import { authenticate } from "../shopify.server";

// Public aggregate of consented searches/opens. No individual IDs exposed.
export const loader = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const shop = new URL(request.url).searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db.trafficEvent.groupBy({
      by: ["term"],
      where: { shop, event: { in: ["family_search", "family_open"] }, term: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { term: "desc" } },
      take: 350,
    });
    return Response.json({ ok: true, windowDays: 90, popularity: rows.filter(x => x.term).map(x => ({ family: x.term, visits: x._count._all })) }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.warn("[LFF FAMILIES RANK]", error.message);
    return Response.json({ ok: false, popularity: [] }, { status: 503 });
  }
};
