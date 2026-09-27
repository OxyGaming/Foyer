import { AlertTriangle, ChevronRight, ClipboardCheck, Euro, GitMerge, Plus, Receipt, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { stockValueCents } from "../../shared/prices";
import { matches } from "../../shared/text";
import { findDuplicates } from "@/lib/duplicates";
import { formatCents } from "@/lib/format";
import { ProductRow } from "@/components/ProductRow";
import { QuickProductSheet } from "@/components/QuickProductSheet";
import { Chips, EmptyState, PageHeader, PageLoader } from "@/components/ui";
import { useCategories, useLocations, useProducts } from "@/lib/queries";
import { descendantIds, pathLabel } from "@/lib/tree";
import type { Category, Product } from "@/lib/types";

type GroupBy = "category" | "location";

/** Valeur totale au coût moyen ; null si aucun produit en stock n'a de prix. */
export function totalStockValue(products: Product[] | undefined): number | null {
  const values = (products ?? []).map((p) => stockValueCents(p.quantity, p.pricing?.avgCents)).filter((v): v is number => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

/** Catégorie de premier niveau (Alimentaire pour « Alimentaire › Conserves »). */
function rootCategory(cats: Category[], id: string | null) {
  let c = cats.find((x) => x.id === id);
  for (let g = 0; c?.parentId && g < 10; g++) c = cats.find((x) => x.id === c!.parentId) ?? c;
  return c;
}

export function StockPage() {
  const products = useProducts();
  const categories = useCategories();
  const locations = useLocations();
  const [q, setQ] = useState("");
  const [params] = useSearchParams();
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (params.get("groupe") as GroupBy) || (safeGet("stock-group") as GroupBy) || "category");
  const [filter, setFilter] = useState(params.get("filtre") ?? "all");
  const [quick, setQuick] = useState(false);

  const cats = useMemo(() => (categories.data ?? []).filter((c) => c.kind === "product"), [categories.data]);
  const locs = locations.data ?? [];
  const alerts = (products.data ?? []).filter((p) => p.status === "low" || p.status === "out" || p.status === "watch").length;
  const stockValue = totalStockValue(products.data);
  const duplicates = useMemo(() => findDuplicates(products.data ?? []).length, [products.data]);

  const groups = useMemo(() => {
    let list = products.data ?? [];
    if (q.trim()) list = list.filter((p) => matches(p.name, q) || matches(p.brand, q));
    if (filter !== "all") {
      if (groupBy === "category") {
        const ids = descendantIds(cats, filter);
        list = list.filter((p) => p.categoryId && ids.has(p.categoryId));
      } else {
        const ids = descendantIds(locs, filter);
        list = list.filter((p) => p.stock.some((s) => s.locationId && ids.has(s.locationId)));
      }
    }
    const map = new Map<string, { key: string; label: string; icon: string; items: Product[] }>();
    const push = (key: string, label: string, icon: string, p: Product) => {
      if (!map.has(key)) map.set(key, { key, label, icon, items: [] });
      map.get(key)!.items.push(p);
    };
    for (const p of list) {
      if (groupBy === "category") {
        const root = rootCategory(cats, p.categoryId);
        push(root?.id ?? "_none", root?.name ?? "Sans catégorie", root?.icon ?? "📦", p);
      } else {
        const locIds = [...new Set(p.stock.map((s) => s.locationId))];
        if (locIds.length === 0) push("_none", "Sans emplacement", "📍", p);
        for (const l of locIds) {
          const loc = locs.find((x) => x.id === l);
          push(l ?? "_none", loc ? pathLabel(locs, loc.id) : "Sans emplacement", loc?.icon ?? "📍", p);
        }
      }
    }
    const order = groupBy === "category" ? cats.map((c) => c.id) : locs.map((l) => l.id);
    return [...map.values()].sort((a, b) => {
      const ia = a.key === "_none" ? 1e9 : order.indexOf(a.key);
      const ib = b.key === "_none" ? 1e9 : order.indexOf(b.key);
      return ia - ib || a.label.localeCompare(b.label, "fr");
    });
  }, [products.data, q, filter, groupBy, cats, locs]);

  const filterOptions =
    groupBy === "category"
      ? cats.filter((c) => !c.parentId).map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))
      : locs.filter((l) => !l.parentId).map((l) => ({ value: l.id, label: `${l.icon ?? ""} ${l.name}` }));

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle={products.data ? `${products.data.length} produit${products.data.length > 1 ? "s" : ""}` : undefined}
        actions={
          <button className="icon-btn bg-brand text-brand-ink active:bg-brand" onClick={() => setQuick(true)} aria-label="Nouveau produit">
            <Plus className="size-5" />
          </button>
        }
      />
      <div className="space-y-3 px-4">
        {alerts > 0 && (
          <Link to="/stock/alertes" className="card flex items-center gap-3 border-low/30 bg-low-soft p-3.5 text-low">
            <AlertTriangle className="size-5" />
            <span className="flex-1 font-semibold">
              {alerts} produit{alerts > 1 ? "s" : ""} à réapprovisionner
            </span>
            <ChevronRight className="size-5" />
          </Link>
        )}

        {duplicates > 0 && (
          <Link to="/stock/doublons" className="card flex items-center gap-3 border-watch/40 bg-watch-soft p-3.5">
            <GitMerge className="size-5 text-watch" />
            <span className="flex-1 font-semibold">
              {duplicates} produit{duplicates > 1 ? "s" : ""} en double
            </span>
            <ChevronRight className="size-5 text-ink-3" />
          </Link>
        )}

        {(products.data?.length ?? 0) > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <Link to="/stock/valeur" className="card flex flex-col items-center gap-1 p-2.5 text-center">
              <Euro className="size-5 text-brand" />
              <span className="text-xs font-semibold">{stockValue != null ? formatCents(stockValue, true) : "Valeur"}</span>
            </Link>
            <Link to="/achats" className="card flex flex-col items-center gap-1 p-2.5 text-center">
              <Receipt className="size-5 text-brand" />
              <span className="text-xs font-semibold">Dépenses</span>
            </Link>
            <Link to="/stock/inventaire" className="card flex flex-col items-center gap-1 p-2.5 text-center">
              <ClipboardCheck className="size-5 text-brand" />
              <span className="text-xs font-semibold">Inventaire</span>
            </Link>
          </div>
        )}

        {(products.data?.length ?? 0) > 0 && (
          <>
            <label className="relative block">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
              <input className="input pl-10" type="search" placeholder="Rechercher un produit…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="flex rounded-xl bg-surface-2 p-1">
              {(["category", "location"] as const).map((g) => (
                <button
                  key={g}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${groupBy === g ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}
                  onClick={() => {
                    setGroupBy(g);
                    setFilter("all");
                    safeSet("stock-group", g);
                  }}
                >
                  Par {g === "category" ? "catégorie" : "emplacement"}
                </button>
              ))}
            </div>
            {filterOptions.length > 0 && <Chips options={[{ value: "all", label: "Tout" }, ...filterOptions]} value={filter} onChange={setFilter} />}
          </>
        )}

        {products.isPending ? (
          <PageLoader />
        ) : products.data?.length === 0 ? (
          <EmptyState icon="🧺" title="Le stock est vide">
            <p>Ajoutez vos produits au fil de l'eau : alimentaire, hygiène, entretien…</p>
            <button className="btn-primary mt-4" onClick={() => setQuick(true)}>
              <Plus className="size-4" /> Ajouter un produit
            </button>
          </EmptyState>
        ) : groups.length === 0 ? (
          <EmptyState icon="🔍" title="Aucun produit ne correspond" />
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-1.5 flex items-center gap-2 px-1 pt-2 text-sm font-bold tracking-wide text-ink-2 uppercase">
                <span>{g.icon}</span> {g.label} <span className="font-medium text-ink-3">· {g.items.length}</span>
              </h2>
              <div className="card divide-y divide-line overflow-hidden">
                {g.items.map((p) => (
                  <ProductRow key={p.id} p={p} locations={locs} categories={cats} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <QuickProductSheet open={quick} onClose={() => setQuick(false)} />
    </>
  );
}
