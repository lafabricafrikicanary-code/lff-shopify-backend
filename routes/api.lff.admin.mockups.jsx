import fs from "node:fs";
import path from "node:path";
import { requireAdminSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, corsHeaders, json } from "../lib/public-api.server";

const LIB_DIR = path.join(process.cwd(), "app", "mockup-library");
const MANIFEST_PATH = path.join(LIB_DIR, "manifest.json");
let manifestCache = null;
let packCache = null;

function manifest() {
  if (!manifestCache) manifestCache = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  return manifestCache;
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    await requireAdminSession(request);
    const url = new URL(request.url);
    const mode = String(url.searchParams.get("mode") || "manifest");
    if (mode === "manifest") return json(request, { ok: true, library: manifest() });
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
