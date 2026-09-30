import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import db from "../db.server";

const ADMIN_SESSION_HOURS = 12;
const COMMERCIAL_SESSION_DAYS = 30;
const CUSTOMER_SESSION_DAYS = 30;
const B2B_SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function normalizeLogin(value) {
  return String(value || "").trim().toLocaleLowerCase("es-ES");
}

export function hashPassword(password, salt = randomBytes(18).toString("hex")) {
  const value = String(password || "");
  if (!value) throw new Error("La contraseña no puede estar vacía.");
  return {
    salt,
    hash: scryptSync(value, salt, 64).toString("hex"),
  };
}

export function verifyPassword(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function digestToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function expiresIn({ hours = 0, days = 0 }) {
  const d = new Date();
  d.setHours(d.getHours() + hours + days * 24);
  return d;
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export async function ensureDefaultAdminAccounts(shop) {
  const defaults = [
    {
      username: "Alejandro",
      displayName: "Alejandro Cabrera",
      role: "owner",
      initialPassword: "Alejandro",
    },
    {
      username: "Gabriel",
      displayName: "Gabriel Castillo",
      role: "admin",
      initialPassword: "Gabriel",
    },
  ];

  for (const item of defaults) {
    const existing = await db.adminUser.findFirst({
      where: {
        shop,
        username: { equals: item.username, mode: "insensitive" },
      },
    });
    if (existing) continue;
    const record = hashPassword(item.initialPassword);
    await db.adminUser.create({
      data: {
        shop,
        username: item.username,
        displayName: item.displayName,
        role: item.role,
        passwordHash: record.hash,
        passwordSalt: record.salt,
        enabled: true,
        forceChange: false,
      },
    });
  }
}

export async function findAdminForLogin(shop, username) {
  return db.adminUser.findFirst({
    where: {
      shop,
      username: { equals: String(username || "").trim(), mode: "insensitive" },
    },
  });
}

export function assertNotLocked(user) {
  if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw new Error("Acceso bloqueado temporalmente por varios intentos fallidos.");
  }
}

export async function noteFailedAdminLogin(user) {
  const next = Number(user.failedAttempts || 0) + 1;
  const lock = next >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCK_MINUTES * 60_000)
    : null;
  await db.adminUser.update({
    where: { id: user.id },
    data: {
      failedAttempts: lock ? 0 : next,
      lockedUntil: lock,
    },
  });
}

export async function noteFailedCommercialLogin(user) {
  const next = Number(user.failedAttempts || 0) + 1;
  const lock = next >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCK_MINUTES * 60_000)
    : null;
  await db.commercialUser.update({
    where: { id: user.id },
    data: {
      failedAttempts: lock ? 0 : next,
      lockedUntil: lock,
    },
  });
}


export async function noteFailedCustomerLogin(user) {
  const next = Number(user.failedAttempts || 0) + 1;
  const lock = next >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCK_MINUTES * 60_000)
    : null;
  await db.customerAccount.update({
    where: { id: user.id },
    data: { failedAttempts: lock ? 0 : next, lockedUntil: lock },
  });
}

export async function noteFailedB2BLogin(company) {
  const next = Number(company.failedAttempts || 0) + 1;
  const lock = next >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCK_MINUTES * 60_000)
    : null;
  await db.b2BCompany.update({
    where: { id: company.id },
    data: { failedAttempts: lock ? 0 : next, lockedUntil: lock },
  });
}

