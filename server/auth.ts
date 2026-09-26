import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { prisma } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

const COOKIE = "foyer_session";
const SESSION_DAYS = 90;
const REFRESH_BELOW_DAYS = 45;
const DAY = 24 * 60 * 60 * 1000;

export type AuthVars = { userId: string; householdId: string };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export async function startSession(c: Context, userId: string, householdId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await prisma.session.create({ data: { id: sha256(token), userId, householdId, expiresAt } });
  writeCookie(c, token, expiresAt);
}

export async function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  deleteCookie(c, COOKIE, { path: "/" });
}

function writeCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Exige une session valide ; prolonge automatiquement les sessions actives. */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, "Non connecté");
  const session = await prisma.session.findUnique({ where: { id: sha256(token) } });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    throw new HttpError(401, "Session expirée");
  }
  if (session.expiresAt.getTime() - Date.now() < REFRESH_BELOW_DAYS * DAY) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt } });
    writeCookie(c, token, expiresAt);
  }
  c.set("userId", session.userId);
  c.set("householdId", session.householdId);
  await next();
};

// Limitation simple des tentatives de connexion (mémoire, suffisant pour une instance unique).
const attempts = new Map<string, { count: number; until: number }>();
export function checkRateLimit(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.count >= 10) {
    throw new HttpError(429, "Trop de tentatives, réessayez dans quelques minutes");
  }
}
export function recordFailure(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) attempts.set(key, { count: 1, until: now + 15 * 60 * 1000 });
  else a.count++;
}
export const clearFailures = (key: string) => attempts.delete(key);
