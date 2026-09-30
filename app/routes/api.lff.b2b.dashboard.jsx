import db from "../db.server";
import { requireB2BSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";
import { cleanText, shopDomain } from "../lib/lff-v90.server";

function publicThread(thread) {
  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    messages: (thread.messages || []).map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })),
  };
}

async function threadsFor(company) {
  return db.chatThread.findMany({
    where: { shop: company.shop, ownerType: "b2b", ownerId: company.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { company } = await requireB2BSession(request);
    const [threads, orders] = await Promise.all([
      threadsFor(company),
      db.b2BOrder.findMany({ where: { shop: company.shop, companyId: company.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    ]);
    const commercial = company.commercialId ? await db.commercialUser.findUnique({ where: { id: company.commercialId }, select: { id: true, name: true, status: true } }) : null;
    return json(request, {
      ok: true,
      company: {
        id: company.id,
        companyName: company.companyName,
        contactName: company.contactName,
        contactEmail: company.contactEmail,
        status: company.status,
        priceTier: company.priceTier,
        firstOrderPromo: company.priceTier === "referred_55" && !company.firstOrderUsed,
        commercial,
      },
      orders: orders.map((o) => ({ id: o.id, orderName: o.orderName, subtotalCents: o.subtotalCents, totalCents: o.totalCents, refundedCents: o.refundedCents, currency: o.currency, status: o.status, paidAt: o.paidAt, createdAt: o.createdAt })),
      threads: threads.map(publicThread),
    });
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: 401 });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { company } = await requireB2BSession(request);
    const body = await bodyData(request);
    const intent = String(body.intent || "send-message");
    if (intent === "send-message") {
      const message = cleanText(body.message, 3000);
      if (!message) throw new Error("Escribe un mensaje.");
      let thread = body.threadId ? await db.chatThread.findFirst({ where: { id: String(body.threadId), shop: company.shop, ownerType: "b2b", ownerId: company.id } }) : null;
      if (!thread) {
        thread = await db.chatThread.create({ data: { shop: company.shop, subject: `Soporte · ${company.companyName}`, channel: "b2b", ownerType: "b2b", ownerId: company.id, status: "open" } });
      }
      const created = await db.chatMessage.create({ data: { threadId: thread.id, author: company.companyName, body: message } });
      await db.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      await recordAudit(company.shop, "b2b.chat_message", { actor: company.contactEmail, targetType: "chat_thread", targetId: thread.id, messageId: created.id }).catch(() => {});
      const threads = await threadsFor(company);
      return json(request, { ok: true, threads: threads.map(publicThread) });
    }
    throw new Error("Acción B2B no reconocida.");
  } catch (error) {
    const status = /sesión|caducad/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
