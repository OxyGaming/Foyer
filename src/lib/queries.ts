import { DEFAULT_WEEK_START } from "../../shared/dates";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { roundQty, stockState, totalQuantity } from "../../shared/stock";
import { toast } from "sonner";
import { api, isOfflineError } from "./api";
import { toastError } from "./errors";
import type {
  Category,
  Invite,
  Location,
  Me,
  Product,
  ProductDetail,
  ProductInput,
  Recipe,
  RecipeInput,
  RecipeSummary,
  SearchResult,
} from "./types";

export const keys = {
  me: ["me"] as const,
  categories: ["categories"] as const,
  locations: ["locations"] as const,
  products: ["products"] as const,
  product: (id: string) => ["products", id] as const,
  recipes: ["recipes"] as const,
  recipe: (id: string) => ["recipes", id] as const,
  invites: ["invites"] as const,
  search: (q: string) => ["search", q] as const,
};

const onError = toastError;

// ─── Lectures ────────────────────────────────────────────────────────────────

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>("/auth/me"), retry: false });
/** Premier jour de la semaine choisi par le foyer (0 = dimanche … 6 = samedi). */
export const useWeekStartDay = () => useMe().data?.household.weekStartDay ?? DEFAULT_WEEK_START;
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api.get<Category[]>("/categories") });
export const useLocations = () => useQuery({ queryKey: keys.locations, queryFn: () => api.get<Location[]>("/locations") });
export const useProducts = () => useQuery({ queryKey: keys.products, queryFn: () => api.get<Product[]>("/products") });
export const useProduct = (id: string) =>
  useQuery({
    queryKey: keys.product(id),
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
    enabled: !!id,
    // Affichage immédiat depuis la liste pendant le chargement du détail.
    placeholderData: () => {
      const p = qcRef.current?.getQueryData<Product[]>(keys.products)?.find((x) => x.id === id);
      return p ? { ...p, movements: [], recipes: [], purchases: [] } : undefined;
    },
  });
export const useRecipes = () => useQuery({ queryKey: keys.recipes, queryFn: () => api.get<RecipeSummary[]>("/recipes") });
export const useRecipe = (id: string) => useQuery({ queryKey: keys.recipe(id), queryFn: () => api.get<Recipe>(`/recipes/${id}`), enabled: !!id });
export const useInvites = () => useQuery({ queryKey: keys.invites, queryFn: () => api.get<Invite[]>("/household/invites") });
export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.get<SearchResult>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  });

// Référence au QueryClient pour les placeholders (évite de le passer partout).
export const qcRef: { current: QueryClient | null } = { current: null };

// ─── Produits & stock ────────────────────────────────────────────────────────

/**
 * Recalcule les alertes de la liste : celles d'un générique dépendent du stock
 * de ses déclinaisons, celles d'une déclinaison du minimum de son générique.
 */
function withFamilies(list: Product[]): Product[] {
  const asStock = (p: Product) => ({ ...p, hasStockLine: p.stock.length > 0 });
  const byId = new Map(list.map((p) => [p.id, p]));
  const children = new Map<string, Product[]>();
  for (const p of list) if (p.parentId) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
  return list.map((p) => {
    const parent = p.parentId ? byId.get(p.parentId) : undefined;
    return { ...p, ...stockState(asStock(p), parent && asStock(parent), (children.get(p.id) ?? []).map(asStock)) };
  });
}

/** Remplace un produit dans la liste en cache et dans son détail (et rafraîchit sa famille). */
function putProduct(qc: QueryClient, p: Product) {
  qc.setQueryData<Product[]>(keys.products, (list) => {
    if (!list) return list;
    const i = list.findIndex((x) => x.id === p.id);
    return withFamilies(i === -1 ? [...list, p].sort((a, b) => a.name.localeCompare(b.name, "fr")) : list.map((x) => (x.id === p.id ? p : x)));
  });
  qc.setQueryData<ProductDetail>(keys.product(p.id), (d) => (d ? { ...d, ...p } : d));
  if (p.parentId) qc.invalidateQueries({ queryKey: keys.product(p.parentId), exact: true });
}

export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: ProductInput }) =>
      id ? api.patch<Product>(`/products/${id}`, data) : api.post<Product & { reused?: boolean }>("/products", data),
    onSuccess: (p) => {
      // Le serveur a réutilisé un produit du même nom plutôt que de créer un doublon.
      if ("reused" in p && p.reused) toast.info(`« ${p.name} » existait déjà : c'est ce produit qui a été complété.`);
      putProduct(qc, p);
      qc.invalidateQueries({ queryKey: keys.product(p.id) });
      qc.invalidateQueries({ queryKey: keys.categories });
    },
    onError,
  });
}

