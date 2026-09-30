import { createHash } from "node:crypto";
import { isIP } from "node:net";
import db from "../db.server";
import { createPercentageCode, makeCode, recordAudit } from "./lff.server";
import { cleanText } from "./lff-v90.server";

export const DEFAULT_LFF_CATEGORIES = [
  { key: "anime-manga", name: "Anime & Manga", order: 1, state: "published", isCustom: false },
  { key: "gaming", name: "Gaming", order: 2, state: "published", isCustom: false },
  { key: "disney", name: "Disney", order: 3, state: "published", isCustom: false },
  { key: "multiusos", name: "Multiusos", order: 4, state: "published", isCustom: false },
  { key: "youtubers", name: "YouTubers", order: 5, state: "preparation", isCustom: true },
];

export function slugKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeCategoryState(value) {
  const state = String(value || "published").trim().toLowerCase();
  if (!new Set(["published", "preparation", "hidden"]).has(state)) throw new Error("Estado de categoría no válido.");
  return state;
}

export async function ensureDefaultCategories(shop) {
  for (const item of DEFAULT_LFF_CATEGORIES) {
    const existing = await db.lffCategory.findUnique({ where: { shop_categoryKey: { shop, categoryKey: item.key } } });
    if (existing) continue;
    const nameConflict = await db.lffCategory.findUnique({ where: { shop_name: { shop, name: item.name } } });
    if (nameConflict) continue;
    await db.lffCategory.create({
      data: { shop, categoryKey: item.key, name: item.name, sortOrder: item.order, state: item.state, isCustom: item.isCustom },
    });
  }
}

