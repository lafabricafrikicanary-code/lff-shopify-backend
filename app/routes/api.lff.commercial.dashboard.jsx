import db from "../db.server";
import { requireCommercialSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";
import { cleanText, releaseMatureCommissions } from "../lib/lff-v90.server";

async function commercialThreads(commercial) {
  const companyIds = (await db.b2BCompany.findMany({ where: { shop: commercial.shop, commercialId: commercial.id, status: { not: "rejected" } }, select: { id: true } })).map((x) => x.id);
  if (!companyIds.length) return [];
  return db.chatThread.findMany({
    where: { shop: commercial.shop, ownerType: "b2b", ownerId: { in: companyIds } },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { commercial } = await requireCommercialSession(request);
    await releaseMatureCommissions(commercial.shop, commercial.id);
    const [commissions, clients, companies, payouts, threads] = await Promise.all([
      db.commission.findMany({ where: { commercialId: commercial.id }, orderBy: { createdAt: "desc" }, take: 200 }),
      db.commercialCustomerAttribution.findMany({ where: { commercialId: commercial.id, status: "active" }, orderBy: { createdAt: "desc" }, take: 300 }),
      db.b2BCompany.findMany({ where: { commercialId: commercial.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      db.payout.findMany({ where: { shop: commercial.shop, commercialId: commercial.id, status: "paid" }, orderBy: { paidAt: "desc" }, take: 100 }),
      commercialThreads(commercial),
    ]);
    const clientRows = clients;
    const pendingCents = commissions.filter((c) => c.status === "pending_validation").reduce((sum, c) => sum + c.amountCents, 0);
    const availableCents = commissions.filter((c) => c.status === "available").reduce((sum, c) => sum + c.amountCents, 0);
    const paidCents = commissions.filter((c) => c.status === "paid").reduce((sum, c) => sum + c.amountCents, 0);
    const salesBasisCents = commissions.reduce((sum, c) => sum + c.basisCents, 0);
    return json(request, {
      ok: true,
      commercial: {
        id: commercial.id,
        name: commercial.name,
        email: commercial.email,
        captureCode: commercial.captureCode,
        personalCode: commercial.personalCode,
        status: commercial.status,
      },
      stats: { clients: clientRows.length, companies: companies.length, sales: commissions.length, pendingCents, availableCents, paidCents, salesBasisCents },
      clients: clientRows.map((c) => ({ id: c.id, customerGid: c.customerGid, customerEmail: c.customerEmail, firstOrderAt: c.firstOrderAt, sourceCode: c.sourceCode, createdAt: c.createdAt })) ,
      commissions: commissions.map((c) => ({ id: c.id, orderName: c.orderName, basisCents: c.basisCents, rateBps: c.rateBps, amountCents: c.amountCents, status: c.status, validationDate: c.validationDate, createdAt: c.createdAt })),
      payouts: payouts.map((p) => ({ id: p.id, totalCents: p.totalCents, method: p.method, reference: p.reference, paidAt: p.paidAt, status: p.status })),
      companies: companies.map((c) => ({ id: c.id, companyName: c.companyName, contactEmail: c.contactEmail, status: c.status, priceTier: c.priceTier, createdAt: c.createdAt })),
      threads: threads.map((t) => ({ id: t.id, companyId: t.ownerId, subject: t.subject, status: t.status, messages: t.messages.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })) })),
    });
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: 401 });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { commercial } = await requireCommercialSession(request);
    const body = await bodyData(request);
    const intent = String(body.intent || "send-message");
    if (intent === "send-message") {
      const message = cleanText(body.message, 3000);
      if (!message) throw new Error("Escribe un mensaje.");
      const thread = await db.chatThread.findFirst({ where: { id: String(body.threadId), shop: commercial.shop, ownerType: "b2b" } });
      if (!thread) throw new Error("No se encontró la conversación.");
      const company = await db.b2BCompany.findFirst({ where: { id: thread.ownerId || "", shop: commercial.shop, commercialId: commercial.id } });
      if (!company) throw new Error("Esta conversación no está asignada a tu cuenta comercial.");
      const created = await db.chatMessage.create({ data: { threadId: thread.id, author: commercial.name, body: message } });
      await db.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      await recordAudit(commercial.shop, "commercial.chat_message", { actor: commercial.email || commercial.name, targetType: "chat_thread", targetId: thread.id, messageId: created.id }).catch(() => {});
      return json(request, { ok: true, message: created });
    }
    throw new Error("Acción de panel comercial no reconocida.");
  } catch (error) {
    const status = /sesión|caducada|asignada/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
