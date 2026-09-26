// Connexion « utile » : le navigateur peut se croire en ligne (Wi-Fi du magasin,
// réseau saturé) alors que le serveur est injoignable. Dans ce cas on bascule
// TanStack Query hors ligne : les actions se mettent en file (et sont
// persistées) au lieu d'échouer, puis on vérifie périodiquement le retour.
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

let probe: ReturnType<typeof setInterval> | null = null;

export function markServerUnreachable() {
  if (!onlineManager.isOnline()) return;
  onlineManager.setOnline(false);
  if (probe) return;
  probe = setInterval(async () => {
    if (!navigator.onLine) return;
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      if (r.ok) markServerReachable();
    } catch {
      /* toujours injoignable */
    }
  }, 5000);
}

export function markServerReachable() {
  if (probe) clearInterval(probe);
  probe = null;
  if (!onlineManager.isOnline()) onlineManager.setOnline(true);
}

export const useOnline = () => useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () => onlineManager.isOnline());
