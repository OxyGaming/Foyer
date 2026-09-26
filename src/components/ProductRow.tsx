import { Minus, Plus } from "lucide-react";
import { Link } from "react-router";
import { formatQty } from "@/lib/format";
import { useAdjustStock, useSetStock } from "@/lib/queries";
import { pathLabel } from "@/lib/tree";
import type { Category, Location, Product } from "@/lib/types";
import { StatusBadge, Thumb } from "./ui";

export function ProductRow({ p, locations, categories, showToBuy }: { p: Product; locations: Location[]; categories: Category[]; showToBuy?: boolean }) {
  const adjust = useAdjustStock();
  const setStock = useSetStock();
  const cat = categories.find((c) => c.id === p.categoryId);
  const single = p.stock.length === 1 ? p.stock[0] : null;
  const where = p.stock.length > 1 ? `${p.stock.length} emplacements` : single?.locationId ? pathLabel(locations, single.locationId) : null;

  const minus = () => single && adjust.mutate({ productId: p.id, itemId: single.id, delta: -1 });
  const plus = () =>
    single
      ? adjust.mutate({ productId: p.id, itemId: single.id, delta: 1 })
      : p.stock.length === 0 && setStock.mutate({ productId: p.id, locationId: p.defaultLocationId, quantity: 1 });

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Link to={`/produits/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Thumb photoId={p.photoId} fallback={<span className="text-xl">{cat?.icon ?? "📦"}</span>} className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.name || "Produit sans nom"}</p>
          <p className="flex items-center gap-2 truncate text-xs text-ink-2">
            <StatusBadge status={p.status} />
            {showToBuy && p.toBuy != null ? <span className="font-semibold text-ink">Acheter {formatQty(p.toBuy, p.unit)}</span> : where && <span className="truncate">{where}</span>}
            {!where && p.status === "none" && p.brand && <span className="truncate">{p.brand}</span>}
          </p>
        </div>
      </Link>
      {p.stock.length > 1 ? (
        <Link to={`/produits/${p.id}`} className="min-w-12 text-right font-bold tabular-nums">
          {formatQty(p.quantity, p.unit) || "—"}
        </Link>
      ) : (
        <div className="flex items-center gap-1">
          {single && (
            <button className="flex size-9 items-center justify-center rounded-full bg-surface-2 active:scale-90 disabled:opacity-30" onClick={minus} disabled={!single.quantity} aria-label={`Retirer un ${p.name}`}>
              <Minus className="size-4" />
            </button>
          )}
          <span className="min-w-10 text-center font-bold tabular-nums">
            {single?.quantity != null ? formatQty(single.quantity) : "—"}
            {single?.quantity != null && p.unit && <span className="block text-[10px] leading-none font-medium text-ink-3">{p.unit}</span>}
          </span>
          <button className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-brand active:scale-90" onClick={plus} aria-label={`Ajouter un ${p.name}`}>
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
