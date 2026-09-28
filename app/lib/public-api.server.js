const DEFAULT_ORIGINS = [
  "https://lafabricafriki.es",
  "https://www.lafabricafriki.es",
];

function configuredOrigins() {
  const values = String(process.env.LFF_PUBLIC_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const shop = String(process.env.SHOPIFY_SHOP_DOMAIN || "").trim();
  if (shop) values.push(`https://${shop}`);
  return [...new Set([...DEFAULT_ORIGINS, ...values])];
}

export function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowed = configuredOrigins();
  const accepted = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": accepted,
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function assertAllowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (!configuredOrigins().includes(origin)) {
    throw new Error("Origen no autorizado.");
  }
}

export async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export function json(request, data, init = {}) {
  const headers = { ...corsHeaders(request), ...(init.headers || {}) };
  return Response.json(data, { ...init, headers });
}
