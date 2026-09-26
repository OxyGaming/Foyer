/**
 * Crée un compte (et son foyer s'il n'en a pas encore).
 *
 *   npm run user:create -- --email jessy@exemple.fr --name Jessy --household "Foyer Achille"
 *
 * Le mot de passe est demandé de façon interactive (jamais passé en argument,
 * pour ne pas finir dans l'historique du shell). Pour rattacher le compte à un
 * foyer existant, préférer le code d'invitation depuis l'application (Réglages).
 */
import { parseArgs } from "node:util";
import readline from "node:readline";
import { hashPassword } from "../auth";
import { prisma } from "../db";
import { createHousehold } from "../household";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, household: { type: "string" } },
});

function ask(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Masque la saisie du mot de passe.
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    out._writeToOutput = (s: string) => out.output.write(s.includes(question) ? s : "*");
  }
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a); }));
}

const email = (values.email ?? (await ask("Email : "))).trim().toLowerCase();
if (!email.includes("@")) throw new Error("Email invalide");
if (await prisma.user.findUnique({ where: { email } })) throw new Error("Un compte existe déjà avec cet email");

const password = await ask("Mot de passe (8 caractères min.) : ", true);
if (password.length < 8) throw new Error("Mot de passe trop court");

const user = await prisma.$transaction(async (tx) => {
  const u = await tx.user.create({ data: { email, name: values.name ?? null, passwordHash: await hashPassword(password) } });
  await createHousehold(tx, values.household ?? "Mon foyer", u.id);
  return u;
});
console.log(`✔ Compte créé : ${user.email} (foyer « ${values.household ?? "Mon foyer"} »)`);
await prisma.$disconnect();
