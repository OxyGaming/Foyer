import { api } from "./api";

const MAX_SIDE = 2048;

/**
 * Réduit l'image côté téléphone avant l'envoi (une photo de 12 Mpx pèse
 * souvent 4-6 Mo). Le serveur la recompresse ensuite en WebP + miniature.
 * Si le navigateur ne sait pas décoder le fichier, on l'envoie tel quel.
 */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return blob ?? file;
  } catch {
    return file;
  }
}

export type UploadedPhoto = { id: string; width: number; height: number };

export async function uploadPhoto(file: File): Promise<UploadedPhoto> {
  const blob = await shrink(file);
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  return api.post<UploadedPhoto>("/photos", form);
}
