import db from "../db.server";
import {
  assertNotLocked,
  deleteB2BSession,
  hashPassword,
  issueB2BSession,
  noteFailedB2BLogin,
  requireB2BSession,
  verifyPassword,
} from "../lib/api-auth.server";
import { assertAllowedOrigin, bodyData, corsHeaders, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";
import { cleanEmail, cleanText, shopDomain } from "../lib/lff-v90.server";

function publicCompany(company) {
  return {
    id: company.id,
    companyName: company.companyName,
    contactName: company.contactName,
    contactEmail: company.contactEmail,
    phone: company.phone,
    taxId: company.taxId,
    website: company.website,
    status: company.status,
    referredByCode: company.referredByCode,
    commercialId: company.commercialId,
    priceTier: company.priceTier,
    firstOrderUsed: company.firstOrderUsed,
    forceChange: company.forceChange,
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { company } = await requireB2BSession(request);
    return json(request, { ok: true, company: publicCompany(company) });
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

    if (intent === "signup") {
      const companyName = cleanText(body.business || body.companyName, 180);
      const contactName = cleanText(body.name || body.contactName, 120);
      const contactEmail = cleanEmail(body.email || body.contactEmail);
      const phone = cleanText(body.phone, 40);
      const taxId = cleanText(body.tax || body.taxId, 50);
      const website = cleanText(body.web || body.website, 220);
      const referredByCode = cleanText(body.referral || body.referredByCode, 80).toUpperCase();
      const password = String(body.password || "");
      if (!companyName || !contactName || !contactEmail || !phone) throw new Error("Completa empresa, contacto, correo y teléfono.");
      if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
      const existing = await db.b2BCompany.findFirst({ where: { shop, contactEmail: { equals: contactEmail, mode: "insensitive" }, status: { not: "rejected" } } });
      if (existing) throw new Error("Ya existe una solicitud o cuenta con ese correo.");
      let commercial = null;
      if (referredByCode) {
        commercial = await db.commercialUser.findFirst({ where: { shop, status: "active", captureCode: { equals: referredByCode, mode: "insensitive" } } });
        if (!commercial) throw new Error("El código de comercial no es válido o no está activo.");
      }
      const record = hashPassword(password);
      const company = await db.b2BCompany.create({
        data: {
          shop,
          companyName,
          contactName,
          contactEmail,
          phone,
          taxId: taxId || null,
          website: website || null,
          referredByCode: commercial ? commercial.captureCode : null,
          commercialId: commercial?.id || null,
          priceTier: commercial ? "referred_55" : "direct_60",
          passwordHash: record.hash,
          passwordSalt: record.salt,
          status: "pending",
        },
      });
      await recordAudit(shop, "b2b.application_created", { actor: contactEmail, targetType: "b2b_company", targetId: company.id, commercialId: company.commercialId }).catch(() => {});
      return json(request, { ok: true, status: "pending", company: publicCompany(company) });
    }

    if (intent === "recover") {
      const email = cleanEmail(body.email);
      if (!email) throw new Error("Introduce un correo válido.");
      const company = await db.b2BCompany.findFirst({ where: { shop, contactEmail: { equals: email, mode: "insensitive" } } });
      await db.accessRecoveryRequest.create({ data: { shop, accountType: "b2b", accountId: company?.id || null, email, source: "self_service" } });
      await recordAudit(shop, "b2b.recovery_requested", { actor: email, targetType: "b2b_access", targetId: company?.id }).catch(() => {});
      return json(request, { ok: true });
    }

    if (intent === "login") {
      const email = cleanEmail(body.email || body.username);
      const company = email ? await db.b2BCompany.findFirst({ where: { shop, contactEmail: { equals: email, mode: "insensitive" } } }) : null;
      if (!company || !company.passwordHash || !company.passwordSalt) return json(request, { ok: false, error: "Correo o contraseña incorrectos." }, { status: 401 });
      assertNotLocked(company);
      if (company.status !== "active") return json(request, { ok: false, error: company.status === "pending" ? "La solicitud todavía está pendiente de aprobación." : "Esta cuenta de tienda no está activa." }, { status: 403 });
      if (!verifyPassword(body.password, company.passwordSalt, company.passwordHash)) {
        await noteFailedB2BLogin(company);
        return json(request, { ok: false, error: "Correo o contraseña incorrectos." }, { status: 401 });
      }
      const token = await issueB2BSession(company);
      await recordAudit(shop, "b2b.login", { actor: company.contactEmail, targetType: "b2b_company", targetId: company.id }).catch(() => {});
      return json(request, { ok: true, token, company: publicCompany(company) });
    }

    const { company, token } = await requireB2BSession(request);
    if (intent === "logout") {
      await deleteB2BSession(token);
      return json(request, { ok: true });
    }
    if (intent === "change-password") {
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (next.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
      if (!verifyPassword(current, company.passwordSalt, company.passwordHash)) throw new Error("La contraseña actual no es correcta.");
      const record = hashPassword(next);
      await db.b2BCompany.update({ where: { id: company.id }, data: { passwordHash: record.hash, passwordSalt: record.salt, forceChange: false } });
      await recordAudit(shop, "b2b.password_changed", { actor: company.contactEmail, targetType: "b2b_company", targetId: company.id }).catch(() => {});
      return json(request, { ok: true });
    }
    throw new Error("Acción B2B no reconocida.");
  } catch (error) {
    const status = /sesión|caducad/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
