const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

function gqlRoot(payload, key) {
  const root = payload?.data?.[key];
  const errors = [...(root?.userErrors || []), ...(payload?.errors || [])];
  if (errors.length) throw new Error(errors.map((entry) => entry.message || String(entry)).join("; "));
  return root;
}

function safeFilename(value, fallback = "lff-image.png") {
  const cleaned = String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
  return cleaned || fallback;
}

async function waitForFileUrl(admin, fileId) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const response = await admin.graphql(
      `#graphql
        query LffV90File($id: ID!) {
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
  throw new Error("La imagen se subió, pero Shopify todavía la está procesando.");
}

export async function uploadImageToShopifyFiles(admin, { bytes, mimeType, filename, alt, maxBytes = 5 * 1024 * 1024 }) {
  if (!admin) throw new Error("No hay cliente Admin de Shopify disponible.");
  if (!IMAGE_TYPES.has(String(mimeType || ""))) throw new Error("Formato de imagen no admitido.");
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) throw new Error("La imagen está vacía.");
  if (buffer.length > maxBytes) throw new Error(`La imagen supera el máximo de ${Math.round(maxBytes / 1024 / 1024)} MB.`);

  const name = safeFilename(filename);
  const stagedResponse = await admin.graphql(
    `#graphql
      mutation LffV90StagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    { variables: { input: [{ filename: name, mimeType, resource: "SHOP_IMAGE", httpMethod: "POST" }] } },
  );
  const stagedPayload = await stagedResponse.json();
  const staged = gqlRoot(stagedPayload, "stagedUploadsCreate");
  const target = staged?.stagedTargets?.[0];
  if (!target) throw new Error("Shopify no devolvió un destino para la imagen.");

  const form = new FormData();
  for (const item of target.parameters || []) form.append(item.name, item.value);
  form.append("file", new Blob([buffer], { type: mimeType }), name);
  const transfer = await fetch(target.url, { method: "POST", body: form });
  if (!transfer.ok) throw new Error(`Shopify no pudo recibir la imagen (HTTP ${transfer.status}).`);

  const createResponse = await admin.graphql(
    `#graphql
      mutation LffV90FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id fileStatus alt
            ... on MediaImage { image { url width height } }
          }
          userErrors { field message code }
        }
      }`,
    { variables: { files: [{ alt: String(alt || "Archivo LFF").slice(0, 255), contentType: "IMAGE", originalSource: target.resourceUrl }] } },
  );
  const createPayload = await createResponse.json();
  const created = gqlRoot(createPayload, "fileCreate");
  const media = created?.files?.[0];
  if (!media?.id) throw new Error("Shopify no confirmó la creación del archivo.");
  if (media.image?.url) return { id: media.id, url: media.image.url, status: media.fileStatus || "READY" };
  return waitForFileUrl(admin, media.id);
}

export async function uploadDataUrlToShopifyFiles(admin, dataUrl, options = {}) {
  const raw = String(dataUrl || "");
  if (!raw) return null;
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) throw new Error("La imagen adjunta no tiene un formato válido.");
  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1].replace("+xml", "");
  return uploadImageToShopifyFiles(admin, {
    bytes,
    mimeType,
    filename: options.filename || `lff-upload-${Date.now()}.${ext}`,
    alt: options.alt || "Archivo LFF",
    maxBytes: options.maxBytes,
  });
}

export async function uploadFileObjectToShopifyFiles(admin, file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size) return null;
  return uploadImageToShopifyFiles(admin, {
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
    filename: file.name || options.filename || `lff-upload-${Date.now()}.png`,
    alt: options.alt || "Archivo LFF",
    maxBytes: options.maxBytes,
  });
}
