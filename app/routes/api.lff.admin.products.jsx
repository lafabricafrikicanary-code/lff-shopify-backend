import { unauthenticated } from "../shopify.server";
import { requireAdminSession } from "../lib/api-auth.server";
import {
  assertAllowedOrigin,
  bodyData,
  corsHeaders,
  json,
} from "../lib/public-api.server";
import {
  buildLffProductTemplate,
  templateSummary,
  LFF_MODEL_PRICES,
} from "../lib/product-template.server";

const shopDomain = () => process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

function cleanTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 50);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

function tagSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function organizationalTags(category, family) {
  const tags = [];
  const c = String(category || "").trim();
  const f = String(family || "").trim();
  if (c) {
    tags.push(`LFF_CATEGORY:${c}`);
    const slug = tagSlug(c);
    if (slug) tags.push(slug);
  }
  if (f) {
    tags.push(`LFF_FAMILY:${f}`);
    const slug = tagSlug(f);
    if (slug) tags.push(slug);
  }
  return tags;
}

function taxonomyFromTags(tags = []) {
  const list = Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [];
  const categoryTag = list.find((tag) => /^LFF_CATEGORY:/i.test(tag)) || "";
  const familyTag = list.find((tag) => /^LFF_FAMILY:/i.test(tag)) || "";
  const category = categoryTag.replace(/^LFF_CATEGORY:/i, "").trim();
  const family = familyTag.replace(/^LFF_FAMILY:/i, "").trim();
  const generated = new Set(organizationalTags(category, family).map((tag) => tag.toLocaleLowerCase("es-ES")));
  const extraTags = list.filter((tag) => !generated.has(tag.toLocaleLowerCase("es-ES")) && !/^LFF_(CATEGORY|FAMILY):/i.test(tag));
  return { category, family, extraTags };
}

function stripCoverMarker(value) {
  const raw = String(value || "");
  if (!raw.startsWith("LFF_PORTADA::")) return raw;
  return raw.split("::").slice(3).join("::").trim();
}

function gqlErrors(payload, key, extraKey = "userErrors") {
  const root = payload?.data?.[key];
  const errors = [...(root?.[extraKey] || []), ...(payload?.errors || [])];
  if (errors.length) throw new Error(errors.map((entry) => entry.message || String(entry)).join("; "));
  return root;
}

async function adminClient() {
  const { admin } = await unauthenticated.admin(shopDomain());
  if (!admin) throw new Error("No hay sesión offline de Shopify disponible para esta tienda.");
  return admin;
}

function productPublic(node) {
  const preview = node?.featuredMedia?.preview?.image;
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    status: node.status,
    vendor: node.vendor,
    updatedAt: node.updatedAt,
    variantsCount: node.variantsCount?.count ?? 0,
    mediaCount: node.mediaCount?.count ?? 0,
    image: preview?.url || "",
    onlineStoreUrl: node.onlineStoreUrl || "",
  };
}

async function listProducts(admin) {
  const response = await admin.graphql(
    `#graphql
      query LffAdminProducts {
        products(first: 30, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id title handle status vendor updatedAt onlineStoreUrl
            variantsCount { count }
            mediaCount { count }
            featuredMedia { id preview { image { url altText } } }
          }
        }
      }`,
  );
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  return payload.data?.products?.nodes?.map(productPublic) || [];
}

async function getProductDetail(admin, productId) {
  const response = await admin.graphql(
    `#graphql
      query LffProductManagerDetail($id: ID!) {
        product(id: $id) {
          id title handle status vendor descriptionHtml tags onlineStoreUrl updatedAt
          variantsCount { count }
          mediaCount { count }
          options {
            id name position
            optionValues { id name hasVariants }
          }
          media(first: 250) {
            nodes {
              id alt mediaContentType status
              preview { image { url altText } }
            }
          }
        }
      }`,
    { variables: { id: productId } },
  );
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  const p = payload.data?.product;
  if (!p) throw new Error("Producto no encontrado.");
  const taxonomy = taxonomyFromTags(p.tags || []);
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    vendor: p.vendor,
    descriptionHtml: p.descriptionHtml,
    tags: p.tags || [],
    category: taxonomy.category,
    family: taxonomy.family,
    extraTags: taxonomy.extraTags,
    onlineStoreUrl: p.onlineStoreUrl,
    updatedAt: p.updatedAt,
    variantsCount: p.variantsCount?.count ?? 0,
    mediaCount: p.mediaCount?.count ?? 0,
    options: (p.options || []).map((option) => ({
      id: option.id,
      name: option.name,
      position: option.position,
      values: (option.optionValues || []).filter((v) => v.hasVariants).map((v) => ({ id: v.id, name: v.name })),
    })),
    media: (p.media?.nodes || []).map((media) => ({
      id: media.id,
      alt: media.alt || "",
      status: media.status,
      mediaContentType: media.mediaContentType,
      image: media.preview?.image?.url || "",
    })),
  };
}

