import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";

// V140 · Cached public catalog by category. PostgreSQL snapshots are shared
// between browsers, survive Render restarts and never store galleries/variants.
const CATEGORY = {
  anime: { tags: ["anime-manga"], names: ["anime manga", "anime y manga"] },
  gaming: { tags: ["gaming", "zona-de-juegos", "zona-gaming"], names: ["gaming", "zona de juegos", "zona gaming", "videojuegos"] },
  disney: { tags: ["disney", "disney-pixar"], names: ["disney", "disney pixar", "disney y pixar"] },
  multiverse: { tags: ["multiusos", "multiverso", "multiverse", "multiusos-multiverso"], names: ["multiusos", "multiverso", "multiverse", "multiusos multiverso"] },
};

const REFRESH_AFTER_MS = 5 * 60_000; // periodic Shopify synchronization
const MAX_STALE_MS = 6 * 60 * 60_000;  // don't silently serve very old stock indefinitely
const RAM_CACHE_MS = 60_000;
const ram = new Map();
const refreshing = new Map();
const refreshRetryAfter = new Map();

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s) => norm(s).replace(/\s+/g, "-");

function belongs(p, category) {
  const def = CATEGORY[category];
  if (!def) return false;
  const tags = Array.isArray(p?.tags) ? p.tags : [];
  return tags.some(raw => {
    const t = String(raw || "");
    const familyCategory = /^LFF_CATEGORY:/i.test(t) ? norm(t.replace(/^LFF_CATEGORY:/i, "")) : "";
    return (familyCategory && def.names.includes(familyCategory)) || def.tags.includes(slug(t));
  });
}

function money(amount, currency = "EUR") {
  try { return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number(amount || 0)); }
  catch { return `${Number(amount || 0).toFixed(2)} €`; }
}


async function findOnlinePublication(admin) {
  const response = await admin.graphql(`#graphql
    query LffLightPublications { publications(first: 50) { nodes { id name } } }
  `);
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
  const pubs = json.data?.publications?.nodes || [];
  return pubs.find(p => /online store|tienda online/i.test(String(p.name || ""))) || pubs[0] || null;
}

