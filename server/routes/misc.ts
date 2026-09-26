import fs from "node:fs/promises";
import { Hono } from "hono";
import { type AuthVars, requireAuth } from "../auth";
import { prisma } from "../db";
import { HttpError, notFound } from "../http";
import { MAX_UPLOAD_BYTES, photoFile, releasePhoto, storePhoto } from "../photos";
import { matches } from "../../shared/text";

// ─── Photos ──────────────────────────────────────────────────────────────────

export const photoRoutes = new Hono<{ Variables: AuthVars }>();
photoRoutes.use(requireAuth);

photoRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) throw new HttpError(400, "Aucune image reçue");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Image trop lourde (15 Mo max)");
  const photo = await storePhoto(c.var.householdId, Buffer.from(await file.arrayBuffer()));
  return c.json(photo, 201);
});

photoRoutes.get("/:id/:variant", async (c) => {
  const { id, variant } = c.req.param();
  if (variant !== "full" && variant !== "thumb") notFound("Photo");
  const photo = await prisma.photo.findFirst({ where: { id, householdId: c.var.householdId }, select: { id: true } });
  if (!photo) notFound("Photo");
  let data: Buffer;
  try {
    data = await fs.readFile(photoFile(id, variant));
  } catch {
    notFound("Photo");
  }
  // Une photo n'est jamais modifiée (remplacer = nouvel id) : cache long.
  return c.body(new Uint8Array(data), 200, {
    "Content-Type": "image/webp",
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});

/** Suppression d'une photo non rattachée (ex. retirée d'un formulaire avant enregistrement). */
photoRoutes.delete("/:id", async (c) => {
  const photo = await prisma.photo.findFirst({ where: { id: c.req.param("id"), householdId: c.var.householdId }, select: { id: true } });
  if (photo) await releasePhoto(photo.id);
  return c.json({ ok: true });
});

// ─── Recherche globale ───────────────────────────────────────────────────────

export const searchRoutes = new Hono<{ Variables: AuthVars }>();
searchRoutes.use(requireAuth);

// Volume d'un foyer (quelques centaines de lignes) : filtrage en mémoire,
// insensible aux accents — ce que LIKE de SQLite ne sait pas faire.
searchRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 80);
  if (!q.trim()) return c.json({ recipes: [], products: [], categories: [], locations: [] });
  const householdId = c.var.householdId;
  const [recipes, products, categories, locations] = await Promise.all([
    prisma.recipe.findMany({
      where: { householdId },
      select: {
        id: true, name: true, photoId: true, tags: true, description: true,
        ingredients: { select: { name: true } },
        categories: { select: { category: { select: { name: true } } } },
      },
    }),
    prisma.product.findMany({
      where: { householdId },
      select: {
        id: true, name: true, photoId: true, brand: true, reference: true, unit: true,
        category: { select: { name: true } },
        stockItems: { select: { quantity: true, location: { select: { name: true } } } },
      },
    }),
    prisma.category.findMany({ where: { householdId }, select: { id: true, name: true, kind: true, icon: true } }),
    prisma.location.findMany({ where: { householdId }, select: { id: true, name: true, icon: true } }),
  ]);

  const recipeHits = recipes
    .map((r) => {
      const ingredient = r.ingredients.find((i) => matches(i.name, q))?.name;
      const hit = matches(r.name, q) || matches(r.tags, q) || matches(r.description, q) || !!ingredient || r.categories.some((rc) => matches(rc.category.name, q));
      return hit ? { id: r.id, name: r.name, photoId: r.photoId, reason: ingredient && !matches(r.name, q) ? `contient ${ingredient}` : null } : null;
    })
    .filter((r) => r !== null);

  const productHits = products
    .filter((p) => matches(p.name, q) || matches(p.brand, q) || matches(p.reference, q) || matches(p.category?.name, q) || p.stockItems.some((s) => matches(s.location?.name, q)))
    .map((p) => ({ id: p.id, name: p.name, photoId: p.photoId, brand: p.brand, unit: p.unit, category: p.category?.name ?? null }));

  return c.json({
    recipes: recipeHits.slice(0, 30),
    products: productHits.slice(0, 30),
    categories: categories.filter((x) => matches(x.name, q)),
    locations: locations.filter((x) => matches(x.name, q)),
  });
});
