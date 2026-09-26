import crypto from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVars,
  checkRateLimit,
  clearFailures,
  endSession,
  hashPassword,
  recordFailure,
  requireAuth,
  startSession,
  verifyPassword,
} from "../auth";
import { prisma } from "../db";
import { HttpError, optText, parseJson } from "../http";

export const authRoutes = new Hono<{ Variables: AuthVars }>();

const email = z.string().trim().toLowerCase().email().max(200);

authRoutes.post("/login", async (c) => {
  const body = await parseJson(c.req, z.object({ email, password: z.string().max(200) }));
  const key = `${c.req.header("x-forwarded-for") ?? "local"}|${body.email}`;
  checkRateLimit(key);
  const user = await prisma.user.findUnique({
    where: { email: body.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
  if (!user || !ok || !user.memberships[0]) {
    recordFailure(key);
    throw new HttpError(401, "Email ou mot de passe incorrect");
  }
  clearFailures(key);
  await startSession(c, user.id, user.memberships[0].householdId);
  return c.json({ ok: true });
});

/** Inscription uniquement via un code d'invitation d'un foyer existant. */
authRoutes.post("/register", async (c) => {
  const body = await parseJson(
    c.req,
    z.object({ code: z.string().trim().toUpperCase().max(32), email, password: z.string().min(8, "8 caractères minimum").max(200), name: optText(80) }),
  );
  const invite = await prisma.invite.findUnique({ where: { code: body.code } });
  if (!invite || invite.usedAt || invite.expiresAt.getTime() < Date.now()) {
    throw new HttpError(400, "Code d'invitation invalide ou expiré");
  }
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw new HttpError(409, "Un compte existe déjà avec cet email");
  }
  const passwordHash = await hashPassword(body.password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
    await tx.householdMember.create({ data: { householdId: invite.householdId, userId: u.id } });
    await tx.invite.update({ where: { id: invite.id }, data: { usedAt: new Date(), usedById: u.id } });
    return u;
  });
  await startSession(c, user.id, invite.householdId);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const [user, household] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: c.var.userId }, select: { id: true, email: true, name: true } }),
    prisma.household.findUniqueOrThrow({
      where: { id: c.var.householdId },
      select: {
        id: true,
        name: true,
        members: { select: { role: true, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      },
    }),
  ]);
  return c.json({
    user,
    household: { id: household.id, name: household.name, members: household.members.map((m) => ({ ...m.user, role: m.role })) },
  });
});

authRoutes.post("/password", requireAuth, async (c) => {
  const body = await parseJson(c.req, z.object({ current: z.string().max(200), next: z.string().min(8, "8 caractères minimum").max(200) }));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.var.userId } });
  if (!(await verifyPassword(body.current, user.passwordHash))) throw new HttpError(400, "Mot de passe actuel incorrect");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } });
  return c.json({ ok: true });
});

// ─── Foyer ───────────────────────────────────────────────────────────────────

export const householdRoutes = new Hono<{ Variables: AuthVars }>();
householdRoutes.use(requireAuth);

householdRoutes.patch("/", async (c) => {
  const body = await parseJson(c.req, z.object({ name: optText(80) }));
  await prisma.household.update({ where: { id: c.var.householdId }, data: { name: body.name ?? "Mon foyer" } });
  return c.json({ ok: true });
});

householdRoutes.patch("/me", async (c) => {
  const body = await parseJson(c.req, z.object({ name: optText(80) }));
  await prisma.user.update({ where: { id: c.var.userId }, data: { name: body.name } });
  return c.json({ ok: true });
});

householdRoutes.get("/invites", async (c) => {
  const invites = await prisma.invite.findMany({
    where: { householdId: c.var.householdId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, expiresAt: true },
  });
  return c.json(invites);
});

householdRoutes.post("/invites", async (c) => {
  // Code lisible sans caractères ambigus (0/O, 1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join("");
  const invite = await prisma.invite.create({
    data: {
      householdId: c.var.householdId,
      createdById: c.var.userId,
      code,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true, code: true, expiresAt: true },
  });
  return c.json(invite, 201);
});

householdRoutes.delete("/invites/:id", async (c) => {
  await prisma.invite.deleteMany({ where: { id: c.req.param("id"), householdId: c.var.householdId } });
  return c.json({ ok: true });
});