async function createFromTemplate(admin, body) {
  const title = String(body.title || "").trim();
  if (title.length < 2) throw new Error("Escribe el nombre del nuevo artículo.");
  const category = String(body.category || "").trim();
  const family = String(body.family || "").trim();
  if (!category) throw new Error("Selecciona una categoría para el artículo.");
  if (!family) throw new Error("Selecciona una familia / universo para el artículo.");
  const tags = [...new Set([...organizationalTags(category, family), ...cleanTags(body.tags)])].slice(0, 50);
  const input = buildLffProductTemplate({
    title,
    skuPrefix: body.skuPrefix,
    vendor: body.vendor || "La Fábrica Friki",
    descriptionHtml: body.descriptionHtml || "",
    tags,
  });
  const response = await admin.graphql(
    `#graphql
      mutation LffCreateTemplateProduct($input: ProductSetInput!, $synchronous: Boolean!) {
        productSet(input: $input, synchronous: $synchronous) {
          product { id title handle status }
          productSetOperation { id status userErrors { field message code } }
          userErrors { field message code }
        }
      }`,
    { variables: { input, synchronous: false } },
  );
  const payload = await response.json();
  const result = gqlErrors(payload, "productSet");
  const opErrors = result?.productSetOperation?.userErrors || [];
  if (opErrors.length) throw new Error(opErrors.map((e) => e.message).join("; "));
  return {
    operationId: result?.productSetOperation?.id || "",
    status: result?.productSetOperation?.status || (result?.product ? "COMPLETE" : "CREATED"),
    product: result?.product || null,
  };
}

async function operationStatus(admin, operationId) {
  if (!operationId) throw new Error("Falta el identificador de la operación.");
  const response = await admin.graphql(
    `#graphql
      query LffProductSetOperation($id: ID!) {
        productOperation(id: $id) {
          ... on ProductSetOperation {
            id status
            product { id title handle status }
            userErrors { field message code }
          }
        }
      }`,
    { variables: { id: operationId } },
  );
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  const op = payload.data?.productOperation;
  if (!op) throw new Error("Shopify ya no encuentra esa operación.");
  return { id: op.id, status: op.status, product: op.product || null, errors: op.userErrors || [] };
}


async function updateProductDetails(admin, body) {
  const productId = String(body.productId || "").trim();
  const title = String(body.title || "").trim();
  const category = String(body.category || "").trim();
  const family = String(body.family || "").trim();
  if (!productId) throw new Error("Falta el producto.");
  if (title.length < 2) throw new Error("Escribe un nombre válido para el artículo.");
  if (!category) throw new Error("Selecciona una categoría.");
  if (!family) throw new Error("Selecciona una familia / universo.");
  const tags = [...new Set([...organizationalTags(category, family), ...cleanTags(body.tags)])].slice(0, 50);
  const product = {
    id: productId,
    title: title.slice(0, 255),
    descriptionHtml: String(body.descriptionHtml || "").slice(0, 100000),
    tags,
  };
  const response = await admin.graphql(
    `#graphql
      mutation LffUpdateProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id title handle status tags descriptionHtml updatedAt }
          userErrors { field message }
        }
      }`,
    { variables: { product } },
  );
  const payload = await response.json();
  gqlErrors(payload, "productUpdate");
  return getProductDetail(admin, productId);
}