export async function issueAdminSession(adminUser) {
  const token = randomBytes(32).toString("base64url");
  await db.adminSession.create({
    data: {
      tokenHash: digestToken(token),
      adminUserId: adminUser.id,
      expiresAt: expiresIn({ hours: ADMIN_SESSION_HOURS }),
    },
  });
  await db.adminUser.update({
    where: { id: adminUser.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
  return token;
}

export async function issueCommercialSession(commercial) {
  const token = randomBytes(32).toString("base64url");
  await db.commercialSession.create({
    data: {
      tokenHash: digestToken(token),
      commercialId: commercial.id,
      expiresAt: expiresIn({ days: COMMERCIAL_SESSION_DAYS }),
    },
  });
  await db.commercialUser.update({
    where: { id: commercial.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });
  return token;
}


export async function issueCustomerSession(customer) {
  const token = randomBytes(32).toString("base64url");
  await db.customerSession.create({
    data: {
      tokenHash: digestToken(token),
      customerId: customer.id,
      expiresAt: expiresIn({ days: CUSTOMER_SESSION_DAYS }),
    },
  });
  await db.customerAccount.update({
    where: { id: customer.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return token;
}

export async function issueB2BSession(company) {
  const token = randomBytes(32).toString("base64url");
  await db.b2BSession.create({
    data: {
      tokenHash: digestToken(token),
      companyId: company.id,
      expiresAt: expiresIn({ days: B2B_SESSION_DAYS }),
    },
  });
  await db.b2BCompany.update({
    where: { id: company.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return token;
}

export async function requireAdminSession(request) {
  const token = bearerToken(request);
  if (!token) throw new Error("Sesión administrativa no válida.");
  const session = await db.adminSession.findUnique({
    where: { tokenHash: digestToken(token) },
    include: { adminUser: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.adminUser.enabled) {
    if (session) await db.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    throw new Error("Sesión administrativa caducada o desactivada.");
  }
  return { token, session, user: session.adminUser };
}

export async function requireCommercialSession(request) {
  const token = bearerToken(request);
  if (!token) throw new Error("Sesión comercial no válida.");
  const session = await db.commercialSession.findUnique({
    where: { tokenHash: digestToken(token) },
    include: { commercial: true },
  });
  if (!session || session.expiresAt <= new Date() || session.commercial.status !== "active") {
    if (session) await db.commercialSession.delete({ where: { id: session.id } }).catch(() => {});
    throw new Error("Sesión comercial caducada o suspendida.");
  }
  return { token, session, commercial: session.commercial };
}


export async function requireCustomerSession(request) {
  const token = bearerToken(request);
  if (!token) throw new Error("Sesión de cliente no válida.");
  const session = await db.customerSession.findUnique({
    where: { tokenHash: digestToken(token) },
    include: { customer: { include: { clubProfile: true, boxSubscriptions: { orderBy: { createdAt: "desc" }, take: 3, include: { vouchers: true } } } } },
  });
  if (!session || session.expiresAt <= new Date() || session.customer.status !== "active") {
    if (session) await db.customerSession.delete({ where: { id: session.id } }).catch(() => {});
    throw new Error("Sesión de cliente caducada o desactivada.");
  }
  return { token, session, customer: session.customer };
}

export async function requireB2BSession(request) {
  const token = bearerToken(request);
  if (!token) throw new Error("Sesión de tienda no válida.");
  const session = await db.b2BSession.findUnique({
    where: { tokenHash: digestToken(token) },
    include: { company: true },
  });
  if (!session || session.expiresAt <= new Date() || session.company.status !== "active") {
    if (session) await db.b2BSession.delete({ where: { id: session.id } }).catch(() => {});
    throw new Error("Sesión de tienda caducada o suspendida.");
  }
  return { token, session, company: session.company };
}

export async function heartbeatAdminSession(session, user) {
  const now = new Date();
  const previous = session.lastSeenAt || now;
  const delta = Math.max(0, Math.min(90, Math.round((now - previous) / 1000)));
  await db.$transaction([
    db.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }),
    db.adminUser.update({
      where: { id: user.id },
      data: {
        lastSeenAt: now,
        totalActiveSeconds: { increment: delta },
      },
    }),
  ]);
  return delta;
}

export async function deleteAdminSession(token) {
  if (!token) return;
  await db.adminSession.deleteMany({ where: { tokenHash: digestToken(token) } });
}

export async function deleteCommercialSession(token) {
  if (!token) return;
  await db.commercialSession.deleteMany({ where: { tokenHash: digestToken(token) } });
}


export async function deleteCustomerSession(token) {
  if (!token) return;
  await db.customerSession.deleteMany({ where: { tokenHash: digestToken(token) } });
}

export async function deleteB2BSession(token) {
  if (!token) return;
  await db.b2BSession.deleteMany({ where: { tokenHash: digestToken(token) } });
}

export function normalizeCommercialLogin(value) {
  return normalizeLogin(value);
}

export function normalizeAccountLogin(value) {
  return normalizeLogin(value);
}
