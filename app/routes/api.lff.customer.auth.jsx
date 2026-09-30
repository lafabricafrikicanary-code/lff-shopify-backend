import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  assertNotLocked,
  deleteCustomerSession,
  hashPassword,
  issueCustomerSession,
  noteFailedCustomerLogin,
  normalizeAccountLogin,
  requireCustomerSession,
  verifyPassword,
} from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import { findOrCreateShopifyCustomer, recordAudit } from "../lib/lff.server";
import { cleanEmail, cleanText, shopDomain } from "../lib/lff-v90.server";

function publicCustomer(customer) {
  const latestBox = customer.boxSubscriptions?.[0] || null;
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    status: customer.status,
    marketingConsent: customer.marketingConsent,
    forceChange: customer.forceChange,
    shopifyCustomerId: customer.shopifyCustomerId,
    clubMember: Boolean(customer.clubProfile),
    club: customer.clubProfile ? {
      joinedAt: customer.clubProfile.joinedAt,
      marketingConsent: customer.clubProfile.marketingConsent,
    } : null,
    box: latestBox ? {
      id: latestBox.id,
      status: latestBox.status,
      monthlyPriceCents: latestBox.monthlyPriceCents,
      monthlyVoucherCents: latestBox.monthlyVoucherCents,
      nextRenewalAt: latestBox.nextRenewalAt,
      nextBoxAt: latestBox.nextBoxAt,
      address: latestBox.address,
      postal: latestBox.postal,
      city: latestBox.city,
      country: latestBox.country,
      vouchers: (latestBox.vouchers || []).map((v) => ({ code: v.code, amountCents: v.amountCents, status: v.status, expiresAt: v.expiresAt })),
    } : null,
  };
}

async function freshCustomer(id) {
  return db.customerAccount.findUnique({
    where: { id },
    include: {
      clubProfile: true,
      boxSubscriptions: { orderBy: { createdAt: "desc" }, take: 3, include: { vouchers: true } },
    },
  });
}

