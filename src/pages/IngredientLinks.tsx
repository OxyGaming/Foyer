import { AlertTriangle, ChevronLeft, ChevronRight, Link2, Search, Shuffle, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { matches } from "../../shared/text";
import { AlternativesSheet, ProductPickSheet } from "@/components/AlternativesSheet";
import { Pager } from "@/components/Pager";
import { Chips, EmptyState, PageHeader, PageLoader, StatusBadge, Thumb } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { groupIngredients, type LinkGroup, type LinkIssue } from "@/lib/ingredientLinks";
import { useLinkIngredients, useLocations, useProducts, useRecipes } from "@/lib/queries";
import { useSwipe } from "@/lib/swipe";
import { pathLabel } from "@/lib/tree";
import type { Location, Product } from "@/lib/types";

type Filter = "all" | LinkIssue;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "unlinked", label: "Non reliés" },
  { value: "units", label: "Unités à vérifier" },
  { value: "missing", label: "Absents du stock" },
  { value: "variants", label: "Avec variantes" },
];

const stockLabel = (p: Product) => (p.quantity != null ? formatQty(p.quantity, p.unit) : p.stock.length ? "en stock" : "pas en stock");

/**
 * Liens entre les ingrédients des recettes et les produits du stock : qui utilise
 * quoi, les variantes acceptées (« Pâtes » → tagliatelles, coquillettes) et ce qui
 * cloche. PC : liste + détail côte à côte. Mobile : détail plein écran, balayer
 * pour passer d'un ingrédient à l'autre.
 */