export async function listCategories(shop) {
  await ensureDefaultCategories(shop);
  return db.lffCategory.findMany({ where: { shop }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function ensureCategory(shop, value) {
  const name = cleanText(value, 100);
  if (name.length < 2) throw new Error("Categoría no válida.");
  await ensureDefaultCategories(shop);
  const existing = await db.lffCategory.findFirst({ where: { shop, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  const key = slugKey(name);
  if (!key) throw new Error("No se pudo generar el identificador de categoría.");
  return db.lffCategory.create({ data: { shop, categoryKey: key, name, sortOrder: 999, state: "preparation", isCustom: true } });
}

export function creatorPublic(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    channel: row.channel,
    about: row.about,
    kind: row.kind || "commercial",
    brandName: row.brandName || "",
    promoPercent: Number(row.promoPercent || 0),
    firstSaleRateBps: Number(row.firstSaleRateBps || 0),
    referralRateBps: Number(row.referralRateBps || 0),
    ownProductRateBps: Number(row.ownProductRateBps || 0),
    captureCode: row.captureCode,
    personalCode: row.kind === "creator" ? "" : row.personalCode,
    status: row.status,
    forceChange: row.forceChange,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export async function createCreatorWithPromoCode({
  admin,
  shop,
  name,
  email,
  phone = null,
  channel = null,
  about = null,
  brandName = null,
  promoPercent = 10,
  passwordHash = null,
  passwordSalt = null,
}) {
  const normalizedPercent = Math.max(1, Math.min(50, Number(promoPercent) || 10));
  const label = cleanText(brandName || name || email || "CREADOR", 80);
  const captureCode = makeCode("LFFYT", label);
  const personalCode = makeCode("LFFYTINT", label);
  const promo = await createPercentageCode(admin, {
    title: `LFF YouTuber - ${label}`,
    code: captureCode,
    percent: normalizedPercent,
    appliesOncePerCustomer: false,
    combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: false },
  });
  const creator = await db.commercialUser.create({
    data: {
      shop,
      name: cleanText(name, 180),
      email: cleanText(email, 320).toLowerCase(),
      phone: cleanText(phone, 80) || null,
      channel: cleanText(channel, 500) || null,
      about: cleanText(about, 2000) || null,
      kind: "creator",
      brandName: label,
      promoPercent: normalizedPercent,
      firstSaleRateBps: 0,
      referralRateBps: 1000,
      ownProductRateBps: 3000,
      captureCode,
      personalCode,
      passwordHash,
      passwordSalt,
      shopifyCaptureDiscountId: promo?.id || null,
      shopifyPersonalDiscountId: null,
    },
  });
  await db.discountIssuance.create({
    data: {
      shop,
      code: captureCode,
      kind: "creator_promo",
      ownerType: "creator",
      ownerId: creator.id,
      percent: normalizedPercent,
      usageLimit: null,
      shopifyDiscountId: promo?.id || null,
      combinesWithJson: JSON.stringify({ arcade: true, creatorCommission: true }),
    },
  });
  await recordAudit(shop, "creator.created", { targetType: "creator", targetId: creator.id, captureCode, promoPercent: normalizedPercent, brandName: label });
  return creator;
}

export async function ensureCommercialDirectThread(commercial) {
  if (!commercial?.id || !commercial?.shop) return null;
  const existing = await db.chatThread.findFirst({
    where: { shop: commercial.shop, ownerType: "commercial", ownerId: commercial.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return db.chatThread.create({
    data: {
      shop: commercial.shop,
      subject: `${commercial.kind === "creator" ? "YouTuber" : "Comercial"} · ${commercial.brandName || commercial.name}`,
      channel: commercial.kind === "creator" ? "creator" : "commercial",
      ownerType: "commercial",
      ownerId: commercial.id,
      status: "open",
    },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
  });
}

export async function syncCreatorProductLink(shop, productGid, productHandle, familyName) {
  const gid = String(productGid || "").trim();
  if (!gid) return null;
  const familyKey = slugKey(familyName);
  const family = familyKey
    ? await db.lffFamily.findFirst({ where: { shop, OR: [{ familyKey }, { name: { equals: String(familyName || "").trim(), mode: "insensitive" } }] } })
    : null;
  if (!family?.creatorId) {
    await db.creatorProduct.deleteMany({ where: { shop, productGid: gid } }).catch(() => {});
    return null;
  }
  return db.creatorProduct.upsert({
    where: { shop_productGid: { shop, productGid: gid } },
    update: { creatorId: family.creatorId, productHandle: cleanText(productHandle, 180) || null, familyKey: family.familyKey },
    create: { shop, creatorId: family.creatorId, productGid: gid, productHandle: cleanText(productHandle, 180) || null, familyKey: family.familyKey },
  });
}

export async function syncFamilyProductsToCreator(admin, shop, family) {
  const familyKey = family?.familyKey || family?.key || "";
  if (!family?.name || !familyKey) return { scanned: 0, linked: 0 };
  const safeName = String(family.name).replace(/"/g, '\\"');
  const response = await admin.graphql(
    `#graphql
      query LffCreatorFamilyProducts($query: String!) {
        products(first: 250, query: $query) { nodes { id handle tags } }
      }`,
    { variables: { query: `tag:\"LFF_FAMILY:${safeName}\"` } },
  );
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  const products = payload.data?.products?.nodes || [];
  if (!family.creatorId) {
    if (products.length) await db.creatorProduct.deleteMany({ where: { shop, productGid: { in: products.map((p) => p.id) } } });
    await db.creatorProduct.deleteMany({ where: { shop, familyKey } });
    return { scanned: products.length, linked: 0 };
  }
  let linked = 0;
  for (const product of products) {
    await db.creatorProduct.upsert({
      where: { shop_productGid: { shop, productGid: product.id } },
      update: { creatorId: family.creatorId, productHandle: product.handle || null, familyKey },
      create: { shop, creatorId: family.creatorId, productGid: product.id, productHandle: product.handle || null, familyKey },
    });
    linked += 1;
  }
  return { scanned: products.length, linked };
}

function rawIp(request) {
  const headers = request.headers;
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ].filter(Boolean);
  return candidates.find((ip) => isIP(ip)) || "";
}

function isPublicIp(ip) {
  if (!ip || !isIP(ip)) return false;
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return false;
  if (/^10\./.test(ip) || /^127\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return false;
  const m = ip.match(/^172\.(\d+)\./); if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  return true;
}

function headerGeo(request) {
  const h = request.headers;
  const dec = (v) => { try { return decodeURIComponent(v || ""); } catch { return v || ""; } };
  const lat = Number(h.get("x-vercel-ip-latitude") || h.get("cf-iplatitude") || "");
  const lng = Number(h.get("x-vercel-ip-longitude") || h.get("cf-iplongitude") || "");
  return {
    countryCode: cleanText(h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || h.get("cloudfront-viewer-country"), 8) || null,
    country: cleanText(dec(h.get("x-vercel-ip-country")), 100) || null,
    region: cleanText(dec(h.get("x-vercel-ip-country-region") || h.get("cloudfront-viewer-country-region")), 120) || null,
    city: cleanText(dec(h.get("x-vercel-ip-city") || h.get("cloudfront-viewer-city")), 120) || null,
    latitude: Number.isFinite(lat) ? Math.round(lat * 10) / 10 : null,
    longitude: Number.isFinite(lng) ? Math.round(lng * 10) / 10 : null,
  };
}

async function externalGeo(ip) {
  if (!isPublicIp(ip)) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,region,city,latitude,longitude`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return {};
    const data = await res.json();
    if (!data?.success) return {};
    const lat = Number(data.latitude), lng = Number(data.longitude);
    return {
      countryCode: cleanText(data.country_code, 8) || null,
      country: cleanText(data.country, 100) || null,
      region: cleanText(data.region, 120) || null,
      city: cleanText(data.city, 120) || null,
      latitude: Number.isFinite(lat) ? Math.round(lat * 10) / 10 : null,
      longitude: Number.isFinite(lng) ? Math.round(lng * 10) / 10 : null,
    };
  } catch (_) {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export async function upsertTrafficPresence(request, shop, body, source) {
  const visitorId = cleanText(body.visitorId, 180);
  if (!visitorId) return null;
  const ip = rawIp(request);
  const hashSalt = process.env.LFF_GEO_HASH_SALT || process.env.SHOPIFY_API_SECRET || "lff-traffic";
  const ipHash = ip ? createHash("sha256").update(`${hashSalt}|${ip}`).digest("hex") : null;
  let geo = headerGeo(request);
  const existing = await db.trafficPresence.findUnique({ where: { shop_visitorId: { shop, visitorId } } });
  if ((geo.latitude == null || geo.longitude == null) && existing?.ipHash === ipHash && (existing.latitude != null || existing.countryCode)) {
    geo = { countryCode: existing.countryCode, country: existing.country, region: existing.region, city: existing.city, latitude: existing.latitude, longitude: existing.longitude };
  } else if ((geo.latitude == null || geo.longitude == null) && ipHash) {
    const cached = await db.trafficPresence.findFirst({ where: { shop, ipHash, latitude: { not: null } }, orderBy: { lastSeenAt: "desc" } });
    if (cached) geo = { countryCode: cached.countryCode, country: cached.country, region: cached.region, city: cached.city, latitude: cached.latitude, longitude: cached.longitude };
    else geo = { ...geo, ...(await externalGeo(ip)) };
  }
  const data = {
    sessionKey: cleanText(body.sessionKey, 180) || null,
    customerId: cleanText(body.customerId, 100) || null,
    source,
    sourceDetail: cleanText(body.sourceDetail, 180) || null,
    commercialCode: cleanText(body.commercialCode, 80) || null,
    companyId: cleanText(body.companyId, 100) || null,
    path: cleanText(body.path, 500) || null,
    referrer: cleanText(body.referrer, 1000) || null,
    ipHash,
    countryCode: geo.countryCode || null,
    country: geo.country || null,
    region: geo.region || null,
    city: geo.city || null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    userAgent: cleanText(request.headers.get("user-agent"), 500) || null,
    lastSeenAt: new Date(),
  };
  return db.trafficPresence.upsert({
    where: { shop_visitorId: { shop, visitorId } },
    update: data,
    create: { shop, visitorId, ...data },
  });
}