async function getShopifyProducts(admin, filter, publicationId) {
  const rows = [];
  let after = null;
  // No variants or galleries. The published flag is queried in the same page;
  // V139 required an additional Shopify request for each batch of 50 products.
  for (let page = 0; page < 15; page += 1) {
    const response = await admin.graphql(`#graphql
      query LffCategoryLightV140($after: String, $filter: String!, $pub: ID!) {
        products(first: 100, after: $after, query: $filter) {
          nodes {
            id title handle status tags onlineStoreUrl
            publishedOnPublication(publicationId: $pub)
            featuredMedia { ... on MediaImage { image { url(transform: {maxWidth: 520}) } } }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { after, filter, pub: publicationId } });
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
    const conn = json.data?.products;
    if (!conn) throw new Error("Shopify catalog response missing");
    rows.push(...(conn.nodes || []));
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return rows;
}

async function listCategory(admin, category) {
  const def = CATEGORY[category];
  const publication = await findOnlinePublication(admin);
  if (!publication?.id) throw new Error("Online Store publication not found");
  const query = `status:active AND (${def.tags.map(t => `tag:${t}`).join(" OR ")})`;
  let rows = (await getShopifyProducts(admin, query, publication.id)).filter(p => belongs(p, category));
  if (!rows.length) {
    // Compatibility: legacy products may only use LFF_CATEGORY/ LFF_FAMILY tags.
    rows = (await getShopifyProducts(admin, "status:active", publication.id)).filter(p => belongs(p, category));
  }
  const seen = new Set();
  return rows.filter(p => p?.publishedOnPublication).filter(p => {
    const key = String(p.id || p.handle || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(p => {
    const categoryTag = (p.tags || []).find(t => /^LFF_CATEGORY:/i.test(t)) || "";
    const familyTag = (p.tags || []).find(t => /^LFF_FAMILY:/i.test(t)) || "";
    const price = p.priceRangeV2?.minVariantPrice || {};
    return {
      id: p.id, title: p.title || "Producto", handle: p.handle || "",
      url: p.onlineStoreUrl || `/products/${p.handle || ""}`,
      tags: p.tags || [],
      category: categoryTag.replace(/^LFF_CATEGORY:/i, "").trim(),
      family: familyTag.replace(/^LFF_FAMILY:/i, "").trim(),
      image: p.featuredMedia?.image?.url || "",
      priceFormatted: money(price.amount || 0, price.currencyCode || "EUR"),
    };
  });
}

function snapshotIsValid(row) {
  return row && Array.isArray(row.products);
}
function snapshotInfo(row) {
  const updated = row?.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  return { updated, ageMs: Math.max(0, Date.now() - updated) };
}
async function readSnapshot(shop, category) {
  const key = `${shop}:${category}`;
  const saved = ram.get(key);
  if (saved && saved.expires > Date.now()) return saved.row;
  const row = await prisma.lffCatalogLiteSnapshot.findUnique({ where: { shop_category: { shop, category } } });
  if (snapshotIsValid(row)) ram.set(key, { row, expires: Date.now() + RAM_CACHE_MS });
  return row;
}
async function refresh(shop, category) {
  const key = `${shop}:${category}`;
  if (refreshing.has(key)) return refreshing.get(key);
  const promise = (async () => {
    const { admin } = await unauthenticated.admin(shop);
    const products = await listCategory(admin, category);
    const row = await prisma.lffCatalogLiteSnapshot.upsert({
      where: { shop_category: { shop, category } },
      create: { shop, category, products },
      update: { products },
    });
    ram.set(key, { row, expires: Date.now() + RAM_CACHE_MS });
    return row;
  })().catch(error => {
    // Back off after Shopify network/API errors instead of hammering the API.
    refreshRetryAfter.set(key, Date.now() + 60_000);
    throw error;
  }).finally(() => refreshing.delete(key));
  refreshing.set(key, promise);
  return promise;
}

function send(category, row, cacheStatus, status = 200) {
  return Response.json({
    ok: true, category, products: row.products, cached: cacheStatus !== "fresh",
    cacheStatus, lastUpdated: row.updatedAt,
  }, { status, headers: {
    "Cache-Control": "public, max-age=45, stale-while-revalidate=120",
    "X-LFF-Catalog-Cache": cacheStatus,
  } });
}

export const loader = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || "";
    if (!CATEGORY[category]) return Response.json({ ok: false, error: "Categoría desconocida" }, { status: 400 });
    const shop = process.env.SHOPIFY_SHOP_DOMAIN || url.searchParams.get("shop");
    if (!shop) return Response.json({ ok: false, error: "Tienda no configurada" }, { status: 400 });
    let row = await readSnapshot(shop, category);
    if (snapshotIsValid(row)) {
      const age = snapshotInfo(row).ageMs;
      if (age < REFRESH_AFTER_MS) return send(category, row, "persistent");
      if (age < MAX_STALE_MS) {
        if ((refreshRetryAfter.get(`${shop}:${category}`) || 0) > Date.now())
          return send(category, row, "stale-retry-later");
        // Return instantly, even for a new browser. Refresh without blocking it.
        void refresh(shop, category).catch(error => {
          console.error("[LFF V140 refresh]", category, error);
        });
        return send(category, row, "stale-refreshing");
      }
    }
    try {
      row = await refresh(shop, category);
      return send(category, row, "fresh");
    } catch (error) {
      // Keep the last known working catalog available during Shopify outages.
      if (snapshotIsValid(row)) {
        console.error("[LFF V140 stale fallback]", category, error);
        return send(category, row, "stale-fallback");
      }
      throw error;
    }
  } catch (error) {
    console.error("[LFF catalog-lite V140]", error);
    return Response.json({ ok: false, products: [], error: "Catálogo temporalmente no disponible" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};
