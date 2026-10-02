// Planning. Ajouter, déplacer et retirer un repas fonctionnent hors ligne :
// comme pour les courses, ces actions sont déclarées par clé
// (setMutationDefaults), persistées dans IndexedDB et rejouées dans l'ordre
// (scope commun) au retour du réseau, même après fermeture de l'appli.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, isOfflineError } from "./api";
import { toastError } from "./errors";
import { keys } from "./queries";
import type { MealPlanItem } from "./types";

/** Identifiant généré côté appareil (fonctionne aussi en http sur le réseau local). */
export function clientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "c" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 22);
}

export const planKey = (from: string, to: string) => ["plan", from, to] as const;

export const usePlan = (from: string, to: string) =>
  useQuery({ queryKey: planKey(from, to), queryFn: () => api.get<MealPlanItem[]>(`/plan?from=${from}&to=${to}`) });

/** Applique une transformation à toutes les périodes de planning en cache. */
function editPlans(qc: QueryClient, fn: (items: MealPlanItem[], range: { from: string; to: string }) => MealPlanItem[]) {
  for (const [key, data] of qc.getQueriesData<MealPlanItem[]>({ queryKey: ["plan"] })) {
    if (!data) continue;
    const [, from, to] = key as [string, string, string];
    qc.setQueryData(key, fn(data, { from, to }));
  }
}

const inRange = (d: string, r: { from: string; to: string }) => d >= r.from && d <= r.to;

function sortPlan(items: MealPlanItem[]) {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal) || a.position - b.position);
}

export type NewMeal = { date: string; meal: MealPlanItem["meal"]; recipeId?: string | null; title?: string | null; servings?: number | null };
export type MealPatch = Partial<Pick<MealPlanItem, "date" | "meal" | "position" | "servings" | "note" | "title">> & { cooked?: boolean };

const scope = { id: "plan" };
const offline = { retry: (_n: number, e: Error) => isOfflineError(e), retryDelay: 1000 };

export function registerPlanMutations(qc: QueryClient) {
  qc.setMutationDefaults(["plan", "add"], {
    scope,
    ...offline,
    mutationFn: (m: NewMeal & { id: string }) => api.post<MealPlanItem>("/plan", m),
    onMutate: (m: NewMeal & { id: string }) => {
      editPlans(qc, (items, r) => {
        if (!inRange(m.date, r) || items.some((i) => i.id === m.id)) return items;
        const position = items.filter((i) => i.date === m.date && i.meal === m.meal).length;
        return sortPlan([...items, { id: m.id, date: m.date, meal: m.meal, position, recipeId: m.recipeId ?? null, title: m.title ?? null, servings: m.servings ?? null, note: null, cookedAt: null }]);
      });
    },
  });

  // Déplacement optimiste : l'élément change de créneau immédiatement.
  qc.setMutationDefaults(["plan", "update"], {
    scope,
    ...offline,
    mutationFn: ({ id, patch }: { id: string; patch: MealPatch }) => api.patch<MealPlanItem>(`/plan/${id}`, patch),
    onMutate: async ({ id, patch }: { id: string; patch: MealPatch }) => {
      await qc.cancelQueries({ queryKey: ["plan"] });
      let moving: MealPlanItem | undefined;
      for (const [, data] of qc.getQueriesData<MealPlanItem[]>({ queryKey: ["plan"] })) moving ??= data?.find((i) => i.id === id);
      if (!moving) return;
      const { cooked, ...fields } = patch;
      const next: MealPlanItem = { ...moving, ...fields, ...(cooked !== undefined ? { cookedAt: cooked ? new Date().toISOString() : null } : {}) };
      const repositioned = next.date !== moving.date || next.meal !== moving.meal || patch.position !== undefined;
      editPlans(qc, (items, r) => {
        if (!repositioned) return items.map((i) => (i.id === id ? next : i));
        const rest = items.filter((i) => i.id !== id);
        if (!inRange(next.date, r)) return rest;
        // Réinsère à la position demandée dans le créneau cible et renumérote.
        const slot = rest.filter((i) => i.date === next.date && i.meal === next.meal).sort((a, b) => a.position - b.position);
        slot.splice(Math.min(patch.position ?? slot.length, slot.length), 0, next);
        const renum = new Map(slot.map((i, position) => [i.id, position]));
        return sortPlan([...rest.filter((i) => !renum.has(i.id)), ...slot.map((i) => ({ ...i, position: renum.get(i.id)! }))]);
      });
    },
  });

  qc.setMutationDefaults(["plan", "remove"], {
    scope,
    ...offline,
    mutationFn: (id: string) => api.del(`/plan/${id}`),
    onMutate: (id: string) => editPlans(qc, (items) => items.filter((i) => i.id !== id)),
  });
}

/** Rafraîchit le planning une fois la file d'actions vidée (évite de revenir en arrière entre deux envois). */
function settle(qc: QueryClient) {
  if (qc.isMutating({ mutationKey: ["plan"] }) <= 1) qc.invalidateQueries({ queryKey: ["plan"] });
}

export function useAddMeal() {
  const qc = useQueryClient();
  return useMutation<MealPlanItem, Error, NewMeal & { id: string }>({ mutationKey: ["plan", "add"], onError: toastError, onSettled: () => settle(qc) });
}

export function useUpdateMeal() {
  const qc = useQueryClient();
  return useMutation<MealPlanItem, Error, { id: string; patch: MealPatch }>({ mutationKey: ["plan", "update"], onError: toastError, onSettled: () => settle(qc) });
}

export function useRemoveMeal() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({ mutationKey: ["plan", "remove"], onError: toastError, onSettled: () => settle(qc) });
}

/** « C'est cuisiné » : en ligne uniquement (il faut l'état réel du stock). */
export function useCookMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, consume }: { id: string; consume: { productId: string; quantity: number }[] }) =>
      api.post<{ item: MealPlanItem; consumed: { productId: string; quantity: number }[] }>(`/plan/${id}/cook`, { consume }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan"] });
      qc.invalidateQueries({ queryKey: keys.products });
    },
    onError: toastError,
  });
}
