import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { toastError } from "./errors";
import { keys } from "./queries";
import type { InventoryCorrection, Purchase, PurchaseWithProduct, Store } from "./types";

export type PurchaseInput = {
  date?: string;
  quantity?: number | null;
  totalCents?: number | null;
  storeName?: string | null;
  isPromo?: boolean;
  note?: string | null;
};

export const useStores = () => useQuery({ queryKey: ["stores"], queryFn: () => api.get<Store[]>("/purchases/stores") });

export const usePurchases = (from: string, to: string) =>
  useQuery({ queryKey: ["purchases", from, to], queryFn: () => api.get<PurchaseWithProduct[]>(`/purchases?from=${from}&to=${to}`) });

/** Tout ce qui dépend des achats : fiche et liste produits (prix, stock), dépenses, magasins. */
function refreshAfterPurchase(qc: ReturnType<typeof useQueryClient>, productId?: string) {
  qc.invalidateQueries({ queryKey: keys.products, exact: true });
  if (productId) qc.invalidateQueries({ queryKey: keys.product(productId) });
  qc.invalidateQueries({ queryKey: ["purchases"] });
  qc.invalidateQueries({ queryKey: ["stores"] });
}

export function useAddPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: PurchaseInput & { productId: string; addToStock: boolean; locationId?: string | null }) => api.post<Purchase>("/purchases", p),
    onSuccess: (_r, v) => {
      refreshAfterPurchase(qc, v.productId);
    },
    onError: toastError,
  });
}

export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; productId: string; data: PurchaseInput }) => api.patch<Purchase>(`/purchases/${id}`, data),
    onSuccess: (_r, v) => refreshAfterPurchase(qc, v.productId),
    onError: toastError,
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; productId: string }) => api.del(`/purchases/${id}`),
    onSuccess: (_r, v) => refreshAfterPurchase(qc, v.productId),
    onError: toastError,
  });
}

export const useInventoryHistory = () =>
  useQuery({ queryKey: ["inventory-history"], queryFn: () => api.get<InventoryCorrection[]>("/inventory/history") });

export function useSaveInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: { productId: string; locationId: string | null; quantity: number }[]) =>
      api.post<{ counted: number; corrected: number }>("/inventory", { entries }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.products });
      qc.invalidateQueries({ queryKey: ["inventory-history"] });
    },
    onError: toastError,
  });
}
