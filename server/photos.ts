import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { prisma } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

const FULL_MAX = 1600;
const THUMB_MAX = 480;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type PhotoVariant = "full" | "thumb";

export function photoFile(id: string, variant: PhotoVariant) {
  return path.join(env.uploadDir, variant === "thumb" ? `${id}_thumb.webp` : `${id}.webp`);
}

/** Redimensionne, corrige l'orientation EXIF, supprime les métadonnées et encode en WebP. */
export async function storePhoto(householdId: string, input: Buffer) {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new HttpError(415, "Format d'image non reconnu");
  }
  if (!meta.width || !meta.height) throw new HttpError(415, "Format d'image non reconnu");

  const base = sharp(input, { failOn: "none" }).rotate();
  const full = await base
    .clone()
    .resize({ width: FULL_MAX, height: FULL_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base
    .clone()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  const photo = await prisma.photo.create({
    data: { householdId, width: full.info.width, height: full.info.height },
  });
  await fs.mkdir(env.uploadDir, { recursive: true });
  await fs.writeFile(photoFile(photo.id, "full"), full.data);
  await fs.writeFile(photoFile(photo.id, "thumb"), thumb);
  return { id: photo.id, width: photo.width, height: photo.height };
}

async function isReferenced(id: string) {
  const [r, p, c] = await Promise.all([
    prisma.recipe.count({ where: { photoId: id } }),
    prisma.product.count({ where: { photoId: id } }),
    prisma.category.count({ where: { photoId: id } }),
  ]);
  return r + p + c > 0;
}

/** Supprime une photo (ligne + fichiers) si plus rien ne la référence. */
export async function releasePhoto(id: string | null | undefined) {
  if (!id || (await isReferenced(id))) return;
  await prisma.photo.deleteMany({ where: { id } });
  await Promise.all(
    (["full", "thumb"] as const).map((v) => fs.rm(photoFile(id, v), { force: true })),
  );
}

/** Vérifie qu'un photoId fourni par le client appartient bien au foyer. */
export async function assertPhoto(householdId: string, id: string | null) {
  if (!id) return;
  const p = await prisma.photo.findFirst({ where: { id, householdId }, select: { id: true } });
  if (!p) throw new HttpError(400, "Photo inconnue");
}

/** Nettoie les photos envoyées mais jamais rattachées (formulaire abandonné). */
export async function cleanupOrphanPhotos() {
  const old = await prisma.photo.findMany({
    where: {
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      recipes: { none: {} },
      products: { none: {} },
      categories: { none: {} },
    },
    select: { id: true },
  });
  for (const p of old) await releasePhoto(p.id);
  return old.length;
}
