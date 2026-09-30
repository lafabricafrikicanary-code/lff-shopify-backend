import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { requireAdminSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";
import {
  ensureCategory,
  listCategories,
  normalizeCategoryState,
  slugKey,
  syncFamilyProductsToCreator,
} from "../lib/lff-v91.server";

const shopDomain = () => process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function slug(value) {
  return slugKey(value);
}

async function cleanCategory(value) {
  const row = await ensureCategory(shopDomain(), value);
  return row.name;
}

function cleanAliases(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 30);
}

function familyPublic(row) {
  let aliases = [];
  try { aliases = JSON.parse(row.aliasesJson || "[]"); } catch (_) {}
  return {
    id: row.id,
    key: row.familyKey,
    category: row.category,
    name: row.name,
    order: row.sortOrder,
    enabled: row.enabled,
    isCustom: row.isCustom,
    aliases,
    logoFileId: row.logoFileId || "",
    logoUrl: row.logoUrl || "",
    motionFileId: row.motionFileId || "",
    motionUrl: row.motionUrl || "",
    creatorId: row.creatorId || "",
    creator: row.creator ? { id: row.creator.id, name: row.creator.name, brandName: row.creator.brandName || "", kind: row.creator.kind || "commercial", status: row.creator.status } : null,
    updatedAt: row.updatedAt,
  };
}