async function setExistingMediaCover(admin, body) {
  const productId = String(body.productId || "").trim();
  const mediaId = String(body.mediaId || "").trim();
  const model = String(body.model || "").trim();
  const color = String(body.color || "").trim();
  if (!productId || !mediaId) throw new Error("Selecciona un producto y una imagen.");
  if (!model || !color) throw new Error("Selecciona Modelo y Color antes de marcar la portada.");

  const product = await getProductDetail(admin, productId);
  const selected = (product.media || []).find((media) => media.id === mediaId && media.mediaContentType === "IMAGE");
  if (!selected) throw new Error("La imagen seleccionada no pertenece a este producto.");

  const updates = [];
  for (const media of product.media || []) {
    if (media.mediaContentType !== "IMAGE") continue;
    const wasCover = String(media.alt || "").startsWith("LFF_PORTADA::");
    if (media.id === mediaId) {
      const clean = stripCoverMarker(media.alt) || `${product.title} · ${model} · ${color}`;
      updates.push({ id: media.id, alt: `LFF_PORTADA::${model}::${color}::${clean}`.slice(0, 512) });
    } else if (wasCover) {
      updates.push({ id: media.id, alt: stripCoverMarker(media.alt).slice(0, 512) });
    }
  }
  if (!updates.length) throw new Error("No se pudo preparar la portada.");

  // productUpdateMedia sigue disponible en Admin API 2026-07 y solo requiere write_products.
  // Se usa aquí para evitar pedir un scope write_files adicional únicamente para cambiar alt text.
  const response = await admin.graphql(
    `#graphql
      mutation LffSetProductCover($productId: ID!, $media: [UpdateMediaInput!]!) {
        productUpdateMedia(productId: $productId, media: $media) {
          media { id alt status }
          mediaUserErrors { field message code }
        }
      }`,
    { variables: { productId, media: updates } },
  );
  const payload = await response.json();
  const result = gqlErrors(payload, "productUpdateMedia", "mediaUserErrors");
  return {
    cover: (result.media || []).find((media) => media.id === mediaId) || null,
    product: await getProductDetail(admin, productId),
  };
}

async function deleteProduct(admin, productId) {
  const id = String(productId || "").trim();
  if (!id) throw new Error("Falta el producto a eliminar.");
  const response = await admin.graphql(
    `#graphql
      mutation LffDeleteProduct($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors { field message }
        }
      }`,
    { variables: { input: { id } } },
  );
  const payload = await response.json();
  const result = gqlErrors(payload, "productDelete");
  if (!result.deletedProductId) throw new Error("Shopify no confirmó la eliminación del producto.");
  return { deletedProductId: result.deletedProductId };
}

async function setProductStatus(admin, productId, status) {
  const normalized = String(status || "DRAFT").toUpperCase();
  if (!new Set(["DRAFT", "ACTIVE", "ARCHIVED", "UNLISTED"]).has(normalized)) throw new Error("Estado de producto no válido.");
  const response = await admin.graphql(
    `#graphql
      mutation LffSetProductStatus($id: ID!, $input: ProductSetInput!) {
        productSet(identifier: { id: $id }, input: $input, synchronous: true) {
          product { id title handle status onlineStoreUrl }
          userErrors { field message code }
        }
      }`,
    { variables: { id: productId, input: { status: normalized } } },
  );
  const payload = await response.json();
  const result = gqlErrors(payload, "productSet");
  return result.product;
}

async function publishOnlineStore(admin, productId) {
  await setProductStatus(admin, productId, "ACTIVE");
  const pubsResponse = await admin.graphql(
    `#graphql
      query LffPublications {
        publications(first: 50) { nodes { id name autoPublish } }
      }`,
  );
  const pubsPayload = await pubsResponse.json();
  if (pubsPayload.errors?.length) throw new Error(pubsPayload.errors.map((e) => e.message).join("; "));
  const publications = pubsPayload.data?.publications?.nodes || [];
  const online = publications.find((p) => /online store|tienda online/i.test(p.name)) || publications[0];
  if (!online) throw new Error("No se encontró una publicación/canal donde publicar el producto.");
  const response = await admin.graphql(
    `#graphql
      mutation LffPublishProduct($id: ID!, $publicationId: ID!) {
        publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
          publishable { publishedOnPublication(publicationId: $publicationId) }
          userErrors { field message }
        }
      }`,
    { variables: { id: productId, publicationId: online.id } },
  );
  const payload = await response.json();
  const result = gqlErrors(payload, "publishablePublish");
  return { publication: online, published: Boolean(result.publishable?.publishedOnPublication) };
}

