import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(what = "Élément"): never {
  throw new HttpError(404, `${what} introuvable`);
}

// ─── Schémas zod « tout facultatif » ─────────────────────────────────────────
// Une chaîne vide devient null : on n'enregistre pas de valeurs vides.

export const optText = (max = 500) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });

/** Chaîne non nulle (défaut ""), pour les noms : jamais obligatoire. */
export const nameText = (max = 200) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => v?.trim() ?? "");

export const optNumber = z.number().finite().min(0).max(1e9).nullish().transform((v) => v ?? null);
export const optInt = z.number().int().min(0).max(1e6).nullish().transform((v) => v ?? null);
export const optId = z.string().max(64).nullish().transform((v) => v || null);

export async function parseJson<T extends z.ZodType>(req: { json: () => Promise<unknown> }, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Requête invalide");
  }
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, "Données invalides : " + r.error.issues.map((i) => i.path.join(".") + " " + i.message).join(", "));
  return r.data;
}
