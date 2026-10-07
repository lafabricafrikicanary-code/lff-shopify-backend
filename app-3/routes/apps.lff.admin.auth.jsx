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
import { recordAudit } from "../lib/lff.server";

const shopDomain = () => process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";

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

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json();
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

function requestWithBearer(request, token) {
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  // requireAdminSession only reads the Authorization header. The original
  // request body has already been consumed, so use a fresh lightweight GET.
  return new Request(request.url, { method: "GET", headers });
}

// Health/wake endpoint. It deliberately avoids database work so that the
// storefront can confirm that Render is awake before the user presses login.
export const loader = async () => {
  return Response.json({ ok: true, service: "lff-admin-app-proxy", version: "v108" }, {
    headers: { "Cache-Control": "no-store" },
  });
};

export const action = async ({ request }) => {
  try {
    const body = await readBody(request);
    const intent = String(body.intent || "login");
    const shop = shopDomain();
    const proxyToken = String(body.__lffAdminToken || "").trim();
    delete body.__lffAdminToken;

    if (intent === "login") {
      await ensureDefaultAdminAccounts(shop);
      const user = await findAdminForLogin(shop, body.username);
      if (!user) return Response.json({ ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
      assertNotLocked(user);
      if (!user.enabled) return Response.json({ ok: false, error: "Esta cuenta está desactivada." }, { status: 403 });
      if (!verifyPassword(body.password, user.passwordSalt, user.passwordHash)) {
        await noteFailedAdminLogin(user);
        return Response.json({ ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
      }
      const token = await issueAdminSession(user);
      await recordAudit(shop, "admin.login", { actor: user.displayName, targetType: "admin_user", targetId: user.id });
      const fresh = await db.adminUser.findUnique({ where: { id: user.id } });
      return Response.json({ ok: true, token, user: adminPublic(fresh) }, { headers: { "Cache-Control": "no-store" } });
    }

    // Shopify's App Proxy does not guarantee forwarding Authorization exactly
    // as sent by the browser, so the theme sends the admin token in the JSON
    // body. Recreate an internal request with the Bearer token here.
    const authRequest = requestWithBearer(request, proxyToken);
    const { user, session, token } = await requireAdminSession(authRequest);

    if (intent === "heartbeat") {
      await heartbeatAdminSession(session, user);
      const fresh = await db.adminUser.findUnique({ where: { id: user.id } });
      return Response.json({ ok: true, user: adminPublic(fresh) });
    }

    if (intent === "arcade-analytics-summary") {
      const sessions = await db.arcadeSession.findMany({
        where: { shop, endedAt: { not: null } },
        orderBy: { endedAt: "desc" },
        take: 500,
      });
      return Response.json({ ok: true, sessions: sessions.map(arcadeSessionPublic), limit: 500 });
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
      return Response.json({ ok: true });
    }

    if (intent === "team") {
      if (user.role !== "owner") return Response.json({ ok: false, error: "Solo Alejandro puede gestionar administradores." }, { status: 403 });
      const admins = await db.adminUser.findMany({ where: { shop }, orderBy: { displayName: "asc" } });
      return Response.json({ ok: true, admins: admins.map(adminPublic) });
    }

    if (intent === "toggle-gabriel") {
      if (user.role !== "owner") return Response.json({ ok: false, error: "Solo Alejandro puede gestionar esta cuenta." }, { status: 403 });
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
      return Response.json({ ok: true, enabled });
    }

    if (intent === "reset-gabriel-time") {
      if (user.role !== "owner") return Response.json({ ok: false, error: "Solo Alejandro puede reiniciar el contador." }, { status: 403 });
      const gabriel = await db.adminUser.findFirst({ where: { shop, username: { equals: "Gabriel", mode: "insensitive" } } });
      if (!gabriel) throw new Error("No se encontró la cuenta Gabriel.");
      await db.adminUser.update({ where: { id: gabriel.id }, data: { totalActiveSeconds: 0 } });
      await recordAudit(shop, "admin.activity_reset", { actor: user.displayName, targetType: "admin_user", targetId: gabriel.id });
      return Response.json({ ok: true });
    }

    if (intent === "logout") {
      await deleteAdminSession(token);
      await recordAudit(shop, "admin.logout", { actor: user.displayName, targetType: "admin_user", targetId: user.id });
      return Response.json({ ok: true });
    }

    throw new Error("Acción administrativa no reconocida.");
  } catch (error) {
    console.error("[LFF ADMIN APP PROXY V108]", error);
    const message = error?.message || "Error interno del panel de administración.";
    const status = /sesión|autorizad|caducada/i.test(message) ? 401 : 400;
    return Response.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
};
