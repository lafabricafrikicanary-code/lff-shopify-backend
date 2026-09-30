import { unauthenticated } from "../shopify.server";
import { processDueRetentionCampaigns, shopDomain } from "../lib/lff-v90.server";

function requireToken(request) {
  const expected = String(process.env.LFF_ADMIN_TOKEN || "");
  if (!expected) throw new Error("LFF_ADMIN_TOKEN no configurado.");
  const supplied = request.headers.get("x-lff-admin-token") || "";
  if (supplied !== expected) throw new Error("No autorizado.");
}

export const loader = async ({ request }) => {
  try {
    requireToken(request);
    const { admin } = await unauthenticated.admin(shopDomain());
    if (!admin) throw new Error("No hay sesión offline de Shopify.");
    const results = await processDueRetentionCampaigns(admin, shopDomain(), 50);
    return Response.json({ ok: true, processed: results.length, results });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: /autoriz/i.test(error.message) ? 401 : 400 });
  }
};

export const action = loader;
