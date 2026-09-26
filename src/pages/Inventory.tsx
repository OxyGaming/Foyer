import { ClipboardCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { NumberInput, EmptyState, PageHeader, PageLoader, Spinner } from "@/components/ui";
import { formatDateTime, formatQty } from "@/lib/format";
import { useInventoryHistory, useSaveInventory } from "@/lib/purchaseQueries";
import { useLocations, useProducts } from "@/lib/queries";
import { flattenTree, pathLabel } from "@/lib/tree";

type Row = { key: string; productId: string; name: string; unit: string | null; locationId: string | null; recorded: number | null };

const NONE = "_none";

/**
 * Inventaire par emplacement : on saisit ce qu'on compte réellement, seules les
 * lignes renseignées sont enregistrées, et chaque écart est historisé.
 */
export function InventoryPage() {
  const products = useProducts();
  const locations = useLocations();
  const history = useInventoryHistory();
  const save = useSaveInventory();
  const locs = locations.data ?? [];
  const [where, setWhere] = useState<string>("all");
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const p of products.data ?? []) {
      const lines = p.stock.map((s) => ({ locationId: s.locationId, recorded: s.quantity }));
      // Produit rangé habituellement ici mais sans ligne de stock : on peut le compter aussi.
      if (p.defaultLocationId && !lines.some((l) => l.locationId === p.defaultLocationId)) lines.push({ locationId: p.defaultLocationId, recorded: null });
      for (const l of lines) {
        const inScope = where === "all" || (where === NONE ? l.locationId === null : l.locationId === where);
        if (inScope) out.push({ key: `${p.id}|${l.locationId ?? NONE}`, productId: p.id, name: p.name || "Sans nom", unit: p.unit, ...l });
      }
    }
    return out.sort((a, b) => pathLabel(locs, a.locationId).localeCompare(pathLabel(locs, b.locationId), "fr") || a.name.localeCompare(b.name, "fr"));
  }, [products.data, where, locs]);

  const filled = rows.filter((r) => counts[r.key] != null);
  const diffs = filled.filter((r) => counts[r.key] !== r.recorded).length;

  function submit() {
    save.mutate(
      filled.map((r) => ({ productId: r.productId, locationId: r.locationId, quantity: counts[r.key]! })),
      { onSuccess: () => setCounts({}) },
    );
  }

  const options = [{ value: "all", label: "Tout" }, ...flattenTree(locs).map((l) => ({ value: l.id, label: `${l.icon ?? ""} ${pathLabel(locs, l.id)}` })), { value: NONE, label: "Sans emplacement" }];

  return (
    <>
      <PageHeader back="/stock" title="Inventaire" subtitle="Comptez, corrigez, c'est enregistré" />
      <div className="space-y-4 px-4 pb-28">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
          {options.map((o) => (
            <button key={o.value} className={`chip ${where === o.value ? "chip-on" : ""}`} onClick={() => setWhere(o.value)}>
              {o.label}
            </button>
          ))}
        </div>

        {products.isPending ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon="📦" title="Rien à compter ici" />
        ) : (
          <ul className="card divide-y divide-line">
            {rows.map((r, i) => {
              const counted = counts[r.key] ?? null;
              const delta = counted != null && r.recorded != null ? counted - r.recorded : null;
              const showLoc = where === "all" && (i === 0 || rows[i - 1].locationId !== r.locationId);
              return (
                <li key={r.key}>
                  {showLoc && <p className="bg-surface-2/60 px-4 py-1.5 text-xs font-bold tracking-wide text-ink-2 uppercase">{r.locationId ? pathLabel(locs, r.locationId) : "Sans emplacement"}</p>}
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <Link to={`/produits/${r.productId}`} className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.name}</span>
                      <span className="text-xs text-ink-3">
                        Enregistré : {r.recorded != null ? formatQty(r.recorded, r.unit) : "inconnu"}
                        {delta != null && delta !== 0 && (
                          <b className={delta < 0 ? "text-low" : "text-ok"}>
                            {" "}
                            ({delta > 0 ? "+" : ""}
                            {formatQty(delta)})
                          </b>
                        )}
                        {delta === 0 && <b className="text-ok"> ✓</b>}
                      </span>
                    </Link>
                    <NumberInput
                      className="input w-24 py-2 text-right font-bold"
                      value={counted}
                      onChange={(v) => setCounts((c) => ({ ...c, [r.key]: v }))}
                      placeholder="Compté"
                    />
                    <span className="w-8 text-sm text-ink-3">{r.unit ?? ""}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(history.data?.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-bold">Dernières corrections</h2>
            <ul className="card divide-y divide-line text-sm">
              {history.data!.slice(0, 20).map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link to={`/produits/${h.product.id}`} className="font-medium">
                      {h.product.name}
                    </Link>
                    <span className="block text-xs text-ink-3">
                      {formatDateTime(h.createdAt)}
                      {h.stockItem?.locationId ? ` · ${pathLabel(locs, h.stockItem.locationId)}` : ""}
                    </span>
                  </span>
                  {h.delta != null && (
                    <span className={`font-semibold tabular-nums ${h.delta < 0 ? "text-low" : "text-ok"}`}>
                      {h.delta > 0 ? "+" : ""}
                      {formatQty(h.delta)}
                    </span>
                  )}
                  <span className="w-14 text-right text-ink-2 tabular-nums">→ {formatQty(h.quantityAfter, h.product.unit)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {filled.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-30 px-4">
          <div className="mx-auto max-w-3xl">
            <button className="btn-primary w-full shadow-xl" onClick={submit} disabled={save.isPending}>
              {save.isPending ? (
                <Spinner className="text-brand-ink" />
              ) : (
                <>
                  <ClipboardCheck className="size-4" /> Valider {filled.length} comptage{filled.length > 1 ? "s" : ""}
                  {diffs > 0 && ` · ${diffs} écart${diffs > 1 ? "s" : ""}`}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
