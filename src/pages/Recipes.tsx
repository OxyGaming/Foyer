import { ChefHat, ChevronRight, ClipboardPaste, Clock, Heart, Link2, Plus, Search, Table } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { matches } from "../../shared/text";
import { EmptyState, PageHeader, PageLoader, Sheet, Thumb } from "@/components/ui";
import { useCookable } from "@/lib/cookable";
import { formatMinutes } from "@/lib/format";
import { useCategories, useRecipes, useSaveRecipe, useToggleFavorite } from "@/lib/queries";
import type { RecipeSummary } from "@/lib/types";

export function RecipeCard({ r }: { r: RecipeSummary }) {
  const fav = useToggleFavorite();
  const total = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
  return (
    <Link to={`/recettes/${r.id}`} className="group card relative block overflow-hidden transition active:scale-[0.98]">
      <Thumb photoId={r.photoId} fallback={<span className="text-4xl">🍽️</span>} className="aspect-[4/3] w-full" />
      <button
        className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm"
        aria-label={r.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        onClick={(e) => {
          e.preventDefault();
          fav.mutate({ id: r.id, favorite: !r.favorite });
        }}
      >
        <Heart className={`size-[18px] ${r.favorite ? "fill-current text-rose-400" : ""}`} />
      </button>
      <div className="p-3">
        <p className="line-clamp-2 leading-snug font-semibold">{r.name || "Recette sans nom"}</p>
        {total > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-ink-2">
            <Clock className="size-3.5" /> {formatMinutes(total)}
          </p>
        )}
      </div>
    </Link>
  );
}

export function QuickRecipeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const save = useSaveRecipe();
  const navigate = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync({ data: { name } });
    setName("");
    onClose();
    navigate(`/recettes/${r.id}`);
  }
  return (
    <Sheet open={open} onClose={onClose} title="Nouvelle recette">
      <form onSubmit={submit} className="space-y-3">
        <input className="input" autoFocus placeholder="Ex. Tartiflette" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-sm text-ink-2">Le nom suffit : photo, ingrédients et étapes pourront être ajoutés plus tard.</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-soft" onClick={() => { onClose(); navigate("/recettes/nouvelle", { state: { name } }); }}>
            Tout remplir
          </button>
          <button className="btn-primary" disabled={save.isPending}>
            Enregistrer
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function RecipesPage() {
  const recipes = useRecipes();
  const cookable = useCookable();
  const ready = cookable.data?.ranked.filter((c) => c.complete).length ?? 0;
  const nearly = cookable.data?.ranked.filter((c) => c.missing.length === 1).length ?? 0;
  const categories = useCategories();
  const [q, setQ] = useState("");
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<string>(params.get("categorie") ?? "all");
  const [quick, setQuick] = useState(false);

  const recipeCats = useMemo(() => (categories.data ?? []).filter((c) => c.kind === "recipe"), [categories.data]);
  const list = useMemo(() => {
    let l = recipes.data ?? [];
    if (filter === "fav") l = l.filter((r) => r.favorite);
    else if (filter !== "all") l = l.filter((r) => r.categoryIds.includes(filter));
    if (q.trim()) l = l.filter((r) => matches(r.name, q) || r.tags.some((t) => matches(t, q)) || r.ingredients.some((i) => matches(i.name, q)));
    return l;
  }, [recipes.data, filter, q]);

  const usedCats = recipeCats.filter((c) => recipes.data?.some((r) => r.categoryIds.includes(c.id)));

  return (
    <>
      <PageHeader
        title="Recettes"
        subtitle={recipes.data ? `${recipes.data.length} recette${recipes.data.length > 1 ? "s" : ""}` : undefined}
        actions={
          <>
            <Link to="/recettes/importer" className="icon-btn" aria-label="Importer des recettes">
              <ClipboardPaste className="size-5" />
            </Link>
            <button className="icon-btn bg-brand text-brand-ink active:bg-brand" onClick={() => setQuick(true)} aria-label="Nouvelle recette">
              <Plus className="size-5" />
            </button>
          </>
        }
      />
      <div className="space-y-3 px-4">
        {(cookable.data?.ranked.length ?? 0) > 0 && (
          <Link to="/recettes/avec-mon-stock" className="card flex items-center gap-3 border-ok/30 bg-ok-soft p-3.5">
            <ChefHat className="size-5 text-ok" />
            <span className="flex-1">
              <span className="block font-semibold">Que puis-je cuisiner ?</span>
              <span className="text-sm text-ink-2">
                {ready} réalisable{ready > 1 ? "s" : ""} avec le stock{nearly > 0 ? ` · ${nearly} à un ingrédient près` : ""}
              </span>
            </span>
            <ChevronRight className="size-5 text-ink-3" />
          </Link>
        )}
        {(recipes.data?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <Link to="/recettes/tableur" className="btn-soft min-h-10 text-sm">
              <Table className="size-4" /> Édition en masse
            </Link>
            <Link to="/recettes/ingredients" className="btn-soft min-h-10 text-sm">
              <Link2 className="size-4" /> Ingrédients ↔ stock
            </Link>
          </div>
        )}
        {(recipes.data?.length ?? 0) > 0 && (
          <>
            <label className="relative block">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
              <input className="input pl-10" placeholder="Nom, ingrédient, tag…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
            </label>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
              <button className={`chip ${filter === "all" ? "chip-on" : ""}`} onClick={() => setFilter("all")}>
                Toutes
              </button>
              <button className={`chip ${filter === "fav" ? "chip-on" : ""}`} onClick={() => setFilter("fav")}>
                <Heart className="size-3.5" /> Favoris
              </button>
              {usedCats.map((c) => (
                <button key={c.id} className={`chip ${filter === c.id ? "chip-on" : ""}`} onClick={() => setFilter(c.id)}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          </>
        )}

        {recipes.isPending ? (
          <PageLoader />
        ) : recipes.data?.length === 0 ? (
          <EmptyState icon="📖" title="Aucune recette pour l'instant">
            <p>Commencez simplement par un nom, vous compléterez plus tard.</p>
            <button className="btn-primary mt-4" onClick={() => setQuick(true)}>
              <Plus className="size-4" /> Ajouter une recette
            </button>
            <Link to="/recettes/importer" className="btn-soft mt-2">
              <ClipboardPaste className="size-4" /> Importer une liste
            </Link>
          </EmptyState>
        ) : list.length === 0 ? (
          <EmptyState icon="🔍" title="Aucune recette ne correspond" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {list.map((r) => (
              <RecipeCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>
      <QuickRecipeSheet open={quick} onClose={() => setQuick(false)} />
    </>
  );
}
