import { authenticate, unauthenticated } from "../shopify.server";

// V139 · Fichas ligeras por categoría para la tienda pública.
// Nunca incluye variantes completas ni la galería de medios de cada producto.
const CATEGORY = {
  anime: { tags: ["anime-manga"], names: ["anime manga", "anime y manga"] },
  gaming: { tags: ["gaming", "zona-de-juegos", "zona-gaming"], names: ["gaming", "zona de juegos", "zona gaming", "videojuegos"] },
  disney: { tags: ["disney", "disney-pixar"], names: ["disney", "disney pixar", "disney y pixar"] },
  multiverse: { tags: ["multiusos", "multiverso", "multiverse", "multiusos-multiverso"], names: ["multiusos", "multiverso", "multiverse", "multiusos multiverso"] },
};
const TTL = 2 * 60_000;
const cache = new Map();
const pending = new Map();

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

async function getShopifyProducts(admin, query) {
  const rows = [];
  let after = null;
  // Solo los campos que requiere la tarjeta; sin variant matrix ni galería de mockups.
  for (let page = 0; page < 15; page += 1) {
    const res = await admin.graphql(`#graphql
      query LffCategoryLight($after: String, $filter: String!) {
        products(first: 100, after: $after, query: $filter) {
          nodes {
            id title handle status tags onlineStoreUrl
            featuredMedia { ... on MediaImage { image { url(transform: {maxWidth: 520}) } } }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { after, filter: query } });
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
    const conn = json.data?.products;
    if (!conn) throw new Error("Shopify no devolvió el catálogo.");
    rows.push(...(conn.nodes || []));
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return rows;
}

async function findOnlinePublication(admin) {
  const res = await admin.graphql(`#graphql
    query LffLightPublications { publications(first: 50) { nodes { id name } } }
  `);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
  const pub = json.data?.publications?.nodes || [];
  return pub.find(x => /online store|tienda online/i.test(String(x.name || ""))) || pub[0] || null;
}

async function checkPublished(admin, ids, publicationId) {
  // Publicación real: una consulta ligera, sin información de variantes.
  // Si el shop no tiene publicación recuperable, mantenemos solo active y dejamos
  // al theme formar el enlace; no inventamos detalles de productos.
  if (!publicationId || !ids.length) return new Set(ids);
  const ok = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const segment = ids.slice(i, i + 50);
    const res = await admin.graphql(`#graphql
      query LffLightPublished($ids: [ID!]!, $pub: ID!) {
        nodes(ids: $ids) { ... on Product { id publishedOnPublication(publicationId: $pub) } }
      }
    `, { variables: { ids: segment, pub: publicationId } });
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
    for (const p of json.data?.nodes || []) if (p?.publishedOnPublication) ok.add(p.id);
  }
  return ok;
}

async function listCategory(admin, category) {
  const def = CATEGORY[category];
  const filters = def.tags.map(t => `tag:${t}`);
  // Se filtra en Shopify para no traer todo el catálogo en cada visita.
  let rows = await getShopifyProducts(admin, `status:active AND (${filters.join(" OR ")})`);
  rows = rows.filter(p => belongs(p, category));
  if (!rows.length) {
    // Respaldo para productos antiguos etiquetados solo con LFF_CATEGORY:...
    // Evita que una diferencia de nomenclatura vacíe una categoría.
    rows = (await getShopifyProducts(admin, "status:active")).filter(p => belongs(p, category));
  }
  const pub = await findOnlinePublication(admin);
  const published = await checkPublished(admin, rows.map(p => p.id), pub?.id);
  const seen = new Set();
  return rows.filter(p => published.has(p.id)).filter(p => {
    const key = String(p.id || p.handle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(p => {
    const categoryTag = (p.tags || []).find(t => /^LFF_CATEGORY:/i.test(t)) || "";
    const familyTag = (p.tags || []).find(t => /^LFF_FAMILY:/i.test(t)) || "";
    const amount = p.priceRangeV2?.minVariantPrice?.amount || 0;
    const currency = p.priceRangeV2?.minVariantPrice?.currencyCode || "EUR";
    return {
      id: p.id, title: p.title || "Producto", handle: p.handle || "",
      url: p.onlineStoreUrl || `/products/${p.handle || ""}`,
      tags: p.tags || [], category: categoryTag.replace(/^LFF_CATEGORY:/i, "").trim(),
      family: familyTag.replace(/^LFF_FAMILY:/i, "").trim(),
      image: p.featuredMedia?.image?.url || "", priceFormatted: money(amount, currency),
    };
  });
}

export const loader = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || "";
    if (!CATEGORY[category]) return Response.json({ ok: false, error: "Categoría desconocida." }, { status: 400 });
    const shop = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN;
    if (!shop) return Response.json({ ok: false, error: "Tienda no configurada." }, { status: 400 });
    const key = `${shop}:${category}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return Response.json({ ok: true, products: cached.products, category, cached: true }, { headers: { "Cache-Control": "public, max-age=30" } });
    }
    if (!pending.has(key)) {
      pending.set(key, (async () => {
        const { admin } = await unauthenticated.admin(shop);
        const products = await listCategory(admin, category);
        cache.set(key, { products, expires: Date.now() + TTL });
        return products;
      })().finally(() => pending.delete(key)));
    }
    let products;
    try { products = await pending.get(key); }
    catch (e) {
      // Servir la última instantánea válida cuando falle Shopify temporalmente.
      if (!cached) throw e;
      products = cached.products;
    }
    return Response.json({ ok: true, products, category, cached: false }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (error) {
    console.error("[LFF catalog-lite]", error);
    return Response.json({ ok: false, products: [], error: "Catálogo temporalmente no disponible." }, { status: 503 });
  }
};
