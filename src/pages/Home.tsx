import { AlertTriangle, BookOpen, ChevronRight, Package, Plus, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { QuickProductSheet } from "@/components/QuickProductSheet";
import { Thumb } from "@/components/ui";
import { useMe, useProducts, useRecipes } from "@/lib/queries";
import type { RecipeSummary } from "@/lib/types";
import { QuickRecipeSheet } from "./Recipes";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
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
  const [quickRecipe, setQuickRecipe] = useState(false);
  const [quickProduct, setQuickProduct] = useState(false);

  const stats = useMemo(() => {
    const p = products.data ?? [];
    return {
      out: p.filter((x) => x.status === "out").length,
      low: p.filter((x) => x.status === "low").length,
      watch: p.filter((x) => x.status === "watch").length,
      tracked: p.filter((x) => x.quantity != null).length,
    };
  }, [products.data]);
  const alerts = stats.out + stats.low + stats.watch;

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
        <Link to="/reglages" className="icon-btn" aria-label="Réglages">
          <Settings className="size-6" />
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 px-4">
        <Link to={alerts ? "/stock/alertes" : "/stock"} className={`card col-span-2 flex items-center gap-4 p-4 ${alerts ? "border-low/30 bg-low-soft" : ""}`}>
          <span className={`flex size-12 items-center justify-center rounded-2xl ${alerts ? "bg-low text-white" : "bg-ok-soft text-ok"}`}>
            <AlertTriangle className="size-6" />
          </span>
          <div className="flex-1">
            <p className="font-bold">{alerts ? `${alerts} produit${alerts > 1 ? "s" : ""} à réapprovisionner` : "Stock au vert"}</p>
            <p className="text-sm text-ink-2">
              {alerts
                ? [stats.out && `${stats.out} en rupture`, stats.low && `${stats.low} sous le minimum`, stats.watch && `${stats.watch} à surveiller`].filter(Boolean).join(" · ")
                : "Aucun produit sous son seuil minimum"}
            </p>
          </div>
          <ChevronRight className="size-5 text-ink-3" />
        </Link>

        <Link to="/recettes" className="card p-4">
          <BookOpen className="size-6 text-brand" />
          <p className="mt-2 text-2xl font-bold">{recipes.data?.length ?? "–"}</p>
          <p className="text-sm text-ink-2">recette{(recipes.data?.length ?? 0) > 1 ? "s" : ""}</p>
        </Link>
        <Link to="/stock" className="card p-4">
          <Package className="size-6 text-brand" />
          <p className="mt-2 text-2xl font-bold">{products.data?.length ?? "–"}</p>
          <p className="text-sm text-ink-2">produit{(products.data?.length ?? 0) > 1 ? "s" : ""} · {stats.tracked} suivi{stats.tracked > 1 ? "s" : ""}</p>
        </Link>

        <button className="btn-soft h-14" onClick={() => setQuickRecipe(true)}>
          <Plus className="size-4" /> Recette
        </button>
        <button className="btn-soft h-14" onClick={() => setQuickProduct(true)}>
          <Plus className="size-4" /> Produit
        </button>
      </div>

      <RecipeStrip title="❤️ Favoris" recipes={favorites} to="/recettes" />
      <RecipeStrip title="Dernières recettes" recipes={recent} to="/recettes" />

      <QuickRecipeSheet open={quickRecipe} onClose={() => setQuickRecipe(false)} />
      <QuickProductSheet open={quickProduct} onClose={() => setQuickProduct(false)} />
    </div>
  );
}
