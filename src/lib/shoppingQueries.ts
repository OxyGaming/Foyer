// Liste de courses. Les actions faites en magasin (cocher, ajouter, corriger,
// retirer) doivent marcher sans réseau, y compris si l'appli est fermée puis
// rouverte : elles sont déclarées par clé (setMutationDefaults) pour que
// TanStack Query puisse les persister dans IndexedDB et les rejouer, dans
// l'ordre (scope commun), au retour de la connexion.
import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, isOfflineError } from "./api";
import { toastError } from "./errors";
import { keys } from "./queries";
import type { ShoppingItem, ShoppingList } from "./types";

export const shoppingKey = ["shopping"] as const;
const scope = { id: "shopping" };
// Échec réseau : on réessaie (la mutation se met en pause dès que l'appli se sait hors ligne).
const offline = { retry: (_n: number, e: Error) => isOfflineError(e), retryDelay: 1000 };

export type ItemPatch = Partial<{ checked: boolean; quantity: number | null; resetQuantity: boolean; name: string; note: string | null; unit: string | null }>;
export type NewItem = { id: string; name: string; productId?: string | null; quantity?: number | null; unit?: string | null };

function editList(qc: QueryClient, fn: (items: ShoppingItem[]) => ShoppingItem[]) {
  qc.setQueryData<ShoppingList>(shoppingKey, (d) => (d ? { ...d, items: fn(d.items) } : d));
}

export function registerShoppingMutations(qc: QueryClient) {
  qc.setMutationDefaults(["shopping", "patch"], {
    scope,
    ...offline,
    mutationFn: ({ id, patch }: { id: string; patch: ItemPatch }) => api.patch<ShoppingItem>(`/shopping/items/${id}`, patch),
    onMutate: async ({ id, patch }: { id: string; patch: ItemPatch }) => {
      await qc.cancelQueries({ queryKey: shoppingKey });
      editList(qc, (items) =>
        items.map((i) => {
          if (i.id !== id) return i;
          const next = { ...i };
          if (patch.checked !== undefined) {
            next.checked = patch.checked;
            next.checkedAt = patch.checked ? new Date().toISOString() : null;
          }
          if (patch.quantity !== undefined) {
            if (i.source === "plan") next.quantityOverride = patch.quantity;
            else next.quantity = patch.quantity;
          }
          if (patch.resetQuantity) next.quantityOverride = null;
          if (patch.name !== undefined) next.name = patch.name;
          if (patch.note !== undefined) next.note = patch.note;
          if (patch.unit !== undefined) next.unit = patch.unit;
          return next;
        }),
      );
    },
  });
  qc.setMutationDefaults(["shopping", "add"], {
    scope,
    ...offline,
    mutationFn: (item: NewItem) => api.post<ShoppingItem>("/shopping/items", item),
    onMutate: async (item: NewItem) => {
      await qc.cancelQueries({ queryKey: shoppingKey });
      editList(qc, (items) => [
        ...items,
        {
          id: item.id, productId: item.productId ?? null, name: item.name, quantity: item.quantity ?? null, unit: item.unit ?? null,
          quantityOverride: null, neededQty: null, stockQty: null, source: "manual", recipesLabel: null, checked: false, checkedAt: null,
          note: null, position: items.length, createdAt: new Date().toISOString(),
        },
      ]);
    },
  });
  qc.setMutationDefaults(["shopping", "delete"], {
    scope,
    ...offline,
    mutationFn: (id: string) => api.del(`/shopping/items/${id}`),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: shoppingKey });
      editList(qc, (items) => items.filter((i) => i.id !== id));
    },
  });
}

const onError = toastError;

export const useShopping = (opts: { poll?: boolean } = {}) => {
  const pending = useIsMutating({ mutationKey: ["shopping"] });
  return useQuery({
    queryKey: shoppingKey,
    queryFn: () => api.get<ShoppingList>("/shopping"),
    // Pendant les courses à deux : on voit ce que l'autre a coché.
    refetchInterval: opts.poll && pending === 0 ? 15_000 : false,
  });
};

export const usePatchItem = () => {
  const qc = useQueryClient();
  return useMutation<ShoppingItem, Error, { id: string; patch: ItemPatch }>({
    mutationKey: ["shopping", "patch"],
    onError,
    onSettled: () => qc.isMutating({ mutationKey: ["shopping"] }) <= 1 && qc.invalidateQueries({ queryKey: shoppingKey }),
  });
};

export const useAddItem = () => {
  const qc = useQueryClient();
  return useMutation<ShoppingItem, Error, NewItem>({
    mutationKey: ["shopping", "add"],
    onError,
    onSettled: () => qc.isMutating({ mutationKey: ["shopping"] }) <= 1 && qc.invalidateQueries({ queryKey: shoppingKey }),
  });
};

export const useDeleteItem = () => {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationKey: ["shopping", "delete"],
    onError,
    onSettled: () => qc.isMutating({ mutationKey: ["shopping"] }) <= 1 && qc.invalidateQueries({ queryKey: shoppingKey }),
  });
};

// Actions « lourdes » : uniquement en ligne (elles relisent planning et stock).

export function useSyncShopping() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["shopping-online", "sync"],
    mutationFn: (range: { from: string; to: string }) => api.post<ShoppingList>("/shopping/sync", range),
    onSuccess: (d) => qc.setQueryData(shoppingKey, d),
    onError,
  });
}

export function useRestock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ShoppingList & { added: number }>("/shopping/restock"),
    onSuccess: (d) => {
      qc.setQueryData(shoppingKey, d);
      toast.success(d.added ? `${d.added} produit(s) ajouté(s)` : "Tout est déjà sur la liste");
    },
    onError,
  });
}

export function useClearChecked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ShoppingList>("/shopping/clear-checked"),
    onSuccess: (d) => qc.setQueryData(shoppingKey, d),
    onError,
  });
}

export type StockInEntry = {
  itemId: string;
  addToStock: boolean;
  quantity: number | null;
  locationId: string | null;
  /** Répartition sur plusieurs emplacements (prioritaire sur quantity/locationId). */
  splits?: { locationId: string | null; quantity: number }[];
  totalCents: number | null;
};

export function useStockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { entries: StockInEntry[]; storeName: string | null }) => api.post<ShoppingList & { stocked: number }>("/shopping/stock-in", body),
    onSuccess: (d) => {
      qc.setQueryData(shoppingKey, d);
      qc.invalidateQueries({ queryKey: keys.products });
      qc.invalidateQueries({ queryKey: keys.locations });
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["stores"] });
      toast.success(d.stocked ? `${d.stocked} produit(s) rangé(s) dans le stock` : "Liste mise à jour");
    },
    onError,
  });
}

/** Quantité affichée d'un article (correction manuelle prioritaire). */
export const itemQty = (i: ShoppingItem) => i.quantityOverride ?? i.quantity;
/** Article du planning entièrement couvert par le stock. */
export const isCovered = (i: ShoppingItem) => i.source === "plan" && !i.checked && itemQty(i) === 0;
/** Articles réellement à acheter. */
export const toBuyCount = (items: ShoppingItem[] | undefined) => (items ?? []).filter((i) => !i.checked && !isCovered(i)).length;
