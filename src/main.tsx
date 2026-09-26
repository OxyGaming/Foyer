import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { ApiError } from "./lib/api";
import { qcRef } from "./lib/queries";
import { registerShoppingMutations } from "./lib/shoppingQueries";
import { router } from "./router";
import "./index.css";

const DAY = 24 * 60 * 60 * 1000;
// Au-delà de ~24,8 jours (2^31 ms), setTimeout déborde et se déclenche aussitôt :
// le cache serait alors vidé immédiatement. On reste donc à 20 jours.
const CACHE_DAYS = 20 * DAY;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: CACHE_DAYS, // doit couvrir la durée de persistance
      // Pas de nouvelle tentative sur une erreur « métier » (401, 404…).
      retry: (count, err) => !(err instanceof ApiError && err.status > 0) && count < 2,
      // Hors connexion : on sert le cache persistant sans erreur.
      networkMode: "offlineFirst",
    },
  },
});
qcRef.current = queryClient;
registerShoppingMutations(queryClient);

// Le cache des lectures est conservé dans IndexedDB : recettes, stock et
// référentiels restent consultables hors connexion et au redémarrage.
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: "foyer-cache",
  throttleTime: 1000,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_DAYS,
        buster: "v2",
        // Toute requête ayant des données, même si le dernier rafraîchissement a échoué
        // (statut « error » hors connexion) : c'est justement ce cache qu'on veut garder.
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.data !== undefined && q.queryKey[0] !== "search" },
      }}
      // Rejoue les actions faites hors ligne (courses cochées…) une fois le cache restauré.
      // Sans attendre la fin : le provider patienterait jusqu'au retour du réseau avant d'afficher l'appli.
      onSuccess={() => {
        void queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries());
      }}
    >
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "inherit" } }} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
