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
import { router } from "./router";
import "./index.css";

const DAY = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * DAY, // doit couvrir la durée de persistance
      // Pas de nouvelle tentative sur une erreur « métier » (401, 404…).
      retry: (count, err) => !(err instanceof ApiError && err.status > 0) && count < 2,
      // Hors connexion : on sert le cache persistant sans erreur.
      networkMode: "offlineFirst",
    },
  },
});
qcRef.current = queryClient;

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
        maxAge: 30 * DAY,
        buster: "v1",
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" && q.queryKey[0] !== "search" },
      }}
    >
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: "inherit" } }} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
