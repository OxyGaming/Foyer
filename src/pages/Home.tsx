import { AlertTriangle, BookOpen, CalendarDays, ChevronRight, Package, Plus, Search, Settings, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { addDays, MEAL_LABEL, type Meal, todayIso, weekDays, weekStart } from "../../shared/dates";
import { AddMealSheet, type Slot, useMealSlots } from "@/components/MealSheets";
import { QuickProductSheet } from "@/components/QuickProductSheet";
import { Thumb } from "@/components/ui";
import { formatCents } from "@/lib/format";
import { usePlan } from "@/lib/planQueries";
import { usePurchases } from "@/lib/purchaseQueries";
import { totalStockValue } from "./Stock";
import { useMe, useProducts, useRecipes } from "@/lib/queries";
import { toBuyCount, useShopping } from "@/lib/shoppingQueries";
import type { RecipeSummary } from "@/lib/types";
import { QuickRecipeSheet } from "./Recipes";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

/** Prochain repas à afficher : ce midi avant 14 h, sinon ce soir, puis demain midi après 21 h. */
function nextMeal(today: string, slots: Meal[]): { date: string; meal: Meal; label: string } {
  const h = new Date().getHours();
  if (h < 14 && slots.includes("lunch")) return { date: today, meal: "lunch", label: "Ce midi" };
  if (h < 21 && slots.includes("dinner")) return { date: today, meal: "dinner", label: "Ce soir" };
  const tomorrow = addDays(today, 1);
  return slots.includes("lunch") ? { date: tomorrow, meal: "lunch", label: "Demain midi" } : { date: tomorrow, meal: slots[0], label: `Demain · ${MEAL_LABEL[slots[0]].toLowerCase()}` };
}

function RecipeStrip({ title, recipes, to }: { title: string; recipes: RecipeSummary[]; to: string }) {
  if (!recipes.length) return null;
  return (
    <section>
      <Link to={to} className="mb-2 flex items-center justify-between px-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <ChevronRight className="size-5 text-ink-3" />
      </Link>
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
        {recipes.map((r) => (
          <Link key={r.id} to={`/recettes/${r.id}`} className="w-36 shrink-0 active:scale-[0.98]">
            <Thumb photoId={r.photoId} fallback={<span className="text-3xl">🍽️</span>} className="aspect-[4/5] w-full rounded-2xl" />
            <p className="mt-1.5 line-clamp-2 text-sm leading-snug font-semibold">{r.name || "Sans nom"}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const me = useMe();
  const recipes = useRecipes();
  const products = useProducts();
  const shopping = useShopping();
  const slots = useMealSlots();
  const today = todayIso();
  const monday = weekStart(today);
  const plan = usePlan(monday, addDays(monday, 6));
  // Le prochain repas peut tomber la semaine suivante (dimanche soir → lundi midi).
  const next = nextMeal(today, slots);
  const nextPlan = usePlan(next.date, next.date);
  const [quickRecipe, setQuickRecipe] = useState(false);
  const [quickProduct, setQuickProduct] = useState(false);
  const [adding, setAdding] = useState<Slot | null>(null);

  const recipeMap = useMemo(() => new Map((recipes.data ?? []).map((r) => [r.id, r])), [recipes.data]);
  const stats = useMemo(() => {
    const p = products.data ?? [];
    return {
      out: p.filter((x) => x.status === "out").length,
      low: p.filter((x) => x.status === "low").length,
      watch: p.filter((x) => x.status === "watch").length,
    };
  }, [products.data]);
  const alerts = stats.out + stats.low + stats.watch;
  const toBuy = toBuyCount(shopping.data?.items);
  const stockValue = totalStockValue(products.data);
  const recentPurchases = usePurchases(addDays(today, -29), today);
  const priced = (recentPurchases.data ?? []).filter((p) => p.totalCents != null);
  const spent30 = priced.length ? priced.reduce((s, p) => s + p.totalCents!, 0) : null;

  const nextItems = (nextPlan.data ?? []).filter((i) => i.meal === next.meal).sort((a, b) => a.position - b.position);
  const week = weekDays(monday);
  const planned = (plan.data ?? []).filter((i) => slots.includes(i.meal));
  const favorites = (recipes.data ?? []).filter((r) => r.favorite).slice(0, 12);
  const recent = [...(recipes.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  const firstName = me.data?.user.name?.split(" ")[0];

  return (
    <div className="space-y-6 pb-4">
      <header className="pt-safe flex items-start justify-between px-4 pt-4">
        <div>
          <p className="text-ink-2">{me.data?.household.name}</p>
          <h1 className="text-3xl font-bold tracking-tight">
            {greeting()}
            {firstName ? ` ${firstName}` : ""} 👋
          </h1>
        </div>
        <div className="flex">
          <Link to="/recherche" className="icon-btn" aria-label="Rechercher">
            <Search className="size-6" />
          </Link>
          <Link to="/reglages" className="icon-btn" aria-label="Réglages">
            <Settings className="size-6" />
          </Link>
        </div>
      </header>

      {/* 🍴 Prochain repas */}
      <section className="px-4">
        <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-2 uppercase">🍴 {next.label}</h2>
        {nextItems.length > 0 ? (
          <div className="space-y-2">
            {nextItems.map((i) => {
              const r = i.recipeId ? recipeMap.get(i.recipeId) : undefined;
              const body = (
                <>
                  <Thumb photoId={r?.photoId} fallback={<span className="text-4xl">{r ? "🍽️" : "📝"}</span>} className="aspect-[16/9] w-full" />
                  <div className="flex items-center justify-between p-3">
                    <p className="text-lg font-bold">{r?.name || i.title || "Repas"}</p>
                    {i.cookedAt && <span className="text-sm font-semibold text-ok">✓ cuisiné</span>}
                  </div>
                </>
              );
              return r ? (
                <Link key={i.id} to={`/recettes/${r.id}`} className="card block overflow-hidden">
                  {body}
                </Link>
              ) : (
                <Link key={i.id} to="/planning" className="card block overflow-hidden">
                  {body}
                </Link>
              );
            })}
          </div>
        ) : (
          <button className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => setAdding({ date: next.date, meal: next.meal })}>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-2xl">🤔</span>
            <span className="flex-1">
              <span className="block font-semibold">Rien de prévu</span>
              <span className="text-sm text-ink-2">Choisir une recette</span>
            </span>
            <Plus className="size-5 text-brand" />
          </button>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 px-4">
        {/* 📅 Semaine */}
        <Link to="/planning" className="card col-span-2 p-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-5 text-brand" />
            <span className="flex-1 font-bold">Cette semaine</span>
            <span className="text-sm text-ink-2">
              {planned.length} / {slots.length * 7} repas
            </span>
            <ChevronRight className="size-5 text-ink-3" />
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {week.map((d) => {
              const n = planned.filter((i) => i.date === d).length;
              return (
                <div key={d} className={`flex flex-col items-center rounded-lg py-1.5 ${d === today ? "bg-brand text-brand-ink" : "bg-surface-2"}`}>
                  <span className="text-[10px] font-semibold uppercase">{new Intl.DateTimeFormat("fr-FR", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`))}</span>
                  <span className="mt-0.5 flex gap-0.5">
                    {slots.map((_, k) => (
                      <span key={k} className={`size-1.5 rounded-full ${k < n ? (d === today ? "bg-brand-ink" : "bg-brand") : d === today ? "bg-brand-ink/30" : "bg-line"}`} />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </Link>

        {/* 🛒 Courses */}
        <Link to="/courses" className="card p-4">
          <ShoppingCart className="size-6 text-brand" />
          <p className="mt-2 text-2xl font-bold">{shopping.data ? toBuy : "–"}</p>
          <p className="text-sm text-ink-2">article{toBuy > 1 ? "s" : ""} à acheter</p>
        </Link>

        {/* ⚠️ Stock */}
        <Link to={alerts ? "/stock/alertes" : "/stock"} className={`card p-4 ${alerts ? "border-low/30 bg-low-soft" : ""}`}>
          {alerts ? <AlertTriangle className="size-6 text-low" /> : <Package className="size-6 text-ok" />}
          <p className={`mt-2 text-2xl font-bold ${alerts ? "text-low" : ""}`}>{alerts}</p>
          <p className="text-sm text-ink-2">{alerts ? `sous le seuil${stats.out ? ` · ${stats.out} en rupture` : ""}` : "stock au vert"}</p>
        </Link>

        {/* 📦 Valeur du stock et 💰 dépenses : seulement quand c'est calculable. */}
        {stockValue != null && (
          <Link to="/stock/valeur" className="card p-4">
            <p className="text-sm text-ink-2">📦 Valeur du stock</p>
            <p className="mt-1 text-2xl font-bold">{formatCents(stockValue, true)}</p>
          </Link>
        )}
        {spent30 != null && (
          <Link to="/achats" className={`card p-4 ${stockValue == null ? "col-span-2" : ""}`}>
            <p className="text-sm text-ink-2">💰 Dépenses 30 j</p>
            <p className="mt-1 text-2xl font-bold">{formatCents(spent30, true)}</p>
          </Link>
        )}
        {stockValue != null && spent30 == null && <div />}

        <Link to="/recettes" className="card flex items-center gap-3 p-4">
          <BookOpen className="size-5 text-brand" />
          <span>
            <span className="block text-lg leading-tight font-bold">{recipes.data?.length ?? "–"}</span>
            <span className="text-xs text-ink-2">recettes</span>
          </span>
        </Link>
        <Link to="/stock" className="card flex items-center gap-3 p-4">
          <Package className="size-5 text-brand" />
          <span>
            <span className="block text-lg leading-tight font-bold">{products.data?.length ?? "–"}</span>
            <span className="text-xs text-ink-2">produits</span>
          </span>
        </Link>

        <button className="btn-soft h-12" onClick={() => setQuickRecipe(true)}>
          <Plus className="size-4" /> Recette
        </button>
        <button className="btn-soft h-12" onClick={() => setQuickProduct(true)}>
          <Plus className="size-4" /> Produit
        </button>
      </div>

      <RecipeStrip title="❤️ Favoris" recipes={favorites} to="/recettes?categorie=fav" />
      <RecipeStrip title="Dernières recettes" recipes={recent} to="/recettes" />

      <QuickRecipeSheet open={quickRecipe} onClose={() => setQuickRecipe(false)} />
      <QuickProductSheet open={quickProduct} onClose={() => setQuickProduct(false)} />
      <AddMealSheet slot={adding} onClose={() => setAdding(null)} />
    </div>
  );
}