/** Fusionne `id` dans `intoId` (le premier disparaît). */
export function useMergeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) => api.post<Product>(`/products/${id}/merge`, { intoId }),
    onSuccess: (p, { id }) => {
      qc.setQueryData<Product[]>(keys.products, (l) => l?.filter((x) => x.id !== id));
      qc.removeQueries({ queryKey: keys.product(id) });
      putProduct(qc, p);
      qc.invalidateQueries({ queryKey: keys.product(p.id) });
      qc.invalidateQueries({ queryKey: keys.recipes });
      qc.invalidateQueries({ queryKey: ["shopping"] });
    },
    onError,
  });
}

export type BulkUpdate = { id: string } & Omit<ProductInput, "photoId" | "locationId" | "preferredId">;

/** Vue tableur : enregistre plusieurs modifications/suppressions d'un coup (tout ou rien). */
export function useBulkProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { updates?: BulkUpdate[]; deletes?: string[] }) => api.post<Product[]>("/products/bulk", body),
    onSuccess: (list, { deletes }) => {
      qc.setQueryData(keys.products, list);
      for (const id of deletes ?? []) qc.removeQueries({ queryKey: keys.product(id) });
      qc.invalidateQueries({ queryKey: keys.products, predicate: (q) => q.queryKey.length > 1 });
      qc.invalidateQueries({ queryKey: keys.recipes });
      qc.invalidateQueries({ queryKey: ["shopping"] });
    },
    onError,
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/products/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<Product[]>(keys.products, (l) => l?.filter((p) => p.id !== id));
      qc.removeQueries({ queryKey: keys.product(id) });
      qc.invalidateQueries({ queryKey: keys.recipes });
    },
    onError,
  });
}

/** Recalcule localement le total après une modification optimiste (les alertes : `withFamilies`). */
function recompute<T extends Product>(p: T): T {
  return { ...p, quantity: totalQuantity(p.stock) };
}

/** +1 / −1 instantané (optimiste), réconcilié avec la réponse du serveur. */
type Adjust = { productId: string; itemId: string; delta: number };

/**
 * +1 / −1 instantané (optimiste). Déclaré par clé pour être persisté et rejoué
 * hors ligne : le serveur applique des variations relatives, l'ordre suffit.
 */
export function registerStockMutations(qc: QueryClient) {
  qc.setMutationDefaults(["stock", "adjust"], {
    scope: { id: "stock" },
    retry: (_n: number, e: Error) => isOfflineError(e),
    retryDelay: 1000,
    mutationFn: ({ itemId, delta }: Adjust) => api.post<Product>(`/stock/${itemId}/adjust`, { delta }),
    onMutate: async ({ productId, itemId, delta }: Adjust) => {
      await qc.cancelQueries({ queryKey: keys.products });
      const apply = <T extends Product>(p: T): T =>
        recompute({
          ...p,
          stock: p.stock.map((s) => (s.id === itemId ? { ...s, quantity: Math.max(0, roundQty((s.quantity ?? 0) + delta)) } : s)),
        });
      const list = qc.setQueryData<Product[]>(keys.products, (l) => l && withFamilies(l.map((p) => (p.id === productId ? apply(p) : p))));
      const fresh = list?.find((p) => p.id === productId);
      qc.setQueryData<ProductDetail>(keys.product(productId), (d) => (d ? { ...apply(d), ...(fresh && { status: fresh.status, toBuy: fresh.toBuy, family: fresh.family }) } : d));
    },
    // Plusieurs appuis en file : on n'écrase l'affichage qu'avec la dernière réponse.
    onSuccess: (p: Product) => {
      if (qc.isMutating({ mutationKey: ["stock", "adjust"] }) <= 1) putProduct(qc, p);
    },
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation<Product, Error, Adjust>({
    mutationKey: ["stock", "adjust"],
    onError: (e, v) => {
      onError(e);
      qc.invalidateQueries({ queryKey: keys.products });
      qc.invalidateQueries({ queryKey: keys.product(v.productId) });
    },
    onSettled: (_p, _e, v) => {
      if (qc.isMutating({ mutationKey: ["stock", "adjust"] }) <= 1) qc.invalidateQueries({ queryKey: keys.product(v.productId), exact: true });
    },
  });
}

export function useSetStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { productId: string; itemId?: string; locationId?: string | null; quantity?: number | null; inventory?: boolean }) =>
      a.itemId
        ? api.patch<Product>(`/stock/${a.itemId}`, { quantity: a.quantity, locationId: a.locationId, inventory: a.inventory })
        : api.post<Product>(`/products/${a.productId}/stock`, { locationId: a.locationId ?? null, quantity: a.quantity ?? null, inventory: a.inventory }),
    onSuccess: (p) => {
      putProduct(qc, p);
      qc.invalidateQueries({ queryKey: keys.product(p.id), exact: true });
      qc.invalidateQueries({ queryKey: keys.locations });
    },
    onError,
  });
}

