import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { stockValueCents } from "../../shared/prices";
import { BarList, type BarItem } from "@/components/charts";
import { EmptyState, PageHeader, PageLoader } from "@/components/ui";
import { formatCents, formatQty, formatUnitPrice } from "@/lib/format";
import { useCategories, useLocations, useProducts } from "@/lib/queries";
import type { Category, Location } from "@/lib/types";

function rootOf<T extends { id: string; parentId: string | null }>(items: T[], id: string | null | undefined) {
  let c = items.find((x) => x.id === id);
  for (let g = 0; c?.parentId && g < 10; g++) c = items.find((x) => x.id === c!.parentId) ?? c;
  return c;
}

export function StockValuePage() {
  const products = useProducts();
  const categories = useCategories();
  const locations = useLocations();
  const [by, setBy] = useState<"category" | "location">("category");
  const [showMissing, setShowMissing] = useState(false);

  const data = useMemo(() => {
    const cats: Category[] = (categories.data ?? []).filter((c) => c.kind === "product");
    const locs: Location[] = locations.data ?? [];
    const inStock = (products.data ?? []).filter((p) => p.quantity != null && p.quantity > 0);
    const valued = inStock.filter((p) => p.pricing);
    const missing = inStock.filter((p) => !p.pricing);
    const total = valued.reduce((s, p) => s + (stockValueCents(p.quantity, p.pricing?.avgCents) ?? 0), 0);

    const groups = new Map<string, BarItem>();
    const add = (key: string, label: string, cents: number | null) => {
      if (!cents) return;
      const g = groups.get(key) ?? { key, label, valueCents: 0 };
      g.valueCents += cents;
      groups.set(key, g);
    };
    for (const p of valued) {
      if (by === "category") {
        const root = rootOf(cats, p.categoryId);
        add(root?.id ?? "_none", root ? `${root.icon ?? ""} ${root.name}` : "Sans catégorie", stockValueCents(p.quantity, p.pricing!.avgCents));
      } else {
        // Chaque ligne de stock est valorisée à son emplacement.
        for (const line of p.stock) {
          const root = rootOf(locs, line.locationId);
          add(root?.id ?? "_none", root ? `${root.icon ?? ""} ${root.name}` : "Sans emplacement", stockValueCents(line.quantity, p.pricing!.avgCents));
        }
      }
    }
    const items = [...groups.values()].sort((a, b) => b.valueCents - a.valueCents);
    const top = [...valued]
      .map((p) => ({ p, v: stockValueCents(p.quantity, p.pricing!.avgCents) ?? 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
    return { inStock, valued, missing, total, items, top };
  }, [products.data, categories.data, locations.data, by]);

  if (products.isPending) return <PageLoader />;

  return (
    <>
      <PageHeader back="/stock" title="Valeur du stock" />
      <div className="space-y-5 px-4 pb-6">
        {data.valued.length === 0 ? (
          <EmptyState icon="💶" title="Pas encore de valeur calculable">
            <p>La valeur apparaît dès qu'un produit en stock a au moins un achat avec son prix (fiche produit → « Achat », ou prix saisi en rangeant les courses).</p>
          </EmptyState>
        ) : (
          <>
            <div>
              <p className="text-sm text-ink-2">Valeur estimée au coût moyen d'achat</p>
              <p className="text-5xl font-bold tracking-tight">{formatCents(data.total)}</p>
              <p className="mt-1 text-sm text-ink-2">
                Calculée sur {data.valued.length} produit{data.valued.length > 1 ? "s" : ""} sur {data.inStock.length} en stock.
              </p>
            </div>

            <section className="card p-4">
              <div className="mb-4 flex rounded-xl bg-surface-2 p-1">
                {(["category", "location"] as const).map((k) => (
                  <button key={k} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${by === k ? "bg-surface shadow-sm" : "text-ink-2"}`} onClick={() => setBy(k)}>
                    Par {k === "category" ? "catégorie" : "emplacement"}
                  </button>
                ))}
              </div>
              <BarList items={data.items} total={data.total} />
            </section>

            <section>
              <h2 className="mb-2 text-lg font-bold">Plus grosses valeurs</h2>
              <ul className="card divide-y divide-line">
                {data.top.map(({ p, v }) => (
                  <li key={p.id}>
                    <Link to={`/produits/${p.id}`} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{p.name}</span>
                        <span className="text-xs text-ink-3">
                          {formatQty(p.quantity, p.unit)} · {formatUnitPrice(p.pricing!.avgCents, p.unit)}
                        </span>
                      </span>
                      <span className="font-bold tabular-nums">{formatCents(v)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {data.missing.length > 0 && (
          <section>
            <button className="flex w-full items-center gap-2 py-1 text-left text-sm font-semibold text-ink-2" onClick={() => setShowMissing((v) => !v)} aria-expanded={showMissing}>
              {data.missing.length} produit{data.missing.length > 1 ? "s" : ""} en stock sans prix (non comptés)
              <ChevronDown className={`ml-auto size-4 transition ${showMissing ? "rotate-180" : ""}`} />
            </button>
            {showMissing && (
              <ul className="card mt-2 divide-y divide-line text-sm">
                {data.missing.map((p) => (
                  <li key={p.id}>
                    <Link to={`/produits/${p.id}`} className="flex items-center justify-between px-4 py-2.5">
                      <span className="font-medium">{p.name || "Sans nom"}</span>
                      <span className="text-ink-3">{formatQty(p.quantity, p.unit)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
