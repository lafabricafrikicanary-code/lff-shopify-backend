import db from "../db.server";
import {
  assertNotLocked,
  deleteCommercialSession,
  hashPassword,
  issueCommercialSession,
  normalizeCommercialLogin,
  noteFailedCommercialLogin,
  requireCommercialSession,
  verifyPassword,
} from "../lib/api-auth.server";
import {
  assertAllowedOrigin,
  bodyData,
  corsHeaders,
  json,
} from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";

const shopDomain = () => process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";

function publicCommercial(commercial) {
  return {
    id: commercial.id,
    name: commercial.name,
    email: commercial.email,
    phone: commercial.phone,
    channel: commercial.channel,
    captureCode: commercial.captureCode,
    personalCode: commercial.personalCode,
    status: commercial.status,
    forceChange: commercial.forceChange,
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { commercial } = await requireCommercialSession(request);
    return json(request, { ok: true, commercial: publicCommercial(commercial) });
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
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const phone = String(body.phone || "").trim();
      const channel = String(body.channel || "").trim();
      const about = String(body.about || "").trim();
      const inviterCode = String(body.inviterCode || "").trim().toUpperCase();
      const password = String(body.password || "");
      if (!name || !email || !phone) throw new Error("Completa nombre, correo y teléfono.");
      if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
      const existingCommercial = await db.commercialUser.findFirst({ where: { shop, email: { equals: email, mode: "insensitive" } } });
      if (existingCommercial) throw new Error("Ya existe una cuenta comercial con ese correo.");
      const existingApplication = await db.commercialApplication.findUnique({ where: { shop_email: { shop, email } } });
      if (existingApplication?.status === "pending") throw new Error("Ya existe una solicitud pendiente con ese correo.");
      const record = hashPassword(password);
      const data = {
        shop,
        name,
        email,
        phone,
        channel: channel || null,
        about: about || null,
        inviterCode: inviterCode || null,
        passwordHash: record.hash,
        passwordSalt: record.salt,
        status: "pending",
        commercialId: null,
        decidedAt: null,
      };
      const application = existingApplication
        ? await db.commercialApplication.update({ where: { id: existingApplication.id }, data })
        : await db.commercialApplication.create({ data });
      await recordAudit(shop, "commercial.application_created", { targetType: "commercial_application", targetId: application.id, actor: email });
      return json(request, { ok: true, status: "pending" });
    }

    if (intent === "recover") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) throw new Error("Introduce tu correo.");
      await db.contactRequest.create({
        data: {
          shop,
          email,
          subject: "Recuperación de acceso comercial",
          message: "El comercial ha solicitado recuperar su contraseña.",
          status: "new",
        },
      });
      await recordAudit(shop, "commercial.recovery_requested", { actor: email, targetType: "commercial_access" });
      return json(request, { ok: true });
    }

    if (intent === "login") {
      const login = normalizeCommercialLogin(body.username);
      const commercial = await db.commercialUser.findFirst({
        where: {
          shop,
          OR: [
            { email: { equals: login, mode: "insensitive" } },
            { name: { equals: String(body.username || "").trim(), mode: "insensitive" } },
          ],
        },
      });
      if (!commercial || !commercial.passwordHash || !commercial.passwordSalt) {
        return json(request, { ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
      }
      assertNotLocked(commercial);
      if (commercial.status !== "active") return json(request, { ok: false, error: "Esta cuenta comercial no está activa." }, { status: 403 });
      if (!verifyPassword(body.password, commercial.passwordSalt, commercial.passwordHash)) {
        await noteFailedCommercialLogin(commercial);
        return json(request, { ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
      }
      const token = await issueCommercialSession(commercial);
      await recordAudit(shop, "commercial.login", { actor: commercial.email || commercial.name, targetType: "commercial", targetId: commercial.id });
      const fresh = await db.commercialUser.findUnique({ where: { id: commercial.id } });
      return json(request, { ok: true, token, commercial: publicCommercial(fresh) });
    }

    const auth = await requireCommercialSession(request);
    const { commercial, token } = auth;

    if (intent === "change-password") {
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (next.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
      if (!verifyPassword(current, commercial.passwordSalt, commercial.passwordHash)) throw new Error("La contraseña actual no es correcta.");
      const record = hashPassword(next);
      await db.commercialUser.update({ where: { id: commercial.id }, data: { passwordHash: record.hash, passwordSalt: record.salt, forceChange: false } });
      await recordAudit(shop, "commercial.password_changed", { actor: commercial.email || commercial.name, targetType: "commercial", targetId: commercial.id });
      return json(request, { ok: true });
    }

    if (intent === "logout") {
      await deleteCommercialSession(token);
      return json(request, { ok: true });
    }

    throw new Error("Acción comercial no reconocida.");
  } catch (error) {
    const status = /sesión|caducada/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
