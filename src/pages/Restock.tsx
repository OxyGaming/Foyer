import { useMemo, useState } from "react";
import { ProductRow } from "@/components/ProductRow";
import { EmptyState, PageHeader, PageLoader } from "@/components/ui";
import { useCategories, useLocations, useProducts } from "@/lib/queries";
import { descendantIds, flattenTree } from "@/lib/tree";
import type { StockStatus } from "@/lib/types";

const LEVELS: { value: StockStatus | "all"; label: string }[] = [
  { value: "all", label: "Toutes alertes" },
  { value: "out", label: "⚫ Rupture" },
  { value: "low", label: "🔴 À acheter" },
  { value: "watch", label: "🟠 À surveiller" },
];
const SEVERITY: Record<StockStatus, number> = { out: 0, low: 1, watch: 2, ok: 3, none: 4 };

export function RestockPage() {
  const products = useProducts();
  const categories = useCategories();
  const locations = useLocations();
  const [level, setLevel] = useState<StockStatus | "all">("all");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");

  const cats = useMemo(() => (categories.data ?? []).filter((c) => c.kind === "product"), [categories.data]);
  const locs = locations.data ?? [];

  const list = useMemo(() => {
    let l = (products.data ?? []).filter((p) => p.status === "out" || p.status === "low" || p.status === "watch");
    if (level !== "all") l = l.filter((p) => p.status === level);
    if (categoryId) {
      const ids = descendantIds(cats, categoryId);
      l = l.filter((p) => p.categoryId && ids.has(p.categoryId));
    }
    if (locationId) {
      const ids = descendantIds(locs, locationId);
      l = l.filter((p) => p.stock.some((s) => s.locationId && ids.has(s.locationId)) || (p.defaultLocationId && ids.has(p.defaultLocationId)));
    }
    return l.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.name.localeCompare(b.name, "fr"));
  }, [products.data, level, categoryId, locationId, cats, locs]);

  return (
    <>
      <PageHeader back title="À réapprovisionner" subtitle={products.data ? `${list.length} produit${list.length > 1 ? "s" : ""}` : undefined} />
      <div className="space-y-3 px-4">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
          {LEVELS.map((l) => (
            <button key={l.value} className={`chip ${level === l.value ? "chip-on" : ""}`} onClick={() => setLevel(l.value)}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select className="input py-2.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filtrer par catégorie">
            <option value="">Toutes catégories</option>
            {flattenTree(cats).map((c) => (
              <option key={c.id} value={c.id}>
                {"  ".repeat(c.depth)}
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <select className="input py-2.5 text-sm" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Filtrer par emplacement">
            <option value="">Tous emplacements</option>
            {flattenTree(locs).map((l) => (
              <option key={l.id} value={l.id}>
                {"  ".repeat(l.depth)}
                {l.icon} {l.name}
              </option>
            ))}
          </select>
        </div>
        {products.isPending ? (
          <PageLoader />
        ) : list.length === 0 ? (
          <EmptyState icon="✅" title="Rien à réapprovisionner">
            <p>Les alertes n'apparaissent que pour les produits ayant un stock minimum.</p>
          </EmptyState>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {list.map((p) => (
              <ProductRow key={p.id} p={p} locations={locs} categories={cats} showToBuy />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
