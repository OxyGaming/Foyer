/**
 * Compte de démonstration pour le développement local UNIQUEMENT.
 *   npm run seed:dev
 * Refuse de s'exécuter en production.
 */
import { hashPassword } from "../auth";
import { prisma } from "../db";
import { env } from "../env";
import { createHousehold } from "../household";

export const DEV_EMAIL = "demo@foyer.test";
export const DEV_PASSWORD = "demo-foyer-2026";

if (env.isProd) throw new Error("seed-dev interdit en production");

const existing = await prisma.user.findUnique({ where: { email: DEV_EMAIL } });
if (existing) {
  console.log(`Compte de démo déjà présent : ${DEV_EMAIL}`);
} else {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: DEV_EMAIL, name: "Démo", passwordHash: await hashPassword(DEV_PASSWORD) } });
    await createHousehold(tx, "Foyer démo", u.id);
  });
  console.log(`Compte de démo créé : ${DEV_EMAIL} (mot de passe dans server/scripts/seed-dev.ts)`);
}
await prisma.$disconnect();
