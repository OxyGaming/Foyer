import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Home, Package, Search, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";

const TABS = [
  { to: "/", label: "Accueil", icon: Home, end: true },
  { to: "/recettes", label: "Recettes", icon: BookOpen },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/recherche", label: "Recherche", icon: Search },
];

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function OfflineBanner() {
  const online = useOnline();
  const pending = useIsMutating();
  const qc = useQueryClient();
  // Au retour du réseau : rafraîchit les données affichées.
  useEffect(() => {
    if (online) qc.invalidateQueries();
  }, [online, qc]);
  if (online) return null;
  return (
    <div className="flex items-center gap-2 bg-out px-4 py-2 text-sm text-bg">
      <WifiOff className="size-4 shrink-0" />
      <span>
        Hors connexion — données de la dernière synchronisation.
        {pending > 0 && ` ${pending} modification(s) en attente, envoyée(s) au retour du réseau.`}
      </span>
    </div>
  );
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Vérifie les mises à jour toutes les heures quand l'app reste ouverte.
      if (reg) setInterval(() => reg.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-bg shadow-xl">
      <span className="flex-1 text-sm">Une nouvelle version est disponible.</span>
      <button className="rounded-lg bg-bg px-3 py-1.5 text-sm font-semibold text-ink" onClick={() => updateServiceWorker(true)}>
        Mettre à jour
      </button>
    </div>
  );
}

export function Layout() {
  return (
    <div className="mx-auto min-h-dvh max-w-3xl">
      <OfflineBanner />
      <main className="pb-28">
        <Outlet />
      </main>
      <UpdatePrompt />
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-semibold transition ${isActive ? "text-brand" : "text-ink-3"}`}
            >
              {({ isActive }) => (
                <>
                  <span className={`flex h-8 w-14 items-center justify-center rounded-full transition ${isActive ? "bg-brand-soft" : ""}`}>
                    <Icon className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
