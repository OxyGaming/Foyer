import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { addDays, todayIso, weekStart } from "../../shared/dates";
import { BarList, type BarItem, type Column, ColumnChart } from "@/components/charts";
import { EmptyState, PageHeader, PageLoader, Thumb } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { usePlan } from "@/lib/planQueries";
import { usePurchases } from "@/lib/purchaseQueries";
import { useRecipes, useWeekStartDay } from "@/lib/queries";

const WEEKS = 12;
const dm = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const times = (n: number) => `${n} fois`;
const count = (n: number) => String(Math.round(n));

export function StatsPage() {
  const today = todayIso();
  const first = addDays(weekStart(today, useWeekStartDay()), -(WEEKS - 1) * 7);
  const plan = usePlan(first, today);
  const purchases = usePurchases(first, today);
  const recipes = useRecipes();

  const stats = useMemo(() => {
    const meals = (plan.data ?? []).filter((m) => m.date <= today);
    const withRecipe = meals.filter((m) => m.recipeId);
    const cooked = meals.filter((m) => m.cookedAt).length;
    const recipeMap = new Map((recipes.data ?? []).map((r) => [r.id, r]));

    const weeks: Column[] = Array.from({ length: WEEKS }, (_, i) => {
      const start = addDays(first, i * 7);
      const end = addDays(start, 6);
      const n = meals.filter((m) => m.date >= start && m.date <= end).length;
      const label = dm.format(new Date(`${start}T00:00:00Z`));
      return { key: start, label, tooltip: `Semaine du ${label}`, value: n };
    });

    const byRecipe = new Map<string, number>();
    for (const m of withRecipe) byRecipe.set(m.recipeId!, (byRecipe.get(m.recipeId!) ?? 0) + 1);
    const topRecipes: BarItem[] = [...byRecipe.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => ({ key: id, label: recipeMap.get(id)?.name || "Recette supprimée", value: n }));
    const never = (recipes.data ?? []).filter((r) => !byRecipe.has(r.id)).sort((a, b) => Number(b.favorite) - Number(a.favorite));

    const byProduct = new Map<string, { name: string; n: number; qty: number | null; unit: string | null }>();
    for (const p of purchases.data ?? []) {
      const cur = byProduct.get(p.productId) ?? { name: p.product.name, n: 0, qty: 0, unit: p.unit };
      cur.n++;
      cur.qty = cur.qty != null && p.quantity != null && p.unit === cur.unit ? cur.qty + p.quantity : null;
      byProduct.set(p.productId, cur);
    }
    const topProducts: BarItem[] = [...byProduct.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 8)
      .map(([id, v]) => ({ key: id, label: v.name || "Produit", value: v.n, hint: v.qty ? `${formatQty(v.qty, v.unit)} au total · ` : undefined }));

    return { meals: meals.length, cooked, weeks, topRecipes, never, topProducts, purchaseCount: purchases.data?.length ?? 0 };
  }, [plan.data, purchases.data, recipes.data, first, today]);

  const loading = plan.isPending || purchases.isPending || recipes.isPending;
  const avg = stats.meals / WEEKS;

  return (
    <>
      <PageHeader back="/" title="Statistiques" subtitle={`${WEEKS} dernières semaines`} />
      <div className="space-y-5 px-4 pb-6">
        {loading ? (
          <PageLoader />
        ) : stats.meals === 0 && stats.purchaseCount === 0 ? (
          <EmptyState icon="📊" title="Pas encore assez d'historique">
            <p>Les statistiques se remplissent au fil des repas planifiés et des achats enregistrés.</p>
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="card p-3">
                <p className="text-xs text-ink-2">Repas planifiés</p>
                <p className="text-2xl font-bold">{stats.meals}</p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-ink-2">Par semaine</p>
                <p className="text-2xl font-bold">{avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-ink-2">Cuisinés ✓</p>
                <p className="text-2xl font-bold">{stats.meals ? Math.round((stats.cooked / stats.meals) * 100) : 0} %</p>
              </div>
            </div>

            {stats.meals > 0 && (
              <section className="card p-4">
                <h2 className="mb-2 text-sm font-semibold">Repas planifiés par semaine</h2>
                <ColumnChart data={stats.weeks} format={(v) => `${v} repas`} axisFormat={count} ariaLabel={`Repas planifiés par semaine, ${stats.meals} au total`} />
              </section>
            )}

            {stats.topRecipes.length > 0 && (
              <section className="card p-4">
                <h2 className="mb-3 text-sm font-semibold">Recettes les plus planifiées</h2>
                <BarList items={stats.topRecipes} total={stats.topRecipes.reduce((s, i) => s + i.value, 0)} format={times} />
              </section>
            )}

            {stats.never.length > 0 && (
              <section>
                <h2 className="mb-2 text-lg font-bold">Jamais au menu ces derniers temps</h2>
                <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
                  {stats.never.slice(0, 12).map((r) => (
                    <Link key={r.id} to={`/recettes/${r.id}`} className="w-28 shrink-0">
                      <Thumb photoId={r.photoId} fallback="🍽️" className="aspect-square w-full rounded-xl" />
                      <p className="mt-1 line-clamp-2 text-sm font-medium">
                        {r.favorite ? "❤️ " : ""}
                        {r.name || "Sans nom"}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {stats.topProducts.length > 0 && (
              <section className="card p-4">
                <h2 className="mb-3 text-sm font-semibold">Produits les plus achetés</h2>
                <BarList items={stats.topProducts} total={stats.purchaseCount} format={(n) => `${n} achat${n > 1 ? "s" : ""}`} />
              </section>
            )}

            <Link to="/achats" className="card flex items-center gap-3 p-4">
              <span className="text-2xl">💶</span>
              <span className="flex-1 font-semibold">Dépenses détaillées</span>
              <ChevronRight className="size-5 text-ink-3" />
            </Link>
          </>
        )}
      </div>
    </>
  );
}
