import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { familyCatalogTaxonomy, publicCategoryMatch } from "../lib/catalog-public-taxonomy.server";

// V140 · Cached public catalog by category. PostgreSQL snapshots are shared
// between browsers, survive Render restarts and never store galleries/variants.
const CATEGORY = {
  anime: { tags: ["anime-manga"], names: ["anime manga", "anime y manga"] },
  gaming: { tags: ["gaming", "zona-de-juegos", "zona-gaming"], names: ["gaming", "zona de juegos", "zona gaming", "videojuegos"] },
  disney: { tags: ["disney", "disney-pixar"], names: ["disney", "disney pixar", "disney y pixar"] },
  multiverse: { tags: ["multiusos", "multiverso", "multiverse", "multiusos-multiverso"], names: ["multiusos", "multiverso", "multiverse", "multiusos multiverso"] },
};

const REFRESH_AFTER_MS = 5 * 60_000; // avoid a full Shopify scan every minute
const MAX_STALE_MS = 6 * 60 * 60_000;  // don't silently serve very old stock indefinitely
const RAM_CACHE_MS = 90_000; // serve family batches without repeated PostgreSQL reads
const ram = new Map();
const refreshing = new Map();
const refreshRetryAfter = new Map();
const sharedPublishedScans = new Map();
const crossCategoryRefreshAt = new Map();
// V182: browsing any portal keeps the other three cached catalogs current too.
// This operates ONLY on the server and reuses the same 750-product Shopify scan;
// it never makes shoppers download the full catalog.
function warmMissingCategories(shop,openedCategory){
  const now=Date.now(),last=crossCategoryRefreshAt.get(shop)||0;
  if(now-last<8*60_000)return;
  crossCategoryRefreshAt.set(shop,now);
  const others=Object.keys(CATEGORY).filter(name=>name!==openedCategory);
  void Promise.allSettled(others.map(async name=>{
    const cached=await readSnapshot(shop,name);
    const stale=!snapshotIsValid(cached)||snapshotInfo(cached).ageMs>=REFRESH_AFTER_MS;
    if(!stale)return;
    const key=shop+":"+name;
    if(refreshing.has(key)||(refreshRetryAfter.get(key)||0)>Date.now())return;
    await refresh(shop,name);
  })).then(results=>{
    for(const item of results)if(item.status==="rejected")
      console.warn("[LFF V182 category warm]",item.reason?.message||item.reason);
  });
}

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
  for (let page = 0; page < 35; page += 1) {
    const response = await admin.graphql(`#graphql
      query LffCategoryLightV140($after: String, $filter: String!, $pub: ID!) {
        products(first: 100, after: $after, query: $filter) {
          nodes {
            id title handle status tags productType onlineStoreUrl
            metafield(namespace: "lff", key: "showcase_png") { value }
            showcaseVideo:metafield(namespace:"lff",key:"showcase_video"){
              reference{... on Video{id fileStatus preview{image{url(transform:{maxWidth:520})}} sources{url mimeType format}}}
            }
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

async function listCategory(admin, category, shop) {
  const publication = await findOnlinePublication(admin);
  if (!publication?.id) throw new Error('Online Store publication not found');
  // Read all ACTIVE products from the publication; some externally uploaded
  // items are published without LFF_CATEGORY tags. The old query lost them.
  // Avoid fetching the entire Shopify catalog four times if portals warm together.
  const cacheKey=`${shop}:${publication.id}`;
  let scan=sharedPublishedScans.get(cacheKey);
  if (!scan || scan.expires < Date.now()) {
    const promise=getShopifyProducts(admin,'status:active',publication.id)
      .then(rows=>familyCatalogTaxonomy(shop,rows));
    scan={expires:Date.now()+60_000,promise};
    sharedPublishedScans.set(cacheKey,scan);
    promise.catch(()=>{if(sharedPublishedScans.get(cacheKey)===scan)sharedPublishedScans.delete(cacheKey);});
  }
  const normalized=await scan.promise;
  const seen=new Set();
  return normalized.filter(p=>p.publishedOnPublication && publicCategoryMatch(p,category)).filter(p=>{
    const key=String(p.id||p.handle||'');if(!key||seen.has(key))return false;
    seen.add(key);return true;
  }).map(p=>{
    const price=p.priceRangeV2?.minVariantPrice||{};
    const video=p.showcaseVideo?.reference?.fileStatus==="READY" ? p.showcaseVideo.reference : null;
    const mp4=video?.sources?.find(x=>x.mimeType==="video/mp4"||x.format==="mp4")?.url||"";
    // La miniatura de Shopify funciona como portada hasta que se interactúa.
    const videoPoster=mp4 ? (video?.preview?.image?.url||"") : "";
    const png=/^https:\/\/cdn\.shopify\.com\//.test(String(p.metafield?.value||"")) ? p.metafield.value : "";
    return {id:p.id,title:p.title||'Producto',handle:p.handle||'',
      url:p.onlineStoreUrl||`/products/${p.handle||''}`,
      tags:p.tags||[],productType:p.productType||'',
      category:p.category||'',family:p.family||'',
      // La foto REAL del producto queda detrás del MP4, también cuando Safari
      // bloquea el movimiento o el vídeo no tiene una miniatura utilizable.
      image:png||p.featuredMedia?.image?.url||videoPoster||'',
      showcaseImage:Boolean(png&&!mp4),
      showcaseVideo:mp4,
      priceFormatted:money(price.amount||0,price.currencyCode||'EUR')};
  });
}
// V126: fast family slices from PostgreSQL; never fetch the full product gallery.
function familyKey(v) { return norm(v).replace(/\s+/g, "-"); }
function matchesFamily(p, rawFamily) {
  const goal=familyKey(rawFamily);
  if(!goal)return false;
  const tags=Array.isArray(p.tags)?p.tags:[];
  // Normalizar nombres importados: «Naruto» / «Naruto Shippuden»;
  // «DanDaDan» / «Dan Da Dan», sin asignar One Piece por palabras sueltas.
  const related=value=>{
    const key=familyKey(value);
    if(!key)return false;
    if(key===goal||key.replace(/-/g,"")===goal.replace(/-/g,""))return true;
    const shorter=key.length<goal.length?key:goal;
    const longer=key.length<goal.length?goal:key;
    return shorter.length>=5&&longer.startsWith(shorter+"-");
  };
  if(related(p.family))return true;
  return tags.some(t=>{
    const raw=String(t||"");
    return related(raw.replace(/^LFF_FAMILY:/i,""));
  });
}
function productKindLite(p) {
  const tags=Array.isArray(p.tags)?p.tags:[];
  const declared=tags.find(t=>/^LFF_PRODUCT_TYPE:/i.test(String(t||"")));
  const hint=norm(declared?String(declared).split(":").slice(1).join(":"):"");
  const title=norm(p.title),productType=norm(p.productType);
  const classify=x=>{
    if(/poster|lamina|cuadro/.test(x))return "poster";
    if(/taza|mug/.test(x))return "taza";
    if(/textil|ropa|camiseta|camisa|sudadera|hoodie|crop top|apparel/.test(x))return "textil";
    return "";
  };
  if(hint)return classify(hint)||familyKey(hint).slice(0,65);
  if(/poster|lamina|cuadro/.test(title))return "poster";
  if(/taza|mug/.test(title))return "taza";
  if(classify(productType))return classify(productType);
  if(/merchandising lff/.test(productType))return "textil";
  if(classify(title))return classify(title);
  return productType?familyKey(productType).slice(0,65):"otros";
}
function sendFamily(category,row,params,cacheStatus){
  const family=String(params.get("family")||"").trim().slice(0,120);
  const phase=params.get("phase")==="more"?"more":"initial";
  const kind=String(params.get("kind")||"").slice(0,65);
  const offset=Math.min(20000,Math.max(0,Number.parseInt(params.get("offset")||"0",10)||0));
  const batchSize=Math.min(24,Math.max(4,Number.parseInt(params.get("limit")||"12",10)||12));
  const selected=(Array.isArray(row.products)?row.products:[]).filter(p=>matchesFamily(p,family));
  const byKind=new Map();
  selected.forEach(p=>{
    const k=productKindLite(p);
    if(!byKind.has(k))byKind.set(k,[]);
    byKind.get(k).push(p);
  });
  const kinds=["textil","taza","poster",...byKind.keys()].filter((k,i,a)=>byKind.has(k)&&a.indexOf(k)===i);
  const countsByKind=Object.fromEntries(kinds.map(k=>[k,byKind.get(k).length]));
  let products=[],hasMore=false,nextOffset=0;
  if(phase==="more"){
    const group=byKind.get(kind)||[];
    products=group.slice(offset,offset+batchSize);
    nextOffset=offset+products.length;
    hasMore=nextOffset<group.length;
  }else {
    products=kinds.flatMap(k=>byKind.get(k).slice(0,4));
    nextOffset=4;
    hasMore=selected.length>products.length;
  }
  return Response.json({
    ok:true,category,family,phase,kind,products,kinds,countsByKind,
    total:selected.length,hasMore,nextOffset,lastUpdated:row.updatedAt,
    cacheStatus
  },{headers:{
    "Cache-Control":"public, max-age=45, stale-while-revalidate=300",
    "X-LFF-Catalog-Cache":cacheStatus
  }});
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
    const products = await listCategory(admin, category, shop);
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
    "Cache-Control": "public, max-age=45, stale-while-revalidate=300",
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
    warmMissingCategories(shop,category);
    const forceRefresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
    const family=String(url.searchParams.get("family")||"").trim();
    if(family.length>120)return Response.json({ok:false,error:"Familia no válida"},{status:400});
    const deliver=(saved,status)=>family
      ?sendFamily(category,saved,url.searchParams,status)
      :send(category,saved,status);
    let row = forceRefresh ? null : await readSnapshot(shop, category);
    if (snapshotIsValid(row)) {
      const age = snapshotInfo(row).ageMs;
      if (age < REFRESH_AFTER_MS) return deliver(row,"persistent");
      // Stale-while-revalidate: never block shoppers on the slow Shopify scan.
      const key=shop+":"+category;
      if(!refreshing.has(key) && (refreshRetryAfter.get(key)||0)<Date.now()){
        void refresh(shop,category).catch(error=>console.error("[LFF V126 refresh]",category,error));
      }
      return deliver(row,age>MAX_STALE_MS?"stale-expired":"stale-refreshing");
    }
    try {
      row = await refresh(shop, category);
      return deliver(row,forceRefresh ? "fresh-forced" : "fresh");
    } catch (error) {
      if (snapshotIsValid(row)) {
        console.error("[LFF V126 stale fallback]", category, error);
        return deliver(row,"stale-fallback");
      }
      throw error;
    }
  } catch (error) {
    console.error("[LFF catalog-lite V140]", error);
    return Response.json({ ok: false, products: [], error: "Catálogo temporalmente no disponible" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};
