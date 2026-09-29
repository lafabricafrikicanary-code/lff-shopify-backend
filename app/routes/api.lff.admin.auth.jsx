import db from "../db.server";
import {
  assertNotLocked,
  deleteAdminSession,
  ensureDefaultAdminAccounts,
  findAdminForLogin,
  hashPassword,
  heartbeatAdminSession,
  issueAdminSession,
  noteFailedAdminLogin,
  requireAdminSession,
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

function arcadeSessionPublic(row) {
  return {
    id: row.sessionKey,
    game: row.game,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    seconds: row.seconds,
    result: row.result,
    player: {
      customerId: row.customerId || null,
      visitorId: row.visitorId || null,
      label: row.playerLabel || "",
    },
  };
}

function adminPublic(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    enabled: user.enabled,
    forceChange: user.forceChange,
    lastLoginAt: user.lastLoginAt,
    lastSeenAt: user.lastSeenAt,
    totalActiveSeconds: user.totalActiveSeconds,
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { user } = await requireAdminSession(request);
    return json(request, { ok: true, user: adminPublic(user) });
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

    if (intent === "login") {
      await ensureDefaultAdminAccounts(shop);
      const user = await findAdminForLogin(shop, body.username);
      if (!user) return json(request, { ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
      assertNotLocked(user);
      if (!user.enabled) return json(request, { ok: false, error: "Esta cuenta está desactivada." }, { status: 403 });
      if (!verifyPassword(body.password, user.passwordSalt, user.passwordHash)) {
        await noteFailedAdminLogin(user);
        return json(request, { ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
      }
      const token = await issueAdminSession(user);
      await recordAudit(shop, "admin.login", { actor: user.displayName, targetType: "admin_user", targetId: user.id });
      const fresh = await db.adminUser.findUnique({ where: { id: user.id } });
      return json(request, { ok: true, token, user: adminPublic(fresh) });
    }

    const auth = await requireAdminSession(request);
    const { user, session, token } = auth;

    if (intent === "heartbeat") {
      await heartbeatAdminSession(session, user);
      const fresh = await db.adminUser.findUnique({ where: { id: user.id } });
      return json(request, { ok: true, user: adminPublic(fresh) });
    }

    if (intent === "arcade-analytics-summary") {
      const sessions = await db.arcadeSession.findMany({
        where: { shop, endedAt: { not: null } },
        orderBy: { endedAt: "desc" },
        take: 500,
      });
      return json(request, {
        ok: true,
        sessions: sessions.map(arcadeSessionPublic),
        limit: 500,
      });
    }

    if (intent === "change-password") {
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (next.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
      if (!verifyPassword(current, user.passwordSalt, user.passwordHash)) throw new Error("La contraseña actual no es correcta.");
      const record = hashPassword(next);
      await db.adminUser.update({
        where: { id: user.id },
        data: { passwordHash: record.hash, passwordSalt: record.salt, forceChange: false },
      });
      await recordAudit(shop, "admin.password_changed", { actor: user.displayName, targetType: "admin_user", targetId: user.id });
      return json(request, { ok: true });
    }

    if (intent === "team") {
      if (user.role !== "owner") return json(request, { ok: false, error: "Solo Alejandro puede gestionar administradores." }, { status: 403 });
      const admins = await db.adminUser.findMany({ where: { shop }, orderBy: { displayName: "asc" } });
      return json(request, { ok: true, admins: admins.map(adminPublic) });
    }

    if (intent === "toggle-gabriel") {
      if (user.role !== "owner") return json(request, { ok: false, error: "Solo Alejandro puede gestionar esta cuenta." }, { status: 403 });
      const gabriel = await db.adminUser.findFirst({ where: { shop, username: { equals: "Gabriel", mode: "insensitive" } } });
      if (!gabriel) throw new Error("No se encontró la cuenta Gabriel.");
      const enabled = Boolean(body.enabled);
      await db.adminUser.update({ where: { id: gabriel.id }, data: { enabled } });
      if (!enabled) await db.adminSession.deleteMany({ where: { adminUserId: gabriel.id } });
      await recordAudit(shop, "admin.account_toggled", {
        actor: user.displayName,
        targetType: "admin_user",
        targetId: gabriel.id,
        enabled,
      });
      return json(request, { ok: true, enabled });
    }

    if (intent === "reset-gabriel-time") {
      if (user.role !== "owner") return json(request, { ok: false, error: "Solo Alejandro puede reiniciar el contador." }, { status: 403 });
      const gabriel = await db.adminUser.findFirst({ where: { shop, username: { equals: "Gabriel", mode: "insensitive" } } });
      if (!gabriel) throw new Error("No se encontró la cuenta Gabriel.");
      await db.adminUser.update({ where: { id: gabriel.id }, data: { totalActiveSeconds: 0 } });
      await recordAudit(shop, "admin.activity_reset", { actor: user.displayName, targetType: "admin_user", targetId: gabriel.id });
      return json(request, { ok: true });
    }

    if (intent === "logout") {
      await deleteAdminSession(token);
      await recordAudit(shop, "admin.logout", { actor: user.displayName, targetType: "admin_user", targetId: user.id });
      return json(request, { ok: true });
    }

    throw new Error("Acción administrativa no reconocida.");
  } catch (error) {
    const status = /sesión|autorizad|caducada/i.test(error.message) ? 401 : 400;
    return json(request, { ok: false, error: error.message }, { status });
  }
};
