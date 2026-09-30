import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { hashPassword, requireAdminSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import {
  createCommercialWithCodes,
  findOrCreateShopifyCustomer,
  makeCode,
  recordAudit,
} from "../lib/lff.server";
import { uploadDataUrlToShopifyFiles, uploadFileObjectToShopifyFiles } from "../lib/lff-media.server";
import {
  asShopifyGid,
  cleanEmail,
  cleanText,
  processDueRetentionCampaigns,
  releaseMatureCommissions,
  shopDomain,
} from "../lib/lff-v90.server";

async function adminClient() {
  const { admin } = await unauthenticated.admin(shopDomain());
  if (!admin) throw new Error("No hay sesión offline de Shopify disponible para esta tienda.");
  return admin;
}

function actor(auth) {
  return auth?.user?.displayName || auth?.user?.username || "Admin";
}

function ownerOnly(auth) {
  if (String(auth?.user?.role || "").toLowerCase() !== "owner") throw new Error("Solo Alejandro puede realizar esta acción.");
}

function reviewPublic(row) {
  return {
    id: row.id,
    productId: row.productGid,
    productHandle: row.productHandle,
    productTitle: row.productTitle,
    category: row.category,
    name: row.name,
    orderRef: row.orderRef,
    rating: row.rating,
    text: row.body,
    image: row.imageUrl || "",
    source: row.source,
    status: row.status,
    hidden: row.hidden,
    registeredBy: row.registeredBy,
    moderatedBy: row.moderatedBy,
    moderatedAt: row.moderatedAt,
    createdAt: row.createdAt,
  };
}

function expensePublic(row) {
  return {
    id: row.id,
    concept: row.concept,
    amount: row.amountCents / 100,
    amountCents: row.amountCents,
    category: row.category,
    date: row.expenseDate.toISOString().slice(0, 10),
    payment: row.paymentMethod,
    reference: row.reference,
    notes: row.notes,
    receiptUrl: row.receiptUrl || "",
    receiptName: row.receiptName || "",
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function commercialPublic(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    channel: row.channel,
    about: row.about,
    captureCode: row.captureCode,
    personalCode: row.personalCode,
    status: row.status,
    forceChange: row.forceChange,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

function b2bPublic(row) {
  return {
    id: row.id,
    companyName: row.companyName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    phone: row.phone,
    taxId: row.taxId,
    website: row.website,
    status: row.status,
    referredByCode: row.referredByCode,
    commercialId: row.commercialId,
    priceTier: row.priceTier,
    firstOrderUsed: row.firstOrderUsed,
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    createdAt: row.createdAt,
  };
}

async function listCommercialData(shop) {
  await releaseMatureCommissions(shop);
  const [applications, commercials, payouts, recoveries, attributions] = await Promise.all([
    db.commercialApplication.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.commercialUser.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.payout.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.accessRecoveryRequest.findMany({ where: { shop, accountType: "commercial" }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.commercialCustomerAttribution.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const commissionGroups = await db.commission.groupBy({
    by: ["commercialId", "status"],
    where: { shop },
    _sum: { amountCents: true, basisCents: true },
    _count: { id: true },
  });
  return {
    applications: applications.map((x) => ({ id: x.id, name: x.name, email: x.email, phone: x.phone, channel: x.channel, about: x.about, inviterCode: x.inviterCode, status: x.status, createdAt: x.createdAt, decidedAt: x.decidedAt, commercialId: x.commercialId })),
    commercials: commercials.map(commercialPublic),
    payouts,
    recoveries,
    attributions,
    commissionGroups,
  };
}

async function listB2BData(shop) {
  const [companies, recoveries, orders] = await Promise.all([
    db.b2BCompany.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.accessRecoveryRequest.findMany({ where: { shop, accountType: "b2b" }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.b2BOrder.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  return { companies: companies.map(b2bPublic), recoveries, orders };
}

async function createFixedVoucher(admin, { title, code, amountCents, customerId, expiresAt }) {
  const context = customerId ? { customers: { add: [asShopifyGid("Customer", customerId)] } } : { all: "ALL" };
  const response = await admin.graphql(
    `#graphql
      mutation LffBoxVoucher($discount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $discount) {
          codeDiscountNode { id }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        discount: {
          title,
          code,
          startsAt: new Date().toISOString(),
          endsAt: expiresAt?.toISOString() || null,
          usageLimit: 1,
          appliesOncePerCustomer: true,
          context,
          customerGets: {
            value: { discountAmount: { amount: (Number(amountCents || 1500) / 100).toFixed(2), appliesOnEachItem: false } },
            items: { all: true },
          },
          combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
        },
      },
    },
  );
  const payload = await response.json();
  const root = payload.data?.discountCodeBasicCreate;
  const errors = root?.userErrors || payload.errors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return root?.codeDiscountNode;
}

async function issueBoxVoucher(admin, subscription) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 35);
  const code = makeCode("BOX15", subscription.email || subscription.name || "CLUB");
  let customerId = subscription.customer?.shopifyCustomerId || null;
  if (!customerId && subscription.email) {
    const linked = await findOrCreateShopifyCustomer(admin, { email: subscription.email, name: subscription.name });
    customerId = linked?.id || null;
  }
  const discount = await createFixedVoucher(admin, { title: `Caja Friki bono 15 EUR - ${subscription.email}`, code, amountCents: subscription.monthlyVoucherCents, customerId, expiresAt });
  return db.boxVoucher.create({
    data: {
      shop: subscription.shop,
      subscriptionId: subscription.id,
      code,
      amountCents: subscription.monthlyVoucherCents,
      status: "available",
      shopifyDiscountId: discount?.id || null,
      expiresAt,
    },
  });
}

async function parseMultipartOrBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return { body: Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === "string")), formData };
  }
  return { body: await bodyData(request), formData: null };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const auth = await requireAdminSession(request);
    const shop = shopDomain();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") || "summary";

    if (view === "audit") {
      ownerOnly(auth);
      const logs = await db.auditLog.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 500 });
      return json(request, { ok: true, logs });
    }
    if (view === "reviews") {
      const rows = await db.productReview.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 500 });
      return json(request, { ok: true, reviews: rows.map(reviewPublic) });
    }
    if (view === "expenses") {
      const rows = await db.expense.findMany({ where: { shop, deletedAt: null }, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], take: 500 });
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const totalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
      const monthCents = rows.filter((row) => row.expenseDate >= monthStart).reduce((sum, row) => sum + row.amountCents, 0);
      return json(request, { ok: true, expenses: rows.map(expensePublic), summary: { count: rows.length, totalCents, monthCents, receipts: rows.filter((row) => row.receiptUrl).length } });
    }
    if (view === "commercials") return json(request, { ok: true, ...(await listCommercialData(shop)) });
    if (view === "b2b") return json(request, { ok: true, ...(await listB2BData(shop)) });
    if (view === "retention") {
      const campaigns = await db.retentionCampaign.findMany({ where: { shop }, include: { favorite: true }, orderBy: { createdAt: "desc" }, take: 500 });
      return json(request, { ok: true, campaigns });
    }
    if (view === "traffic") {
      const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || 30), 365));
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const [groups, total, visitors] = await Promise.all([
        db.trafficEvent.groupBy({ by: ["source"], where: { shop, createdAt: { gte: from } }, _count: { id: true } }),
        db.trafficEvent.count({ where: { shop, createdAt: { gte: from } } }),
        db.trafficEvent.findMany({ where: { shop, createdAt: { gte: from }, visitorId: { not: null } }, distinct: ["visitorId"], select: { visitorId: true } }),
      ]);
      return json(request, { ok: true, days, total, uniqueVisitors: visitors.length, sources: groups.map((g) => ({ source: g.source, count: g._count.id })) });
    }
    if (view === "customers") {
      const [customers, recoveries] = await Promise.all([
        db.customerAccount.findMany({ where: { shop }, include: { clubProfile: true, boxSubscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { vouchers: true } } }, orderBy: { createdAt: "desc" }, take: 500 }),
        db.accessRecoveryRequest.findMany({ where: { shop, accountType: "customer" }, orderBy: { createdAt: "desc" }, take: 200 }),
      ]);
      return json(request, { ok: true, customers, recoveries });
    }
    if (view === "messages") {
      const messages = await db.outboundMessage.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 500 });
      return json(request, { ok: true, messages });
    }
    if (view === "contacts") {
      const contacts = await db.contactRequest.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 500 });
      return json(request, { ok: true, contacts });
    }

    const [reviews, expenses, favorites, campaigns, commercials, b2b, customers, audits, outbound] = await Promise.all([
      db.productReview.count({ where: { shop, status: "pending" } }),
      db.expense.count({ where: { shop, deletedAt: null } }),
      db.favorite.count({ where: { shop, status: "active" } }),
      db.retentionCampaign.count({ where: { shop, status: { in: ["waiting", "issued", "sent"] } } }),
      db.commercialUser.count({ where: { shop, status: "active" } }),
      db.b2BCompany.count({ where: { shop, status: "active" } }),
      db.customerAccount.count({ where: { shop, status: "active" } }),
      db.auditLog.count({ where: { shop } }),
      db.outboundMessage.count({ where: { shop, status: "pending_provider" } }),
    ]);
    return json(request, { ok: true, summary: { pendingReviews: reviews, expenses, activeFavorites: favorites, openRetentionCampaigns: campaigns, activeCommercials: commercials, activeB2B: b2b, activeCustomers: customers, auditLogs: audits, outboundPendingProvider: outbound } });
  } catch (error) {
    const status = /sesión|autoriz|Solo Alejandro/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const auth = await requireAdminSession(request);
    const shop = shopDomain();
    const who = actor(auth);
    const { body, formData } = await parseMultipartOrBody(request);
    const intent = String(body.intent || formData?.get("intent") || "");

    if (intent === "review-save") {
      let uploaded = null;
      const file = formData?.get("file");
      if (file && typeof file.arrayBuffer === "function" && file.size) uploaded = await uploadFileObjectToShopifyFiles(await adminClient(), file, { alt: `Reseña registrada por ${who}`, maxBytes: 3 * 1024 * 1024 });
      else if (String(body.imageData || "").startsWith("data:image/")) uploaded = await uploadDataUrlToShopifyFiles(await adminClient(), body.imageData, { alt: `Reseña registrada por ${who}`, maxBytes: 3 * 1024 * 1024 });
      const rating = Math.max(1, Math.min(5, Number(body.rating) || 5));
      const row = await db.productReview.create({ data: {
        shop,
        productGid: body.productId ? asShopifyGid("Product", body.productId) : null,
        productHandle: cleanText(body.productHandle, 180).toLowerCase() || null,
        productTitle: cleanText(body.productTitle || body.productRef, 220) || null,
        category: cleanText(body.category, 120) || null,
        name: cleanText(body.name, 60) || "Cliente",
        orderRef: cleanText(body.orderRef, 80) || null,
        rating,
        body: cleanText(body.text, 1000),
        imageFileId: uploaded?.id || null,
        imageUrl: uploaded?.url || null,
        source: "admin_customer_submission",
        status: "approved",
        hidden: false,
        registeredBy: who,
        moderatedBy: who,
        moderatedAt: new Date(),
      } });
      await recordAudit(shop, "review.admin_created", { actor: who, targetType: "product_review", targetId: row.id });
      return json(request, { ok: true, review: reviewPublic(row) });
    }

    if (intent === "review-moderate") {
      const row = await db.productReview.findFirst({ where: { id: String(body.reviewId), shop } });
      if (!row) throw new Error("No se encontró la reseña.");
      const action = String(body.action || "approve");
      const data = { moderatedBy: who, moderatedAt: new Date() };
      if (action === "approve") Object.assign(data, { status: "approved", hidden: false });
      else if (action === "hide") Object.assign(data, { hidden: true });
      else if (action === "show") Object.assign(data, { hidden: false });
      else if (action === "reject") Object.assign(data, { status: "rejected", hidden: true });
      else throw new Error("Moderación no reconocida.");
      const updated = await db.productReview.update({ where: { id: row.id }, data });
      await recordAudit(shop, `review.${action}`, { actor: who, targetType: "product_review", targetId: row.id });
      return json(request, { ok: true, review: reviewPublic(updated) });
    }

    if (intent === "review-delete") {
      const row = await db.productReview.findFirst({ where: { id: String(body.reviewId), shop } });
      if (!row) throw new Error("No se encontró la reseña.");
      await db.productReview.delete({ where: { id: row.id } });
      await recordAudit(shop, "review.deleted", { actor: who, targetType: "product_review", targetId: row.id });
      return json(request, { ok: true });
    }

    if (intent === "expense-save") {
      let uploaded = null;
      const file = formData?.get("file");
      if (file && typeof file.arrayBuffer === "function" && file.size) uploaded = await uploadFileObjectToShopifyFiles(await adminClient(), file, { alt: `Justificante gasto LFF · ${cleanText(body.concept, 80)}`, maxBytes: 5 * 1024 * 1024 });
      else if (String(body.receiptData || "").startsWith("data:image/")) uploaded = await uploadDataUrlToShopifyFiles(await adminClient(), body.receiptData, { alt: `Justificante gasto LFF · ${cleanText(body.concept, 80)}`, maxBytes: 5 * 1024 * 1024 });
      const amountCents = Math.round(Number(body.amount || 0) * 100);
      if (!cleanText(body.concept, 80) || amountCents <= 0) throw new Error("Introduce un concepto y un importe válido.");
      const expenseDate = body.date ? new Date(`${String(body.date).slice(0, 10)}T12:00:00.000Z`) : new Date();
      if (Number.isNaN(expenseDate.getTime())) throw new Error("Fecha de gasto no válida.");
      const row = await db.expense.create({ data: {
        shop,
        concept: cleanText(body.concept, 80),
        amountCents,
        category: cleanText(body.category || "Otros", 80),
        expenseDate,
        paymentMethod: cleanText(body.payment, 80) || null,
        reference: cleanText(body.reference, 80) || null,
        notes: cleanText(body.notes, 1000) || null,
        receiptFileId: uploaded?.id || null,
        receiptUrl: uploaded?.url || null,
        receiptName: cleanText(file?.name || body.receiptName, 180) || null,
        createdBy: who,
      } });
      await recordAudit(shop, "expense.created", { actor: who, targetType: "expense", targetId: row.id, amountCents });
      return json(request, { ok: true, expense: expensePublic(row) });
    }

    if (intent === "expense-delete") {
      const row = await db.expense.findFirst({ where: { id: String(body.expenseId), shop, deletedAt: null } });
      if (!row) throw new Error("No se encontró el gasto.");
      await db.expense.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      await recordAudit(shop, "expense.deleted", { actor: who, targetType: "expense", targetId: row.id, amountCents: row.amountCents });
      return json(request, { ok: true });
    }

    if (intent === "retention-process") {
      const results = await processDueRetentionCampaigns(await adminClient(), shop, body.limit || 50);
      return json(request, { ok: true, processed: results.length, results });
    }

    if (intent === "finance-calculate") {
      const profitCents = Math.max(0, Math.round(Number(body.profit ?? body.profitAmount ?? 0) * 100));
      const associationCents = Math.round(profitCents * 0.15);
      const savingsCents = Math.round(profitCents * 0.30);
      const marketingCents = Math.round(profitCents * 0.30);
      const ownersCents = Math.max(0, profitCents - associationCents - savingsCents - marketingCents);
      const alejandroCents = Math.floor(ownersCents / 2);
      const gabrielCents = ownersCents - alejandroCents;
      return json(request, { ok: true, profitCents, allocation: { associationCents, savingsCents, marketingCents, ownersCents, alejandroCents, gabrielCents }, percentages: { association: 15, savings: 30, marketing: 30, owners: 25 } });
    }

    if (intent === "commercial-approve") {
      ownerOnly(auth);
      const application = await db.commercialApplication.findFirst({ where: { id: String(body.applicationId), shop } });
      if (!application || application.status !== "pending") throw new Error("Solicitud comercial no disponible.");
      const commercial = await createCommercialWithCodes({
        admin: await adminClient(), shop, name: application.name, email: application.email, phone: application.phone, channel: application.channel, about: application.about,
        passwordHash: application.passwordHash, passwordSalt: application.passwordSalt,
      });
      await db.commercialApplication.update({ where: { id: application.id }, data: { status: "approved", commercialId: commercial.id, decidedAt: new Date() } });
      await recordAudit(shop, "commercial.application_approved", { actor: who, targetType: "commercial_application", targetId: application.id, commercialId: commercial.id });
      return json(request, { ok: true, commercial: commercialPublic(commercial), ...(await listCommercialData(shop)) });
    }

    if (intent === "commercial-reject") {
      ownerOnly(auth);
      const row = await db.commercialApplication.findFirst({ where: { id: String(body.applicationId), shop } });
      if (!row) throw new Error("No se encontró la solicitud.");
      await db.commercialApplication.update({ where: { id: row.id }, data: { status: "rejected", decidedAt: new Date() } });
      await recordAudit(shop, "commercial.application_rejected", { actor: who, targetType: "commercial_application", targetId: row.id });
      return json(request, { ok: true, ...(await listCommercialData(shop)) });
    }

    if (intent === "commercial-toggle") {
      ownerOnly(auth);
      const row = await db.commercialUser.findFirst({ where: { id: String(body.commercialId), shop } });
      if (!row) throw new Error("No se encontró el comercial.");
      const status = body.enabled === true || body.enabled === "true" || body.status === "active" ? "active" : "suspended";
      await db.commercialUser.update({ where: { id: row.id }, data: { status } });
      if (status !== "active") await db.commercialSession.deleteMany({ where: { commercialId: row.id } });
      await recordAudit(shop, "commercial.status_changed", { actor: who, targetType: "commercial", targetId: row.id, status });
      return json(request, { ok: true, ...(await listCommercialData(shop)) });
    }

    if (intent === "commercial-reset-password") {
      ownerOnly(auth);
      const row = await db.commercialUser.findFirst({ where: { id: String(body.commercialId), shop } });
      if (!row) throw new Error("No se encontró el comercial.");
      const password = String(body.password || "");
      if (password.length < 8) throw new Error("La contraseña temporal debe tener al menos 8 caracteres.");
      const rec = hashPassword(password);
      await db.commercialUser.update({ where: { id: row.id }, data: { passwordHash: rec.hash, passwordSalt: rec.salt, forceChange: true, failedAttempts: 0, lockedUntil: null } });
      await db.commercialSession.deleteMany({ where: { commercialId: row.id } });
      await recordAudit(shop, "commercial.password_reset", { actor: who, targetType: "commercial", targetId: row.id });
      return json(request, { ok: true });
    }

    if (intent === "recovery-resolve") {
      ownerOnly(auth);
      const row = await db.accessRecoveryRequest.findFirst({ where: { id: String(body.recoveryId), shop } });
      if (!row) throw new Error("No se encontró la solicitud de recuperación.");
      await db.accessRecoveryRequest.update({ where: { id: row.id }, data: { status: "done", handledAt: new Date(), handledBy: who, notes: cleanText(body.notes, 1000) || null } });
      await recordAudit(shop, "access_recovery.resolved", { actor: who, targetType: "access_recovery", targetId: row.id, accountType: row.accountType });
      return json(request, { ok: true });
    }

    if (intent === "commercial-mark-paid") {
      ownerOnly(auth);
      await releaseMatureCommissions(shop, String(body.commercialId));
      const requested = Array.isArray(body.commissionIds) ? body.commissionIds.map(String) : [];
      const commissions = await db.commission.findMany({
        where: { shop, commercialId: String(body.commercialId), status: "available", ...(requested.length ? { id: { in: requested } } : {}) },
        orderBy: { createdAt: "asc" },
      });
      if (!commissions.length) throw new Error("No hay comisiones disponibles para marcar como pagadas.");
      const totalCents = commissions.reduce((sum, c) => sum + c.amountCents, 0);
      const payout = await db.payout.create({ data: {
        shop, commercialId: String(body.commercialId), label: cleanText(body.label || `Pago ${new Date().toISOString().slice(0, 10)}`, 180), status: "paid", totalCents,
        method: cleanText(body.method || "Bizum", 80), reference: cleanText(body.reference, 120) || null, notes: cleanText(body.notes, 1000) || null, paidBy: who, paidAt: new Date(),
      } });
      await db.commission.updateMany({ where: { id: { in: commissions.map((c) => c.id) } }, data: { status: "paid", payoutId: payout.id } });
      await recordAudit(shop, "commercial.payout_paid", { actor: who, targetType: "payout", targetId: payout.id, commercialId: body.commercialId, totalCents, commissionIds: commissions.map((c) => c.id) });
      return json(request, { ok: true, payout, ...(await listCommercialData(shop)) });
    }

    if (intent === "b2b-approve") {
      ownerOnly(auth);
      const row = await db.b2BCompany.findFirst({ where: { id: String(body.companyId), shop } });
      if (!row || row.status !== "pending") throw new Error("Solicitud B2B no disponible.");
      let shopifyCustomerId = row.shopifyCustomerId;
      if (row.contactEmail) {
        const linked = await findOrCreateShopifyCustomer(await adminClient(), { email: row.contactEmail, name: row.companyName });
        shopifyCustomerId = linked?.id || shopifyCustomerId;
      }
      const updated = await db.b2BCompany.update({ where: { id: row.id }, data: { status: "active", approvedAt: new Date(), rejectedAt: null, shopifyCustomerId } });
      const existingThread = await db.chatThread.findFirst({ where: { shop, ownerType: "b2b", ownerId: row.id } });
      if (!existingThread) await db.chatThread.create({ data: { shop, subject: `Soporte · ${row.companyName}`, channel: "b2b", ownerType: "b2b", ownerId: row.id, status: "open" } });
      await recordAudit(shop, "b2b.approved", { actor: who, targetType: "b2b_company", targetId: row.id, commercialId: row.commercialId });
      return json(request, { ok: true, company: b2bPublic(updated), ...(await listB2BData(shop)) });
    }

    if (intent === "b2b-reject") {
      ownerOnly(auth);
      const row = await db.b2BCompany.findFirst({ where: { id: String(body.companyId), shop } });
      if (!row) throw new Error("No se encontró la empresa.");
      await db.b2BCompany.update({ where: { id: row.id }, data: { status: "rejected", rejectedAt: new Date() } });
      await db.b2BSession.deleteMany({ where: { companyId: row.id } });
      await recordAudit(shop, "b2b.rejected", { actor: who, targetType: "b2b_company", targetId: row.id });
      return json(request, { ok: true, ...(await listB2BData(shop)) });
    }

    if (intent === "b2b-toggle") {
      ownerOnly(auth);
      const row = await db.b2BCompany.findFirst({ where: { id: String(body.companyId), shop } });
      if (!row) throw new Error("No se encontró la empresa.");
      const status = body.enabled === true || body.enabled === "true" || body.status === "active" ? "active" : "suspended";
      await db.b2BCompany.update({ where: { id: row.id }, data: { status } });
      if (status !== "active") await db.b2BSession.deleteMany({ where: { companyId: row.id } });
      await recordAudit(shop, "b2b.status_changed", { actor: who, targetType: "b2b_company", targetId: row.id, status });
      return json(request, { ok: true, ...(await listB2BData(shop)) });
    }

    if (intent === "b2b-assign-commercial") {
      ownerOnly(auth);
      const row = await db.b2BCompany.findFirst({ where: { id: String(body.companyId), shop } });
      if (!row) throw new Error("No se encontró la empresa.");
      const commercialId = cleanText(body.commercialId, 100) || null;
      let commercial = null;
      if (commercialId) {
        commercial = await db.commercialUser.findFirst({ where: { id: commercialId, shop, status: "active" } });
        if (!commercial) throw new Error("El comercial seleccionado no está activo.");
      }
      await db.b2BCompany.update({ where: { id: row.id }, data: { commercialId: commercial?.id || null, referredByCode: commercial?.captureCode || null, priceTier: commercial ? "referred_55" : "direct_60" } });
      await recordAudit(shop, "b2b.commercial_assigned", { actor: who, targetType: "b2b_company", targetId: row.id, commercialId: commercial?.id || null });
      return json(request, { ok: true, ...(await listB2BData(shop)) });
    }

    if (intent === "b2b-reset-password") {
      ownerOnly(auth);
      const row = await db.b2BCompany.findFirst({ where: { id: String(body.companyId), shop } });
      if (!row) throw new Error("No se encontró la empresa.");
      const password = String(body.password || "");
      if (password.length < 8) throw new Error("La contraseña temporal debe tener al menos 8 caracteres.");
      const rec = hashPassword(password);
      await db.b2BCompany.update({ where: { id: row.id }, data: { passwordHash: rec.hash, passwordSalt: rec.salt, forceChange: true, failedAttempts: 0, lockedUntil: null } });
      await db.b2BSession.deleteMany({ where: { companyId: row.id } });
      await recordAudit(shop, "b2b.password_reset", { actor: who, targetType: "b2b_company", targetId: row.id });
      return json(request, { ok: true });
    }

    if (intent === "b2b-chat-list") {
      const threads = await db.chatThread.findMany({ where: { shop, ownerType: "b2b" }, include: { messages: { orderBy: { createdAt: "asc" }, take: 500 } }, orderBy: { updatedAt: "desc" }, take: 200 });
      return json(request, { ok: true, threads });
    }

    if (intent === "b2b-chat-send") {
      const thread = await db.chatThread.findFirst({ where: { id: String(body.threadId), shop, ownerType: "b2b" } });
      if (!thread) throw new Error("No se encontró la conversación.");
      const message = cleanText(body.message, 3000);
      if (!message) throw new Error("Escribe un mensaje.");
      const created = await db.chatMessage.create({ data: { threadId: thread.id, author: `${who} · Administración`, body: message } });
      await db.chatThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      await recordAudit(shop, "b2b.admin_chat_message", { actor: who, targetType: "chat_thread", targetId: thread.id, messageId: created.id });
      return json(request, { ok: true, message: created });
    }

    if (intent === "customer-toggle") {
      ownerOnly(auth);
      const row = await db.customerAccount.findFirst({ where: { id: String(body.customerId), shop } });
      if (!row) throw new Error("No se encontró el cliente.");
      const status = body.enabled === true || body.enabled === "true" ? "active" : "suspended";
      await db.customerAccount.update({ where: { id: row.id }, data: { status } });
      if (status !== "active") await db.customerSession.deleteMany({ where: { customerId: row.id } });
      await recordAudit(shop, "customer.status_changed", { actor: who, targetType: "customer_account", targetId: row.id, status });
      return json(request, { ok: true });
    }

    if (intent === "customer-reset-password") {
      ownerOnly(auth);
      const row = await db.customerAccount.findFirst({ where: { id: String(body.customerId), shop } });
      if (!row) throw new Error("No se encontró el cliente.");
      const password = String(body.password || "");
      if (password.length < 8) throw new Error("La contraseña temporal debe tener al menos 8 caracteres.");
      const rec = hashPassword(password);
      await db.customerAccount.update({ where: { id: row.id }, data: { passwordHash: rec.hash, passwordSalt: rec.salt, forceChange: true, failedAttempts: 0, lockedUntil: null } });
      await db.customerSession.deleteMany({ where: { customerId: row.id } });
      await recordAudit(shop, "customer.password_reset", { actor: who, targetType: "customer_account", targetId: row.id });
      return json(request, { ok: true });
    }

    if (intent === "box-activate") {
      ownerOnly(auth);
      if (!(body.paymentConfirmed === true || body.paymentConfirmed === "true")) throw new Error("Confirma explícitamente que el cobro real está verificado antes de activar la Caja Friki.");
      const subscription = await db.boxSubscription.findFirst({ where: { id: String(body.subscriptionId), shop }, include: { customer: true, vouchers: true } });
      if (!subscription) throw new Error("No se encontró la suscripción.");
      const now = new Date();
      const next = new Date(now); next.setMonth(next.getMonth() + 1);
      const updated = await db.boxSubscription.update({ where: { id: subscription.id }, data: { status: "active", provider: cleanText(body.provider || "manual_verified", 80), providerSubscriptionId: cleanText(body.providerSubscriptionId, 180) || null, startedAt: subscription.startedAt || now, nextRenewalAt: next, nextBoxAt: next, cancelledAt: null } });
      let voucher = null;
      if (!subscription.vouchers.some((v) => v.status === "available")) voucher = await issueBoxVoucher(await adminClient(), { ...subscription, status: "active" });
      await recordAudit(shop, "box.activated", { actor: who, targetType: "box_subscription", targetId: subscription.id, paymentConfirmed: true, voucherId: voucher?.id || null });
      return json(request, { ok: true, subscription: updated, voucher });
    }

    if (intent === "box-cancel-confirm") {
      ownerOnly(auth);
      const subscription = await db.boxSubscription.findFirst({ where: { id: String(body.subscriptionId), shop } });
      if (!subscription) throw new Error("No se encontró la suscripción.");
      await db.boxSubscription.update({ where: { id: subscription.id }, data: { status: "cancelled", cancelledAt: new Date(), nextRenewalAt: null, nextBoxAt: null } });
      await recordAudit(shop, "box.cancelled", { actor: who, targetType: "box_subscription", targetId: subscription.id });
      return json(request, { ok: true });
    }

    if (intent === "contact-status") {
      const row = await db.contactRequest.findFirst({ where: { id: String(body.contactId), shop } });
      if (!row) throw new Error("No se encontró el contacto.");
      const status = cleanText(body.status || "done", 40);
      await db.contactRequest.update({ where: { id: row.id }, data: { status } });
      await recordAudit(shop, "contact.status_changed", { actor: who, targetType: "contact_request", targetId: row.id, status });
      return json(request, { ok: true });
    }

    throw new Error("Acción administrativa V90 no reconocida.");
  } catch (error) {
    console.error("[LFF ADMIN V90]", error);
    const status = /sesión|autoriz|Solo Alejandro/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
