import { useMemo, useState } from "react";
import { Link } from "react-router";
import { addDays, todayIso, weekStart } from "../../shared/dates";
import { unitPriceCents } from "../../shared/prices";
import { BarList, type BarItem, type Column, ColumnChart } from "@/components/charts";
import { Chips, EmptyState, PageHeader, PageLoader, Thumb } from "@/components/ui";
import { formatCents, formatDate, formatQty, formatUnitPrice } from "@/lib/format";
import { usePurchases } from "@/lib/purchaseQueries";
import { useCategories } from "@/lib/queries";

type Period = "30d" | "6m" | "12m";
const PERIODS: { value: Period; label: string }[] = [
  { value: "30d", label: "5 semaines" },
  { value: "6m", label: "6 mois" },
  { value: "12m", label: "12 mois" },
];

const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const monthLong = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const dm = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Jour local d'un achat (la date est enregistrée à midi, heure locale). */
const localDay = (iso: string) => todayIso(new Date(iso));

function buckets(period: Period, today: string): { from: string; cols: { key: string; label: string; tooltip: string; start: string; end: string }[] } {
  if (period === "30d") {
    // 5 semaines calendaires, la dernière étant la semaine en cours.
    const first = addDays(weekStart(today), -28);
    const cols = Array.from({ length: 5 }, (_, i) => {
      const start = addDays(first, i * 7);
      const end = addDays(start, 6);
      return { key: start, start, end, label: dm.format(new Date(`${start}T00:00:00Z`)), tooltip: `Semaine du ${dm.format(new Date(`${start}T00:00:00Z`))}` };
    });
    return { from: first, cols };
  }
  const n = period === "6m" ? 6 : 12;
  const [y, m] = today.split("-").map(Number);
  const cols = Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    const start = todayIso(d);
    const end = todayIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { key: start, start, end, label: monthFmt.format(d).replace(".", ""), tooltip: monthLong.format(d) };
  });
  return { from: cols[0].start, cols };
}

export function SpendingPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const today = todayIso();
  const { from, cols } = useMemo(() => buckets(period, today), [period, today]);
  const purchases = usePurchases(from, today);
  const categories = useCategories();

  const data = useMemo(() => {
    const list = purchases.data ?? [];
    const priced = list.filter((p) => p.totalCents != null);
    const total = priced.reduce((s, p) => s + p.totalCents!, 0);
    const columns: Column[] = cols.map((c) => ({
      key: c.key,
      label: c.label,
      tooltip: c.tooltip,
      valueCents: priced.filter((p) => localDay(p.date) >= c.start && localDay(p.date) <= c.end).reduce((s, p) => s + p.totalCents!, 0),
    }));
    const cats = (categories.data ?? []).filter((c) => c.kind === "product");
    const root = (id: string | null) => {
      let c = cats.find((x) => x.id === id);
      for (let g = 0; c?.parentId && g < 10; g++) c = cats.find((x) => x.id === c!.parentId) ?? c;
      return c;
    };
    const byCat = new Map<string, BarItem>();
    const byStore = new Map<string, BarItem>();
    for (const p of priced) {
      const r = root(p.product.categoryId);
      const ck = r?.id ?? "_none";
      byCat.set(ck, { key: ck, label: r ? `${r.icon ?? ""} ${r.name}` : "Sans catégorie", valueCents: (byCat.get(ck)?.valueCents ?? 0) + p.totalCents! });
      const sk = p.store?.name ?? "_none";
      byStore.set(sk, { key: sk, label: p.store?.name ?? "Magasin non précisé", valueCents: (byStore.get(sk)?.valueCents ?? 0) + p.totalCents! });
    }
    const sort = (m: Map<string, BarItem>) => [...m.values()].sort((a, b) => b.valueCents - a.valueCents);
    return { list, priced, total, columns, byCat: sort(byCat), byStore: sort(byStore), unpriced: list.length - priced.length };
  }, [purchases.data, categories.data, cols]);

  return (
    <>
      <PageHeader back="/stock" title="Dépenses" />
      <div className="space-y-5 px-4 pb-6">
        <Chips options={PERIODS} value={period} onChange={setPeriod} />
        {purchases.isPending ? (
          <PageLoader />
        ) : data.list.length === 0 ? (
          <EmptyState icon="🧾" title="Aucun achat sur la période">
            <p>Les achats s'enregistrent en rangeant les courses ou depuis la fiche d'un produit.</p>
          </EmptyState>
        ) : (
          <>
            <div>
              <p className="text-sm text-ink-2">Dépensé sur {PERIODS.find((p) => p.value === period)!.label}</p>
              <p className="text-5xl font-bold tracking-tight">{formatCents(data.total)}</p>
              <p className="mt-1 text-sm text-ink-2">
                {data.priced.length} achat{data.priced.length > 1 ? "s" : ""} avec prix
                {data.unpriced > 0 && ` · ${data.unpriced} sans prix (non comptés)`}
              </p>
            </div>

            {data.priced.length > 0 && (
              <>
                <section className="card p-4">
                  <h2 className="mb-2 text-sm font-semibold">{period === "30d" ? "Par semaine" : "Par mois"}</h2>
                  <ColumnChart data={data.columns} ariaLabel={`Dépenses ${period === "30d" ? "par semaine" : "par mois"}, total ${formatCents(data.total)}`} />
                </section>
                <section className="card p-4">
                  <h2 className="mb-3 text-sm font-semibold">Par catégorie</h2>
                  <BarList items={data.byCat} total={data.total} />
                </section>
                {data.byStore.length > 1 || data.byStore[0]?.key !== "_none" ? (
                  <section className="card p-4">
                    <h2 className="mb-3 text-sm font-semibold">Par magasin</h2>
                    <BarList items={data.byStore} total={data.total} />
                  </section>
                ) : null}
              </>
            )}

            <section>
              <h2 className="mb-2 text-lg font-bold">Derniers achats</h2>
              <ul className="card divide-y divide-line text-sm">
                {data.list.slice(0, 30).map((p) => {
                  const u = unitPriceCents(p);
                  return (
                    <li key={p.id}>
                      <Link to={`/produits/${p.productId}`} className="flex items-center gap-3 px-3 py-2.5">
                        <Thumb photoId={p.product.photoId} fallback="🧾" className="size-10 shrink-0 rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{p.product.name || "Produit"}</span>
                          <span className="block truncate text-xs text-ink-3">
                            {[formatDate(p.date), p.quantity != null ? formatQty(p.quantity, p.unit) : null, p.store?.name, p.isPromo ? "promo" : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums">{p.totalCents != null ? formatCents(p.totalCents) : "—"}</span>
                          {u != null && <span className="text-xs text-ink-3">{formatUnitPrice(u, p.unit)}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}
