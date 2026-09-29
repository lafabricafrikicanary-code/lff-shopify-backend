import db from "../db.server";

const GAME_IDS = new Set([
  "neondash",
  "barreltower",
  "blockcore",
  "vectortanks",
  "neongp",
  "ramentrail",
]);
const RESULT_IDS = new Set(["started", "completed", "closed", "switched"]);
const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function short(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function asDate(value, fallback = new Date()) {
  const d = new Date(value || fallback);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function safeSeconds(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(1, Math.min(6 * 60 * 60, n));
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const fd = await request.formData();
  return Object.fromEntries(fd);
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(request.url);
    const shop = process.env.SHOPIFY_SHOP_DOMAIN || url.searchParams.get("shop") || "lafabricafriki.myshopify.com";
    const loggedCustomerId = short(url.searchParams.get("logged_in_customer_id"), 100) || null;
    const body = await readBody(request);
    const intent = short(body.intent, 40);
    const sessionKey = short(body.id || body.sessionKey, 120);
    const game = short(body.game, 40);

    if (!sessionKey || !/^s-[a-z0-9-]+$/i.test(sessionKey)) throw new Error("Sesión Arcade no válida.");
    if (!GAME_IDS.has(game)) throw new Error("Juego Arcade no válido.");

    const player = body.player && typeof body.player === "object" ? body.player : {};
    const visitorId = short(player.visitorId || body.visitorId, 120) || null;
    const playerLabel = short(player.label || body.playerLabel, 120) || null;

    if (intent === "arcade-session-start") {
      const startedAt = asDate(body.startedAt);
      await db.arcadeSession.upsert({
        where: { shop_sessionKey: { shop, sessionKey } },
        create: {
          shop,
          sessionKey,
          game,
          customerId: loggedCustomerId,
          visitorId,
          playerLabel,
          startedAt,
          result: "started",
        },
        update: {
          game,
          customerId: loggedCustomerId,
          visitorId,
          playerLabel,
          startedAt,
          endedAt: null,
          seconds: null,
          result: "started",
        },
      });
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (intent === "arcade-session-end") {
      const result = RESULT_IDS.has(short(body.result, 40)) ? short(body.result, 40) : "closed";
      const startedAt = asDate(body.startedAt);
      const endedAt = asDate(body.endedAt);
      const seconds = safeSeconds(body.seconds);
      await db.arcadeSession.upsert({
        where: { shop_sessionKey: { shop, sessionKey } },
        create: {
          shop,
          sessionKey,
          game,
          customerId: loggedCustomerId,
          visitorId,
          playerLabel,
          startedAt,
          endedAt,
          seconds,
          result,
        },
        update: {
          game,
          customerId: loggedCustomerId,
          visitorId,
          playerLabel,
          endedAt,
          seconds,
          result,
        },
      });
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    throw new Error("Evento Arcade no reconocido.");
  } catch (error) {
    console.error("[LFF ARCADE ANALYTICS]", error);
    return Response.json(
      { ok: false, error: error.message || "No se pudo registrar la sesión Arcade." },
      { status: 400, headers: corsHeaders },
    );
  }
};
