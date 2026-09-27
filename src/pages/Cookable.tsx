import { CalendarPlus, Check, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PlanRecipeSheet } from "@/components/MealSheets";
import { Chips, EmptyState, PageHeader, PageLoader, Thumb } from "@/components/ui";
import { type Cookable, useAddMissingToShopping, useCookable } from "@/lib/cookable";
import { formatQty } from "@/lib/format";
import { useRecipes } from "@/lib/queries";
import type { RecipeSummary } from "@/lib/types";

type Filter = "ready" | "one" | "more" | "all";

export function missingLabel(c: Cookable) {
  return c.missing.map((m) => (m.toBuy != null ? `${m.name} (${m.short ? "encore " : ""}${formatQty(m.toBuy, m.unit)})` : m.name)).join(", ");
}

function CookableCard({ recipe, c, onPlan }: { recipe: RecipeSummary; c: Cookable; onPlan: () => void }) {
  const addMissing = useAddMissingToShopping();
  return (
    <li className="card overflow-hidden">
      <Link to={`/recettes/${recipe.id}`} className="flex gap-3 p-3">
        <Thumb photoId={recipe.photoId} fallback="🍽️" className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{recipe.name || "Sans nom"}</p>
          {c.complete ? (
            <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-ok">
              <Check className="size-4" /> Tout est en stock
            </p>
          ) : (
            <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">
              <span className="font-semibold text-low">Il manque :</span> {missingLabel(c)}
            </p>
          )}
          <p className="mt-0.5 text-xs text-ink-3">
            {c.available}/{c.counted} ingrédient{c.counted > 1 ? "s" : ""} en stock
            {c.basicsMissing.length > 0 && ` · à vérifier : ${c.basicsMissing.join(", ")}`}
          </p>
        </div>
      </Link>
      <div className="flex border-t border-line">
        <button className="btn-ghost min-h-11 flex-1 rounded-none text-sm" onClick={onPlan}>
          <CalendarPlus className="size-4" /> Planifier
        </button>
        {c.missing.length > 0 && (
          <button className="btn-ghost min-h-11 flex-1 rounded-none border-l border-line text-sm text-brand" onClick={() => addMissing(c.missing, recipe.name)}>
            <ShoppingCart className="size-4" /> Aux courses
          </button>
        )}
      </div>
    </li>
  );
}

export function CookablePage() {
  const cookable = useCookable();
  const recipes = useRecipes();
  const [filter, setFilter] = useState<Filter>("ready");
  const [planning, setPlanning] = useState<string | null>(null);
  const recipeMap = useMemo(() => new Map((recipes.data ?? []).map((r) => [r.id, r])), [recipes.data]);

  const ranked = cookable.data?.ranked ?? [];
  const counts = {
    ready: ranked.filter((c) => c.complete).length,
    one: ranked.filter((c) => c.missing.length === 1).length,
    more: ranked.filter((c) => c.missing.length >= 2).length,
  };
  const list = ranked.filter((c) => (filter === "ready" ? c.complete : filter === "one" ? c.missing.length === 1 : filter === "more" ? c.missing.length >= 2 : true));
  const notEvaluated = (recipes.data?.length ?? 0) - ranked.length;

  return (
    <>
      <PageHeader back="/recettes" title="Avec mon stock" subtitle="Que puis-je cuisiner ?" />
      <div className="space-y-4 px-4 pb-6">
        {cookable.isPending ? (
          <PageLoader />
        ) : ranked.length === 0 ? (
          <EmptyState icon="🍳" title="Rien à évaluer pour l'instant">
            <p>Il faut des recettes avec des ingrédients chiffrés (« 3 œufs », « 200 g de riz ») et un peu de stock renseigné.</p>
          </EmptyState>
        ) : (
          <>
            <Chips
              options={[
                { value: "ready", label: `✓ Réalisables · ${counts.ready}` },
                { value: "one", label: `Il manque 1 · ${counts.one}` },
                { value: "more", label: `2 ou plus · ${counts.more}` },
                { value: "all", label: "Toutes" },
              ]}
              value={filter}
              onChange={setFilter}
            />
            {list.length === 0 ? (
              <EmptyState icon={filter === "ready" ? "🛒" : "✅"} title={filter === "ready" ? "Aucune recette complète avec le stock actuel" : "Aucune recette dans ce cas"}>
                {filter === "ready" && counts.one > 0 && (
                  <button className="btn-soft mt-3" onClick={() => setFilter("one")}>
                    Voir les {counts.one} recette{counts.one > 1 ? "s" : ""} à un ingrédient près
                  </button>
                )}
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {list.map((c) => {
                  const r = recipeMap.get(c.recipeId);
                  return r ? <CookableCard key={c.recipeId} recipe={r} c={c} onPlan={() => setPlanning(c.recipeId)} /> : null;
                })}
              </ul>
            )}
          </>
        )}
        {notEvaluated > 0 && !cookable.isPending && (
          <p className="text-xs text-ink-3">
            {notEvaluated} recette{notEvaluated > 1 ? "s" : ""} sans ingrédient chiffré relié au stock {notEvaluated > 1 ? "ne sont" : "n'est"} pas évaluée{notEvaluated > 1 ? "s" : ""}.
          </p>
        )}
      </div>
      {planning && <PlanRecipeSheet recipeId={planning} open onClose={() => setPlanning(null)} />}
    </>
  );
}
