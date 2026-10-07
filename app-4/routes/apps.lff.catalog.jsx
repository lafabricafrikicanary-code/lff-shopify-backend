import { authenticate, unauthenticated } from "../shopify.server";

function safeMoney(amount, currencyCode = "EUR") {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currencyCode || "EUR" }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

function imageFromMedia(media) {
  const image = media?.image || media?.preview?.image || null;
  return image?.url || "";
}

function taxonomyFromTags(tags = []) {
  const list = Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  const categoryTag = list.find((tag) => /^LFF_CATEGORY:/i.test(tag)) || "";
  const familyTag = list.find((tag) => /^LFF_FAMILY:/i.test(tag)) || "";
  return {
    category: categoryTag.replace(/^LFF_CATEGORY:/i, "").trim(),
    family: familyTag.replace(/^LFF_FAMILY:/i, "").trim(),
  };
}

async function onlineStorePublication(admin) {
  const response = await admin.graphql(`#graphql
    query LffCatalogPublications {
      publications(first: 50) { nodes { id name } }
    }
  `);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  const rows = payload.data?.publications?.nodes || [];
  return rows.find((p) => /online store|tienda online/i.test(String(p.name || ""))) || rows[0] || null;
}


function normalizeFamilyValue(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[×&]/g, " x ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function requestedFamilyKeys(url) {
  const values = [
    url.searchParams.get("family"),
    url.searchParams.get("family_id"),
    ...url.searchParams.getAll("alias"),
  ].filter(Boolean);
  return [...new Set(values.map(normalizeFamilyValue).filter(Boolean))];
}

function productMatchesFamily(product, keys = []) {
  if (!keys.length) return true;
  const family = normalizeFamilyValue(product?.family || "");
  if (family && keys.some((key) => family === key || family.includes(key) || key.includes(family))) return true;

  const tags = Array.isArray(product?.tags) ? product.tags : [];
  for (const raw of tags) {
    const tag = String(raw || "");
    if (/^LFF_FAMILY:/i.test(tag)) {
      const taggedFamily = normalizeFamilyValue(tag.replace(/^LFF_FAMILY:/i, ""));
      if (taggedFamily && keys.some((key) => taggedFamily === key || taggedFamily.includes(key) || key.includes(taggedFamily))) return true;
    }
    const normalizedTag = normalizeFamilyValue(tag);
    if (normalizedTag && keys.some((key) => normalizedTag === key)) return true;
  }
  return false;
}

const CATALOG_CACHE_MS = 60_000;
let catalogCache = { expiresAt: 0, products: null, pending: null };

async function loadCatalogCached(admin) {
  const now = Date.now();
  if (Array.isArray(catalogCache.products) && catalogCache.expiresAt > now) return catalogCache.products;
  if (catalogCache.pending) return catalogCache.pending;
  catalogCache.pending = loadCatalog(admin)
    .then((products) => {
      catalogCache.products = products;
      catalogCache.expiresAt = Date.now() + CATALOG_CACHE_MS;
      return products;
    })
    .finally(() => {
      catalogCache.pending = null;
    });
  return catalogCache.pending;
}

async function loadCatalog(admin) {
  const publication = await onlineStorePublication(admin);
  if (!publication) throw new Error("No se encontró la publicación de Tienda online.");

  const products = [];
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const response = await admin.graphql(`#graphql
      query LffPublicCatalog($after: String, $publicationId: ID!) {
        products(first: 100, after: $after, query: "status:active") {
          nodes {
            id
            title
            handle
            status
            tags
            onlineStoreUrl
            totalInventory
            publishedOnPublication(publicationId: $publicationId)
            featuredMedia {
              ... on MediaImage { image { url altText } }
            }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
            variants(first: 1) { nodes { id availableForSale price inventoryPolicy } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { after, publicationId: publication.id } });
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
    const conn = payload.data?.products;
    for (const p of conn?.nodes || []) {
      if (!p?.publishedOnPublication) continue;
      const variant = p.variants?.nodes?.[0] || null;
      const price = p.priceRangeV2?.minVariantPrice || {};
      const taxonomy = taxonomyFromTags(p.tags || []);
      products.push({
        id: p.id,
        title: p.title || "Producto",
        handle: p.handle || "",
        url: p.onlineStoreUrl || (p.handle ? `/products/${p.handle}` : "#"),
        tags: Array.isArray(p.tags) ? p.tags : [],
        category: taxonomy.category,
        family: taxonomy.family,
        image: imageFromMedia(p.featuredMedia),
        price: Number(price.amount || variant?.price || 0),
        priceFormatted: safeMoney(price.amount || variant?.price || 0, price.currencyCode || "EUR"),
        variantId: variant?.id ? String(variant.id).split("/").pop() : "",
        available: variant ? (String(variant.inventoryPolicy || "").toUpperCase() === "CONTINUE" || Boolean(variant.availableForSale)) : true,
        unlimitedStock: variant ? String(variant.inventoryPolicy || "").toUpperCase() === "CONTINUE" : true,
      });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return products;
}

export const loader = async ({ request }) => {
  try {
    await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN;
    if (!shop) return Response.json({ ok: false, error: "Shop ausente." }, { status: 400 });
    const { admin } = await unauthenticated.admin(shop);
    const allProducts = await loadCatalogCached(admin);
    const familyKeys = requestedFamilyKeys(url);
    const products = familyKeys.length
      ? allProducts.filter((product) => productMatchesFamily(product, familyKeys))
      : allProducts;
    return Response.json(
      {
        ok: true,
        products,
        count: products.length,
        totalCatalog: allProducts.length,
        filteredByFamily: familyKeys.length > 0,
        familyKeys,
        source: familyKeys.length ? "admin-online-store-publication-family" : "admin-online-store-publication",
      },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("[LFF CATALOG]", error);
    return Response.json({ ok: false, products: [], error: error.message || "No se pudo cargar el catálogo." }, { status: 500 });
  }
};