export function IngredientLinksPage() {
  const recipes = useRecipes();
  const products = useProducts();
  const locations = useLocations();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => groupIngredients(recipes.data ?? [], products.data ?? []), [recipes.data, products.data]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: groups.length, unlinked: 0, units: 0, missing: 0, variants: 0 };
    for (const g of groups) for (const i of g.issues) c[i]++;
    return c;
  }, [groups]);
  const shown = useMemo(
    () =>
      groups.filter(
        (g) => (filter === "all" || g.issues.has(filter)) && (!q.trim() || matches(g.name, q) || g.aliases.some((a) => matches(a, q)) || g.uses.some((u) => matches(u.recipeName, q))),
      ),
    [groups, filter, q],
  );

  const selectedKey = params.get("i");
  const selected = groups.find((g) => g.key === selectedKey) ?? null;
  const index = selected ? shown.indexOf(selected) : -1;
  const show = (key: string, replace = true) => setParams({ i: key }, { replace });
  const step = (d: number) => {
    const g = index >= 0 ? shown[index + d] : undefined;
    return g ? () => show(g.key) : null;
  };
  const swipe = useSwipe({ onPrev: step(-1), onNext: step(1) });

  const filterOptions = FILTERS.filter((f) => f.value === "all" || counts[f.value] > 0).map((f) => ({
    value: f.value,
    label: (
      <>
        {f.label} <span className="text-ink-3">{counts[f.value]}</span>
      </>
    ),
  }));

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col lg:h-dvh">
      <PageHeader back="/recettes" title="Ingrédients ↔ stock" subtitle={recipes.data ? `${groups.length} ingrédients dans ${recipes.data.length} recettes` : undefined} />
      {recipes.isPending || products.isPending ? (
        <PageLoader />
      ) : groups.length === 0 ? (
        <EmptyState icon="🥕" title="Aucun ingrédient pour l'instant">
          <p>Ajoutez des ingrédients à vos recettes : ils seront reliés au stock automatiquement.</p>
        </EmptyState>
      ) : (
        <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-4 lg:px-4 lg:pb-4">
          {/* Liste */}
          <aside className={`${selected ? "hidden" : "flex"} min-h-0 flex-col gap-2 px-4 pb-8 lg:flex lg:px-0 lg:pb-0`}>
            <label className="relative block shrink-0">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
              <input className="input pl-10" type="search" placeholder="Ingrédient, recette…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="shrink-0 lg:[&>div]:mx-0 lg:[&>div]:px-0">
              <Chips options={filterOptions} value={filter} onChange={setFilter} />
            </div>
            <ul className="card min-h-0 divide-y divide-line overflow-y-auto">
              {shown.length === 0 && <li className="p-6 text-center text-sm text-ink-3">Rien ne correspond</li>}
              {shown.map((g) => (
                <li key={g.key}>
                  <button className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${g.key === selectedKey ? "bg-brand-soft" : "hover:bg-surface-2/60"}`} onClick={() => show(g.key, !!selected)}>
                    <GroupIcon g={g} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{g.name}</span>
                      <span className="block truncate text-xs text-ink-2">
                        {g.uses.length} recette{g.uses.length > 1 ? "s" : ""}
                        {g.alternatives.length > 0 && ` · ${g.alternatives.length} variante${g.alternatives.length > 1 ? "s" : ""}`}
                        {g.product && ` · ${stockLabel(g.product)}`}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-3 lg:hidden" />
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Détail */}
          <section className={`${selected ? "block" : "hidden"} min-h-0 pb-8 lg:block lg:overflow-y-auto lg:pb-0`}>
            {selected ? (
              <>
                <div className="sticky top-14 z-10 space-y-2 bg-bg/90 px-4 pb-2 backdrop-blur-md lg:top-0 lg:px-0">
                  <button className="btn-ghost -ml-2 min-h-9 px-2 text-sm lg:hidden" onClick={() => setParams({}, { replace: true })}>
                    <ChevronLeft className="size-4" /> Tous les ingrédients
                  </button>
                  {index >= 0 && <Pager index={index} count={shown.length} onPrev={step(-1)} onNext={step(1)} />}
                </div>
                <div className="overflow-x-clip">
                  <div ref={swipe} className="px-4 lg:px-0">
                    <GroupDetail key={selected.key} g={selected} products={products.data ?? []} locations={locations.data ?? []} onMoved={show} />
                  </div>
                </div>
              </>
            ) : (
              <div className="card flex h-full items-center justify-center p-8 text-center text-ink-3">Choisissez un ingrédient pour voir ses recettes, son stock et ses variantes.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function GroupIcon({ g }: { g: LinkGroup }) {
  if (!g.product) return <Unlink className="size-5 shrink-0 text-low" aria-label="Non relié au stock" />;
  if (g.issues.has("units")) return <AlertTriangle className="size-5 shrink-0 text-watch" aria-label="Unités à vérifier" />;
  return <span className={`mx-1.5 size-2 shrink-0 rounded-full ${g.missing ? "bg-line" : "bg-ok"}`} aria-label={g.missing ? "Absent du stock" : "En stock"} />;
}

function GroupDetail({ g, products, locations, onMoved }: { g: LinkGroup; products: Product[]; locations: Location[]; onMoved: (key: string) => void }) {
  const link = useLinkIngredients();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // Les actions portent sur les recettes cochées (toutes par défaut).
  const [picked, setPicked] = useState<Set<string>>(() => new Set(g.uses.map((u) => u.ingredientId)));
  const [sheet, setSheet] = useState<"product" | "variants" | null>(null);
  const ids = g.uses.filter((u) => picked.has(u.ingredientId)).map((u) => u.ingredientId);
  const pickedUses = g.uses.filter((u) => picked.has(u.ingredientId));
  const p = g.product;
  const where = p ? [...new Set(p.stock.map((s) => (s.locationId ? pathLabel(locations, s.locationId) : null)).filter(Boolean))].join(", ") : "";

  return (
    <div className="space-y-5">
      {/* Produit relié */}
      <div className="card flex items-center gap-3 p-3">
        {p ? (
          <>
            <Thumb photoId={p.photoId} fallback="📦" className="size-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Link to={`/produits/${p.id}`} className="block truncate text-lg font-bold hover:text-brand">
                {p.name || "Sans nom"}
              </Link>
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <span className="tabular-nums">{stockLabel(p)}</span>
                <StatusBadge status={p.status} />
                {where && <span className="truncate text-ink-3">📍 {where}</span>}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <p className="text-lg font-bold">{g.name}</p>
            <p className="text-sm text-low">Pas relié au stock : il ne compte ni pour « Que puis-je cuisiner ? » ni pour les courses.</p>
          </div>
        )}
      </div>
      {g.aliases.length > 0 && <p className="-mt-3 px-1 text-sm text-ink-2">Appelé aussi dans les recettes : {g.aliases.map((a) => `« ${a} »`).join(", ")}</p>}

      {/* Variantes */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Variantes acceptées</h2>
          <button className="btn-ghost min-h-9 px-2 text-sm" onClick={() => setSheet("variants")} disabled={!ids.length || !p}>
            <Shuffle className="size-4" /> Modifier
          </button>
        </div>
        {g.alternatives.length === 0 ? (
          <p className="card p-3 text-sm text-ink-2">
            Aucune. Ex. pour « Pâtes » : tagliatelles et coquillettes conviennent, pas les raviolis. Le stock de l'une d'elles suffira pour cuisiner.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {g.alternatives.map((id) => {
              const alt = byId.get(id);
              if (!alt) return null;
              const n = g.uses.filter((u) => u.alternatives.includes(id)).length;
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                  <Link to={`/produits/${id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                    {alt.name}
                  </Link>
                  {n < g.uses.length && <span className="text-xs text-ink-3">{n} recette{n > 1 ? "s" : ""}</span>}
                  <span className="text-sm text-ink-2 tabular-nums">{stockLabel(alt)}</span>
                  <StatusBadge status={alt.status} compact />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recettes */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            Dans {g.uses.length} recette{g.uses.length > 1 ? "s" : ""}
          </h2>
          <button className="btn-ghost min-h-9 px-2 text-sm" onClick={() => setSheet("product")} disabled={!ids.length}>
            <Link2 className="size-4" /> {p ? "Relier à un autre produit" : "Relier au stock"}
          </button>
        </div>
        <ul className="card divide-y divide-line">
          {g.uses.map((u) => (
            <li key={u.ingredientId} className="flex items-start gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                checked={picked.has(u.ingredientId)}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(u.ingredientId)) n.delete(u.ingredientId);
                    else n.add(u.ingredientId);
                    return n;
                  })
                }
                aria-label={`Inclure ${u.recipeName}`}
              />
              <span className="min-w-0 flex-1">
                <Link to={`/recettes/${u.recipeId}`} className="block truncate font-medium hover:text-brand">
                  {u.recipeName}
                </Link>
                <span className="block text-xs text-ink-2">
                  {u.name}
                  {u.alternatives.length > 0 && ` · ou ${u.alternatives.map((a) => byId.get(a)?.name ?? "?").join(", ")}`}
                </span>
                {u.unitMismatch && p && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-watch">
                    <AlertTriangle className="size-3.5" /> En « {u.unit ?? "pièce"} » alors que le stock compte en « {p.unit ?? "pièce"} » : quantité non déduite
                  </span>
                )}
              </span>
              {(u.quantity != null || u.unit) && <span className="shrink-0 text-sm font-semibold text-ink-2 tabular-nums">{formatQty(u.quantity, u.unit)}</span>}
            </li>
          ))}
        </ul>
        {ids.length < g.uses.length && <p className="mt-1 px-1 text-xs text-ink-3">Les modifications s'appliqueront aux {ids.length} recettes cochées.</p>}
      </section>

      <AlternativesSheet
        open={sheet === "variants"}
        onClose={() => setSheet(null)}
        products={products}
        name={g.name}
        mainId={p?.id ?? null}
        value={[...new Set(pickedUses.flatMap((u) => u.alternatives))]}
        busy={link.isPending}
        onSave={(alternatives) =>
          link.mutate(
            { ids, alternatives },
            {
              onSuccess: () => {
                setSheet(null);
              },
            },
          )
        }
      />
      <ProductPickSheet
        open={sheet === "product"}
        onClose={() => setSheet(null)}
        products={products}
        title={`Relier « ${g.name} » à…`}
        initialQuery={p ? "" : g.name}
        currentId={p?.id ?? null}
        onPick={(productId) =>
          link.mutate(
            { ids, productId },
            {
              onSuccess: () => {
                setSheet(null);
                onMoved(productId);
              },
            },
          )
        }
      />
    </div>
  );
}
