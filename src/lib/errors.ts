import { toast } from "sonner";
import { isOfflineError } from "./api";

/** Affiche l'erreur, sauf coupure réseau : le bandeau « Hors connexion » l'indique déjà. */
export function toastError(e: Error) {
  if (!isOfflineError(e)) toast.error(e.message);
}