async function ensureClub(customer, input = {}) {
  const profile = await db.clubProfile.upsert({
    where: { customerId: customer.id },
    update: {
      name: cleanText(input.name || customer.name, 120),
      email: customer.email,
      phone: cleanText(input.phone || customer.phone, 40) || null,
      marketingConsent: input.marketingConsent === false || input.marketingConsent === "false" ? false : true,
    },
    create: {
      shop: customer.shop,
      customerId: customer.id,
      name: cleanText(input.name || customer.name, 120),
      email: customer.email,
      phone: cleanText(input.phone || customer.phone, 40) || null,
      marketingConsent: input.marketingConsent === false || input.marketingConsent === "false" ? false : true,
    },
  });
  await db.customerAccount.update({ where: { id: customer.id }, data: { marketingConsent: profile.marketingConsent } });
  return profile;
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { customer } = await requireCustomerSession(request);
    return json(request, { ok: true, customer: publicCustomer(customer) });
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: 401 });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const body = await bodyData(request);
    const intent = String(body.intent || "login");
    const shop = shopDomain();

    if (intent === "register") {
      const name = cleanText(body.name, 120);
      const email = cleanEmail(body.email);
      const phone = cleanText(body.phone, 40);
      const password = String(body.password || "");
      if (!name || !email) throw new Error("Completa nombre y correo.");
      if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
      const existing = await db.customerAccount.findUnique({ where: { shop_email: { shop, email } } });
      if (existing) throw new Error("Ya existe una cuenta con ese correo.");
      const record = hashPassword(password);
      let shopifyCustomerId = null;
      try {
        const { admin } = await unauthenticated.admin(shop);
        const linked = admin ? await findOrCreateShopifyCustomer(admin, { email, name }) : null;
        shopifyCustomerId = linked?.id || null;
      } catch (error) {
        console.error("[LFF CUSTOMER SHOPIFY LINK]", error);
      }
      const customer = await db.customerAccount.create({
        data: {
          shop,
          email,
          name,
          phone: phone || null,
          passwordHash: record.hash,
          passwordSalt: record.salt,
          marketingConsent: body.marketingConsent === true || body.marketingConsent === "true",
          shopifyCustomerId,
        },
      });
      if (body.joinClub === true || body.joinClub === "true") await ensureClub(customer, body);
      const token = await issueCustomerSession(customer);
      await recordAudit(shop, "customer.account_created", { actor: email, targetType: "customer_account", targetId: customer.id, shopifyCustomerId }).catch(() => {});
      return json(request, { ok: true, token, customer: publicCustomer(await freshCustomer(customer.id)) });
    }

    if (intent === "recover") {
      const email = cleanEmail(body.email);
      if (!email) throw new Error("Introduce un correo válido.");
      const customer = await db.customerAccount.findUnique({ where: { shop_email: { shop, email } } });
      await db.accessRecoveryRequest.create({
        data: { shop, accountType: "customer", accountId: customer?.id || null, email, source: "self_service" },
      });
      await recordAudit(shop, "customer.recovery_requested", { actor: email, targetType: "customer_access", targetId: customer?.id }).catch(() => {});
      return json(request, { ok: true });
    }

    if (intent === "login") {
      const email = cleanEmail(normalizeAccountLogin(body.email || body.username));
      const customer = email ? await db.customerAccount.findUnique({
        where: { shop_email: { shop, email } },
        include: { clubProfile: true, boxSubscriptions: { orderBy: { createdAt: "desc" }, take: 3, include: { vouchers: true } } },
      }) : null;
      if (!customer) return json(request, { ok: false, error: "Correo o contraseña incorrectos." }, { status: 401 });
      assertNotLocked(customer);
      if (customer.status !== "active") return json(request, { ok: false, error: "Esta cuenta no está activa." }, { status: 403 });
      if (!verifyPassword(body.password, customer.passwordSalt, customer.passwordHash)) {
        await noteFailedCustomerLogin(customer);
        return json(request, { ok: false, error: "Correo o contraseña incorrectos." }, { status: 401 });
      }
      const token = await issueCustomerSession(customer);
      await recordAudit(shop, "customer.login", { actor: customer.email, targetType: "customer_account", targetId: customer.id }).catch(() => {});
      return json(request, { ok: true, token, customer: publicCustomer(await freshCustomer(customer.id)) });
    }

    const { customer, token } = await requireCustomerSession(request);

    if (intent === "logout") {
      await deleteCustomerSession(token);
      return json(request, { ok: true });
    }

    if (intent === "change-password") {
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (next.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
      if (!verifyPassword(current, customer.passwordSalt, customer.passwordHash)) throw new Error("La contraseña actual no es correcta.");
      const record = hashPassword(next);
      await db.customerAccount.update({ where: { id: customer.id }, data: { passwordHash: record.hash, passwordSalt: record.salt, forceChange: false } });
      await recordAudit(shop, "customer.password_changed", { actor: customer.email, targetType: "customer_account", targetId: customer.id }).catch(() => {});
      return json(request, { ok: true });
    }

    if (intent === "update-profile") {
      const name = cleanText(body.name || customer.name, 120);
      const phone = cleanText(body.phone, 40);
      await db.customerAccount.update({ where: { id: customer.id }, data: { name, phone: phone || null } });
      if (customer.clubProfile) await ensureClub({ ...customer, name, phone }, body);
      await recordAudit(shop, "customer.profile_updated", { actor: customer.email, targetType: "customer_account", targetId: customer.id }).catch(() => {});
      return json(request, { ok: true, customer: publicCustomer(await freshCustomer(customer.id)) });
    }

    if (intent === "join-club") {
      await ensureClub(customer, body);
      await recordAudit(shop, "club.joined_or_updated", { actor: customer.email, targetType: "customer_account", targetId: customer.id }).catch(() => {});
      return json(request, { ok: true, customer: publicCustomer(await freshCustomer(customer.id)) });
    }

    if (intent === "box-request") {
      const existing = await db.boxSubscription.findFirst({ where: { customerId: customer.id, status: { in: ["pending_payment", "active", "paused", "cancellation_requested"] } }, orderBy: { createdAt: "desc" } });
      const data = {
        name: cleanText(body.name || customer.name, 120),
        email: customer.email,
        phone: cleanText(body.phone || customer.phone, 40) || null,
        address: cleanText(body.address, 220) || null,
        postal: cleanText(body.postal, 20) || null,
        city: cleanText(body.city, 100) || null,
        country: cleanText(body.country, 100) || null,
      };
      const subscription = existing
        ? await db.boxSubscription.update({ where: { id: existing.id }, data })
        : await db.boxSubscription.create({ data: { shop, customerId: customer.id, ...data, status: "pending_payment" } });
      await recordAudit(shop, "box.subscription_requested", { actor: customer.email, targetType: "box_subscription", targetId: subscription.id, status: subscription.status }).catch(() => {});
      return json(request, { ok: true, subscription, paymentRequired: true, message: "Solicitud guardada. La suscripción no se activa hasta confirmar el cobro real." });
    }

    if (intent === "box-cancel") {
      const subscription = await db.boxSubscription.findFirst({ where: { customerId: customer.id, status: { in: ["pending_payment", "active", "paused"] } }, orderBy: { createdAt: "desc" } });
      if (!subscription) throw new Error("No hay una suscripción activa o pendiente.");
      const nextStatus = subscription.status === "pending_payment" ? "cancelled" : "cancellation_requested";
      await db.boxSubscription.update({ where: { id: subscription.id }, data: { status: nextStatus, cancelledAt: nextStatus === "cancelled" ? new Date() : null } });
      await recordAudit(shop, "box.cancellation_requested", { actor: customer.email, targetType: "box_subscription", targetId: subscription.id, status: nextStatus }).catch(() => {});
      return json(request, { ok: true, customer: publicCustomer(await freshCustomer(customer.id)) });
    }

    throw new Error("Acción de cliente no reconocida.");
  } catch (error) {
    const status = /sesión|caducad/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
