import fs from "node:fs";
import path from "node:path";
import { requireAdminSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, corsHeaders, json } from "../lib/public-api.server";

const LIB_DIR = path.join(process.cwd(), "app", "mockup-library");
const MANIFEST_PATH = path.join(LIB_DIR, "manifest.json");
const MUG_LIB_DIR = path.join(process.cwd(), "app", "mug-mockup-library");
const MUG_MANIFEST_PATH = path.join(MUG_LIB_DIR, "manifest.json");
let manifestCache = null;
let mugManifestCache = null;
let packCache = null;

let packPartMetaCache = null;

function packPartMeta() {
  if (packPartMetaCache) return packPartMetaCache;
  let cursor = 0;
  packPartMetaCache = (Array.isArray(manifest().packParts) ? manifest().packParts : []).map((name) => {
    const filePath = path.join(LIB_DIR, name);
    const size = fs.statSync(filePath).size;
    const row = { name, filePath, start: cursor, end: cursor + size, size };
    cursor += size;
    return row;
  });
  return packPartMetaCache;
}

function readPackRange(offset, length) {
  const start = Number(offset || 0);
  const size = Number(length || 0);
  const end = start + size;
  if (!Number.isFinite(start) || !Number.isFinite(size) || start < 0 || size <= 0) throw new Error("Rango de mockup no válido.");
  const chunks = [];
  let readBytes = 0;
  for (const part of packPartMeta()) {
    const overlapStart = Math.max(start, part.start);
    const overlapEnd = Math.min(end, part.end);
    if (overlapEnd <= overlapStart) continue;
    const bytes = overlapEnd - overlapStart;
    const buffer = Buffer.allocUnsafe(bytes);
    const fd = fs.openSync(part.filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, bytes, overlapStart - part.start);
    } finally {
      fs.closeSync(fd);
    }
    chunks.push(buffer);
    readBytes += bytes;
  }
  if (readBytes !== size) throw new Error("La biblioteca de mockups está incompleta.");
  return Buffer.concat(chunks, size);
}

function manifest() {
  if (!manifestCache) manifestCache = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  return manifestCache;
}

function mugManifest() {
  if (!mugManifestCache) mugManifestCache = JSON.parse(fs.readFileSync(MUG_MANIFEST_PATH, "utf8"));
  return mugManifestCache;
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    await requireAdminSession(request);
    const url = new URL(request.url);
    const mode = String(url.searchParams.get("mode") || "manifest");
    if (mode === "manifest") return json(request, { ok: true, library: manifest() });
    if (mode === "mug-manifest") return json(request, { ok: true, library: mugManifest() });
    if (mode === "mug-template") {
      const templateId = String(url.searchParams.get("id") || "").trim();
      const template = (mugManifest().templates || []).find((item) => String(item?.id || "") === templateId);
      if (!template) throw new Error("Mockup de taza no encontrado.");
      const fileName = String(template.file || "");
      const filePath = path.join(MUG_LIB_DIR, fileName);
      if (!fileName || path.dirname(filePath) !== MUG_LIB_DIR || !fs.existsSync(filePath)) throw new Error("La plantilla de taza está incompleta.");
      const bytes = fs.readFileSync(filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          ...corsHeaders(request),
          "Content-Type": "image/png",
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": `inline; filename="${template.id || "mug"}.png"`,
        },
      });
    }
    if (mode === "template") {
      const templateId = String(url.searchParams.get("id") || "").trim();
      const template = (manifest().templates || []).find((item) => String(item?.id || "") === templateId);
      if (!template) throw new Error("Mockup de previsualización no encontrado.");
      const bytes = readPackRange(template.offset, template.length);
      return new Response(bytes, {
        status: 200,
        headers: {
          ...corsHeaders(request),
          "Content-Type": template.mime || "image/jpeg",
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": `inline; filename="${template.id || "mockup"}.jpg"`,
        },
      });
    }
    if (mode === "pack") {
      if (!packCache) {
        const parts = Array.isArray(manifest().packParts) ? manifest().packParts : [];
        if (!parts.length) throw new Error("La biblioteca de mockups no tiene paquetes configurados.");
        packCache = Buffer.concat(parts.map((name) => fs.readFileSync(path.join(LIB_DIR, name))));
        if (Number(manifest().packBytes || 0) && packCache.length !== Number(manifest().packBytes)) throw new Error("La biblioteca de mockups está incompleta.");
      }
      return new Response(packCache, {
        status: 200,
        headers: {
          ...corsHeaders(request),
          "Content-Type": "application/octet-stream",
          "Content-Length": String(packCache.length),
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": 'inline; filename="lff-mockups-v12.pack"',
        },
      });
    }
    throw new Error("Modo de biblioteca no válido.");
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: /sesión|autoriz/i.test(error.message) ? 401 : 400 });
  }
};