export function useDeleteStockLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId }: { productId: string; itemId: string }) => api.del<Product>(`/stock/${itemId}`),
    onSuccess: (p) => {
      putProduct(qc, p);
      qc.invalidateQueries({ queryKey: keys.product(p.id), exact: true });
      qc.invalidateQueries({ queryKey: keys.locations });
    },
    onError,
  });
}

// ─── Recettes ────────────────────────────────────────────────────────────────

export function useSaveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: RecipeInput }) =>
      id ? api.patch<Recipe>(`/recipes/${id}`, data) : api.post<Recipe>("/recipes", data),
    onSuccess: (r) => {
      qc.setQueryData(keys.recipe(r.id), r);
      qc.invalidateQueries({ queryKey: keys.recipes, exact: true });
      // Des produits ont pu être créés à partir des ingrédients.
      qc.invalidateQueries({ queryKey: keys.products, exact: true });
      qc.invalidateQueries({ queryKey: keys.categories });
    },
    onError,
  });
}

export type RecipeBulkUpdate = { id: string } & Omit<RecipeInput, "photoId" | "steps" | "notes" | "description">;

/** Édition en masse des recettes : modifications et suppressions d'un coup (tout ou rien). */
export function useBulkRecipes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { updates?: RecipeBulkUpdate[]; deletes?: string[] }) => api.post<RecipeSummary[]>("/recipes/bulk", body),
    onSuccess: (list, { deletes }) => {
      qc.setQueryData(keys.recipes, list);
      for (const id of deletes ?? []) qc.removeQueries({ queryKey: keys.recipe(id) });
      qc.invalidateQueries({ queryKey: keys.recipes, predicate: (q) => q.queryKey.length > 1 });
      qc.invalidateQueries({ queryKey: keys.categories });
      qc.invalidateQueries({ queryKey: ["plan"] });
      // Des produits ont pu être créés à partir des nouveaux ingrédients.
      qc.invalidateQueries({ queryKey: keys.products });
    },
    onError,
  });
}

/** Relie des ingrédients de recettes à un produit du stock et/ou fixe leurs variantes acceptées. */
export function useLinkIngredients() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[]; productId?: string; alternatives?: string[] }) => api.post<RecipeSummary[]>("/recipes/ingredients/link", body),
    onSuccess: (list) => {
      qc.setQueryData(keys.recipes, list);
      qc.invalidateQueries({ queryKey: keys.recipes, predicate: (q) => q.queryKey.length > 1 });
      qc.invalidateQueries({ queryKey: keys.products, predicate: (q) => q.queryKey.length > 1 });
      qc.invalidateQueries({ queryKey: ["shopping"] });
    },
    onError,
  });
}

export function useImportRecipes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recipes: RecipeInput[]) => api.post<{ count: number; ids: string[] }>("/recipes/import", { recipes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.recipes, exact: true });
      qc.invalidateQueries({ queryKey: keys.products, exact: true });
    },
    onError,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => api.patch<Recipe>(`/recipes/${id}`, { favorite }),
    onMutate: ({ id, favorite }) => {
      qc.setQueryData<RecipeSummary[]>(keys.recipes, (l) => l?.map((r) => (r.id === id ? { ...r, favorite } : r)));
      qc.setQueryData<Recipe>(keys.recipe(id), (r) => (r ? { ...r, favorite } : r));
    },
    onSuccess: (r) => qc.setQueryData(keys.recipe(r.id), r),
    onError: (e) => {
      onError(e);
      qc.invalidateQueries({ queryKey: keys.recipes });
    },
  });
}

export function useDuplicateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Recipe>(`/recipes/${id}/duplicate`),
    onSuccess: (r) => {
      qc.setQueryData(keys.recipe(r.id), r);
      qc.invalidateQueries({ queryKey: keys.recipes, exact: true });
    },
    onError,
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/recipes/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<RecipeSummary[]>(keys.recipes, (l) => l?.filter((r) => r.id !== id));
      qc.removeQueries({ queryKey: keys.recipe(id) });
      qc.invalidateQueries({ queryKey: keys.products, exact: true });
    },
    onError,
  });
}

// ─── Référentiels ────────────────────────────────────────────────────────────

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<Omit<Category, "id" | "usage">> }) =>
      id ? api.patch<Category>(`/categories/${id}`, data) : api.post<Category>("/categories", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.categories }),
    onError,
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.categories });
      qc.invalidateQueries({ queryKey: keys.products });
      qc.invalidateQueries({ queryKey: keys.recipes });
    },
    onError,
  });
}

export function useSaveLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<Omit<Location, "id" | "usage">> }) =>
      id ? api.patch<Location>(`/locations/${id}`, data) : api.post<Location>("/locations", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.locations }),
    onError,
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/locations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.locations });
      qc.invalidateQueries({ queryKey: keys.products });
    },
    onError,
  });
}