async function listFamilies() {
  const rows = await db.lffFamily.findMany({
    where: { shop: shopDomain() },
    include: { creator: { select: { id: true, name: true, brandName: true, kind: true, status: true } } },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(familyPublic);
}

async function saveFamily(body, actor = "Admin") {
  const name = String(body.name || "").trim();
  if (name.length < 2) throw new Error("Escribe el nombre de la familia.");
  const category = await cleanCategory(body.category);
  const familyKey = slug(body.familyKey || name);
  if (!familyKey) throw new Error("No se pudo generar el identificador de la familia.");
  const sortOrder = Math.max(1, Math.min(9999, Number(body.order || 999) || 999));
  const enabled = body.enabled === false || body.enabled === "false" ? false : true;
  const isCustom = body.isCustom === true || body.isCustom === "true";
  const aliases = cleanAliases(body.aliases);
  const shop = shopDomain();
  const creatorId = String(body.creatorId || "").trim() || null;
  if (creatorId) {
    const creator = await db.commercialUser.findFirst({ where: { id: creatorId, shop, kind: "creator", status: { not: "disabled" } } });
    if (!creator) throw new Error("El YouTuber seleccionado no existe o no está disponible.");
  }
  const row = await db.lffFamily.upsert({
    where: { shop_familyKey: { shop, familyKey } },
    update: {
      category,
      name: name.slice(0, 180),
      sortOrder,
      enabled,
      isCustom,
      aliasesJson: JSON.stringify(aliases),
      creatorId,
    },
    create: {
      shop,
      familyKey,
      category,
      name: name.slice(0, 180),
      sortOrder,
      enabled,
      isCustom,
      aliasesJson: JSON.stringify(aliases),
      creatorId,
    },
    include: { creator: { select: { id: true, name: true, brandName: true, kind: true, status: true } } },
  });
  await recordAudit(shop, "family.saved", {
    actor,
    targetType: "family",
    targetId: row.id,
    familyKey,
    category,
    name,
    sortOrder,
    enabled,
    creatorId,
  }).catch(() => {});
  return familyPublic(row);
}

async function disableFamily(body, actor = "Admin") {
  const familyKey = slug(body.familyKey);
  if (!familyKey) throw new Error("Falta la familia.");
  const shop = shopDomain();
  const existing = await db.lffFamily.findUnique({ where: { shop_familyKey: { shop, familyKey } } });
  const name = String(body.name || existing?.name || familyKey).trim();
  const category = await cleanCategory(body.category || existing?.category || "Multiusos");
  const sortOrder = Math.max(1, Math.min(9999, Number(body.order || existing?.sortOrder || 999) || 999));
  const row = await db.lffFamily.upsert({
    where: { shop_familyKey: { shop, familyKey } },
    update: { enabled: false },
    create: {
      shop,
      familyKey,
      category,
      name,
      sortOrder,
      enabled: false,
      isCustom: Boolean(body.isCustom),
      aliasesJson: JSON.stringify(cleanAliases(body.aliases)),
    },
  });
  await recordAudit(shop, "family.disabled", { actor, targetType: "family", targetId: row.id, familyKey }).catch(() => {});
  return familyPublic(row);
}

async function batchOrder(body, actor = "Admin") {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error("No hay familias para reordenar.");
  const shop = shopDomain();
  const prepared = [];
  for (const item of items.slice(0, 250)) {
    prepared.push({ ...item, cleanCategory: await cleanCategory(item.category) });
  }
  await db.$transaction(prepared.map((item) => {
    const familyKey = slug(item.familyKey);
    const order = Math.max(1, Math.min(9999, Number(item.order || 999) || 999));
    return db.lffFamily.upsert({
      where: { shop_familyKey: { shop, familyKey } },
      update: { sortOrder: order },
      create: {
        shop,
        familyKey,
        category: item.cleanCategory,
        name: String(item.name || familyKey).slice(0, 180),
        sortOrder: order,
        enabled: true,
        isCustom: Boolean(item.isCustom),
        aliasesJson: JSON.stringify(cleanAliases(item.aliases)),
      },
    });
  }));
  await recordAudit(shop, "family.reordered", { actor, targetType: "family", targetId: "batch", count: items.length }).catch(() => {});
  return listFamilies();
}

function gqlRoot(payload, key, errorKey = "userErrors") {
  const root = payload?.data?.[key];
  const errors = [...(root?.[errorKey] || []), ...(payload?.errors || [])];
  if (errors.length) throw new Error(errors.map((entry) => entry.message || String(entry)).join("; "));
  return root;
}

async function adminClient() {
  const { admin } = await unauthenticated.admin(shopDomain());
  if (!admin) throw new Error("No hay sesión offline de Shopify disponible para esta tienda.");
  return admin;
}

async function waitForFileUrl(admin, fileId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await admin.graphql(
      `#graphql
        query LffFamilyFile($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              id fileStatus alt image { url width height }
            }
          }
        }`,
      { variables: { id: fileId } },
    );
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
    const node = payload.data?.node;
    if (node?.image?.url) return { id: node.id, url: node.image.url, status: node.fileStatus || "READY" };
    if (node?.fileStatus === "FAILED") throw new Error("Shopify no pudo procesar la imagen.");
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("La imagen se subió, pero Shopify todavía la está procesando. Inténtalo de nuevo en unos segundos.");
}

async function uploadShopImage(admin, file, alt) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new Error("Selecciona una imagen.");
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Formato no admitido. Usa JPG, PNG, WebP, GIF o AVIF.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("La imagen supera el máximo de 20 MB.");
  const stagedResponse = await admin.graphql(
    `#graphql
      mutation LffFamilyStagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    { variables: { input: [{ filename: file.name || "lff-family-image.png", mimeType: file.type, resource: "SHOP_IMAGE", httpMethod: "POST" }] } },
  );
  const stagedPayload = await stagedResponse.json();
  const staged = gqlRoot(stagedPayload, "stagedUploadsCreate");
  const target = staged?.stagedTargets?.[0];
  if (!target) throw new Error("Shopify no devolvió un destino para la imagen.");
  const upload = new FormData();
  for (const item of target.parameters || []) upload.append(item.name, item.value);
  upload.append("file", file, file.name || "lff-family-image.png");
  const transfer = await fetch(target.url, { method: "POST", body: upload });
  if (!transfer.ok) throw new Error(`Shopify no pudo recibir la imagen (HTTP ${transfer.status}).`);

  const createResponse = await admin.graphql(
    `#graphql
      mutation LffFamilyFileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id fileStatus alt
            ... on MediaImage { image { url width height } }
          }
          userErrors { field message code }
        }
      }`,
    { variables: { files: [{ alt: String(alt || "Imagen de familia LFF").slice(0, 255), contentType: "IMAGE", originalSource: target.resourceUrl }] } },
  );
  const createPayload = await createResponse.json();
  const created = gqlRoot(createPayload, "fileCreate");
  const media = created?.files?.[0];
  if (!media?.id) throw new Error("Shopify no confirmó la creación del archivo.");
  if (media.image?.url) return { id: media.id, url: media.image.url, status: media.fileStatus || "READY" };
  return waitForFileUrl(admin, media.id);
}

async function uploadFamilyFile(admin, formData, actor = "Admin") {
  const name = String(formData.get("name") || "").trim();
  const category = await cleanCategory(formData.get("category"));
  const familyKey = slug(formData.get("familyKey") || name);
  const kind = String(formData.get("kind") || "logo");
  if (!new Set(["logo", "motion"]).has(kind)) throw new Error("Tipo de imagen no válido.");
  if (!familyKey || name.length < 2) throw new Error("Selecciona una familia válida.");
  const file = formData.get("file");
  const adminSaved = await saveFamily({
    familyKey,
    name,
    category,
    order: formData.get("order") || 999,
    aliases: formData.get("aliases") || "",
    isCustom: formData.get("isCustom") === "true",
    enabled: formData.get("enabled") !== "false",
    creatorId: formData.get("creatorId") || "",
  }, actor);
  const uploaded = await uploadShopImage(admin, file, `${name} · ${kind === "logo" ? "logo" : "imagen movimiento"} · La Fábrica Friki`);
  const shop = shopDomain();
  const row = await db.lffFamily.update({
    where: { shop_familyKey: { shop, familyKey } },
    data: kind === "logo"
      ? { logoFileId: uploaded.id, logoUrl: uploaded.url }
      : { motionFileId: uploaded.id, motionUrl: uploaded.url },
  });
  await recordAudit(shop, "family.file_uploaded", { actor, targetType: "family", targetId: row.id, familyKey, kind }).catch(() => {});
  return { family: familyPublic(row), uploaded, saved: adminSaved };
}

function publicJson(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    const shop = shopDomain();
    return publicJson({ ok: true, families: await listFamilies(), categories: (await listCategories(shop)).map((c) => ({ id: c.id, key: c.categoryKey, name: c.name, order: c.sortOrder, state: c.state, isCustom: c.isCustom })) });
  } catch (error) {
    console.error("[LFF FAMILIES PUBLIC]", error);
    return publicJson({ ok: false, error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const auth = await requireAdminSession(request);
    if (String(auth?.user?.role || "").toLowerCase() !== "owner") {
      throw new Error("Solo Alejandro puede gestionar familias y universos.");
    }
    const actor = auth?.user?.displayName || auth?.user?.username || "Admin";
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      if (String(formData.get("intent") || "") !== "upload-family-file") throw new Error("Acción de archivo no reconocida.");
      const admin = await adminClient();
      return json(request, { ok: true, ...(await uploadFamilyFile(admin, formData, actor)) });
    }
    const body = await bodyData(request);
    const intent = String(body.intent || "");
    const shop = shopDomain();
    const categoriesPayload = async () => (await listCategories(shop)).map((c) => ({ id: c.id, key: c.categoryKey, name: c.name, order: c.sortOrder, state: c.state, isCustom: c.isCustom }));
    if (intent === "list") return json(request, { ok: true, families: await listFamilies(), categories: await categoriesPayload(), creators: (await db.commercialUser.findMany({ where: { shop, kind: "creator" }, orderBy: { name: "asc" } })).map((c) => ({ id: c.id, name: c.name, brandName: c.brandName || c.name, status: c.status, captureCode: c.captureCode })) });
    if (intent === "save") {
      const family = await saveFamily(body, actor);
      const admin = await adminClient();
      const sync = await syncFamilyProductsToCreator(admin, shop, family).catch((error) => ({ error: error.message, scanned: 0, linked: 0 }));
      return json(request, { ok: true, family, sync, families: await listFamilies(), categories: await categoriesPayload() });
    }
    if (intent === "disable") return json(request, { ok: true, family: await disableFamily(body, actor), families: await listFamilies(), categories: await categoriesPayload() });
    if (intent === "reorder") return json(request, { ok: true, families: await batchOrder(body, actor), categories: await categoriesPayload() });
    if (intent === "category-save") {
      const name = String(body.name || "").trim();
      if (name.length < 2) throw new Error("Escribe un nombre de categoría válido.");
      const categoryKey = slug(body.key || name);
      const state = normalizeCategoryState(body.state || "preparation");
      const sortOrder = Math.max(1, Math.min(9999, Number(body.order || 999) || 999));
      const existing = await db.lffCategory.findFirst({ where: { shop, OR: [{ categoryKey }, { name: { equals: name, mode: "insensitive" } }] } });
      const category = existing
        ? await db.lffCategory.update({ where: { id: existing.id }, data: { name: name.slice(0, 100), sortOrder, state } })
        : await db.lffCategory.create({ data: { shop, categoryKey, name: name.slice(0, 100), sortOrder, state, isCustom: true } });
      await recordAudit(shop, "category.saved", { actor, targetType: "category", targetId: category.id, name: category.name, state });
      return json(request, { ok: true, category: { id: category.id, key: category.categoryKey, name: category.name, order: category.sortOrder, state: category.state, isCustom: category.isCustom }, categories: await categoriesPayload() });
    }
    if (intent === "category-state") {
      const category = await db.lffCategory.findFirst({ where: { shop, OR: [{ id: String(body.categoryId || "") }, { categoryKey: slug(body.key || body.name) }] } });
      if (!category) throw new Error("No se encontró la categoría.");
      const state = normalizeCategoryState(body.state);
      const updated = await db.lffCategory.update({ where: { id: category.id }, data: { state } });
      await recordAudit(shop, "category.state_changed", { actor, targetType: "category", targetId: category.id, state });
      return json(request, { ok: true, category: { id: updated.id, key: updated.categoryKey, name: updated.name, order: updated.sortOrder, state: updated.state, isCustom: updated.isCustom }, categories: await categoriesPayload() });
    }
    throw new Error("Acción de familias/categorías no reconocida.");
  } catch (error) {
    console.error("[LFF FAMILY ADMIN]", error);
    const status = /sesión|autoriz/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