async function uploadProductImage(admin, formData) {
  const productId = String(formData.get("productId") || "");
  const alt = String(formData.get("alt") || "").slice(0, 512);
  const file = formData.get("file");
  if (!productId) throw new Error("Selecciona primero un producto.");
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) throw new Error("Selecciona una imagen.");
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Formato no admitido. Usa JPG, PNG, WebP, GIF o AVIF.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("La imagen supera el máximo de 20 MB.");

  const stagedResponse = await admin.graphql(
    `#graphql
      mutation LffStagedImage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    { variables: { input: [{ filename: file.name || "lff-product-image.jpg", mimeType: file.type, resource: "PRODUCT_IMAGE", httpMethod: "POST" }] } },
  );
  const stagedPayload = await stagedResponse.json();
  const staged = gqlErrors(stagedPayload, "stagedUploadsCreate");
  const target = staged.stagedTargets?.[0];
  if (!target) throw new Error("Shopify no devolvió un destino para la imagen.");

  const upload = new FormData();
  for (const item of target.parameters || []) upload.append(item.name, item.value);
  upload.append("file", file, file.name || "lff-product-image.jpg");
  const transfer = await fetch(target.url, { method: "POST", body: upload });
  if (!transfer.ok) throw new Error(`Shopify no pudo recibir la imagen (HTTP ${transfer.status}).`);

  const mediaResponse = await admin.graphql(
    `#graphql
      mutation LffAttachProductImage($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            id alt mediaContentType status
            preview { image { url altText } }
          }
          mediaUserErrors { field message code }
        }
      }`,
    { variables: { productId, media: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE", alt }] } },
  );
  const mediaPayload = await mediaResponse.json();
  const result = gqlErrors(mediaPayload, "productCreateMedia", "mediaUserErrors");
  const media = result.media?.[0];
  if (!media) throw new Error("La imagen se subió, pero Shopify todavía no la ha adjuntado al producto.");
  return {
    id: media.id,
    alt: media.alt || alt,
    status: media.status,
    image: media.preview?.image?.url || "",
    mediaContentType: media.mediaContentType,
  };
}

async function variantsMatching(admin, productId, model, color) {
  const matches = [];
  let cursor = null;
  let more = true;
  while (more) {
    const response = await admin.graphql(
      `#graphql
        query LffVariantsForMedia($id: ID!, $after: String) {
          product(id: $id) {
            variants(first: 250, after: $after) {
              nodes { id selectedOptions { name value } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
      { variables: { id: productId, after: cursor } },
    );
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
    const connection = payload.data?.product?.variants;
    if (!connection) throw new Error("Producto no encontrado.");
    for (const variant of connection.nodes || []) {
      const map = Object.fromEntries((variant.selectedOptions || []).map((entry) => [entry.name.toLocaleLowerCase("es-ES"), entry.value]));
      if (String(map.modelo || "") === model && String(map.color || "") === color) matches.push(variant.id);
    }
    more = Boolean(connection.pageInfo?.hasNextPage);
    cursor = connection.pageInfo?.endCursor || null;
  }
  return matches;
}


async function applyTemplatePrices(admin, productId) {
  const updates = [];
  let cursor = null;
  let more = true;
  while (more) {
    const response = await admin.graphql(
      `#graphql
        query LffVariantsForPrices($id: ID!, $after: String) {
          product(id: $id) {
            variants(first: 250, after: $after) {
              nodes { id price selectedOptions { name value } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
      { variables: { id: productId, after: cursor } },
    );
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
    const connection = payload.data?.product?.variants;
    if (!connection) throw new Error("Producto no encontrado.");
    for (const variant of connection.nodes || []) {
      const model = (variant.selectedOptions || []).find((entry) => entry.name.toLocaleLowerCase("es-ES") === "modelo")?.value;
      const price = LFF_MODEL_PRICES[model];
      if (price && Number(variant.price) !== Number(price)) updates.push({ id: variant.id, price });
    }
    more = Boolean(connection.pageInfo?.hasNextPage);
    cursor = connection.pageInfo?.endCursor || null;
  }
  for (let i = 0; i < updates.length; i += 100) {
    const variants = updates.slice(i, i + 100);
    const response = await admin.graphql(
      `#graphql
        mutation LffApplyTemplatePrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
            product { id }
            userErrors { field message }
          }
        }`,
      { variables: { productId, variants } },
    );
    const payload = await response.json();
    gqlErrors(payload, "productVariantsBulkUpdate");
  }
  return { updated: updates.length };
}

async function assignMedia(admin, body) {
  const productId = String(body.productId || "");
  const mediaId = String(body.mediaId || "");
  const model = String(body.model || "");
  const color = String(body.color || "");
  if (!productId || !mediaId || !model || !color) throw new Error("Faltan producto, imagen, modelo o color.");
  const ids = await variantsMatching(admin, productId, model, color);
  if (!ids.length) throw new Error(`No hay variantes para ${model} · ${color}.`);
  for (let i = 0; i < ids.length; i += 100) {
    const variants = ids.slice(i, i + 100).map((id) => ({ id, mediaId }));
    const response = await admin.graphql(
      `#graphql
        mutation LffAssignMediaToVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
            product { id }
            productVariants { id }
            userErrors { field message }
          }
        }`,
      { variables: { productId, variants } },
    );
    const payload = await response.json();
    gqlErrors(payload, "productVariantsBulkUpdate");
  }
  return { assigned: ids.length };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    await requireAdminSession(request);
    const admin = await adminClient();
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    if (productId) return json(request, { ok: true, product: await getProductDetail(admin, productId), template: templateSummary() });
    return json(request, { ok: true, products: await listProducts(admin), template: templateSummary() });
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: /sesión|autoriz/i.test(error.message) ? 401 : 400 });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const adminAuth = await requireAdminSession(request);
    const admin = await adminClient();
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = String(formData.get("intent") || "upload-media");
      if (intent !== "upload-media") throw new Error("Acción multipart no reconocida.");
      return json(request, { ok: true, media: await uploadProductImage(admin, formData) });
    }

    const body = await bodyData(request);
    const intent = String(body.intent || "");
    if (intent === "create-template") return json(request, { ok: true, ...(await createFromTemplate(admin, body)), template: templateSummary() });
    if (intent === "operation-status") return json(request, { ok: true, operation: await operationStatus(admin, body.operationId) });
    if (intent === "product-detail") return json(request, { ok: true, product: await getProductDetail(admin, body.productId), template: templateSummary() });
    if (intent === "assign-media") return json(request, { ok: true, ...(await assignMedia(admin, body)) });
    if (intent === "set-cover") return json(request, { ok: true, ...(await setExistingMediaCover(admin, body)) });
    if (intent === "update-product") return json(request, { ok: true, product: await updateProductDetails(admin, body) });
    if (intent === "apply-template-prices") return json(request, { ok: true, ...(await applyTemplatePrices(admin, body.productId)) });
    if (intent === "set-status") return json(request, { ok: true, product: await setProductStatus(admin, body.productId, body.status) });
    if (intent === "publish-online-store") return json(request, { ok: true, ...(await publishOnlineStore(admin, body.productId)) });
    if (intent === "delete-product") {
      const username = String(adminAuth?.user?.username || "").toLocaleLowerCase("es-ES");
      const role = String(adminAuth?.user?.role || "").toLocaleLowerCase("es-ES");
      const canDelete = username === "alejandro" || username === "gabriel" || role === "owner";
      if (!canDelete) throw new Error("Solo Alejandro o Gabriel pueden eliminar productos.");
      return json(request, { ok: true, ...(await deleteProduct(admin, body.productId)) });
    }
    throw new Error("Acción de producto no reconocida.");
  } catch (error) {
    console.error("[LFF PRODUCT ADMIN]", error);
    return json(request, { ok: false, error: error.message }, { status: /sesión|autoriz/i.test(error.message) ? 401 : 400 });
  }
};
