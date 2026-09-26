import { Camera, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadPhoto } from "@/lib/image";
import { Spinner, Thumb } from "./ui";

/**
 * Prendre une photo, choisir dans la galerie, remplacer ou supprimer.
 * Deux <input> distincts : `capture` ouvre directement l'appareil photo sur mobile.
 */
export function PhotoPicker({ value, onChange, fallback, aspect = "aspect-[4/3]" }: { value: string | null; onChange: (id: string | null) => void; fallback: ReactNode; aspect?: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const photo = await uploadPhoto(file);
      onChange(photo.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi de la photo impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className={`relative overflow-hidden rounded-2xl ${aspect}`}>
        <Thumb photoId={value} variant="full" fallback={<div className="text-5xl">{fallback}</div>} className="size-full" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Spinner className="size-8 text-white" />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-soft flex-1" onClick={() => camera.current?.click()} disabled={busy}>
          <Camera className="size-4" /> {value ? "Reprendre" : "Photo"}
        </button>
        <button type="button" className="btn-soft flex-1" onClick={() => gallery.current?.click()} disabled={busy}>
          {value ? <RefreshCw className="size-4" /> : <ImagePlus className="size-4" />} {value ? "Remplacer" : "Galerie"}
        </button>
        {value && (
          <button type="button" className="btn-danger" onClick={() => onChange(null)} disabled={busy} aria-label="Retirer la photo">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}
