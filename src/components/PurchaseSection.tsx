import { Plus, Tag } from "lucide-react";
import { type FormEvent, useState } from "react";
import { todayIso } from "../../shared/dates";
import { stockValueCents, unitPriceCents } from "../../shared/prices";
import { formatCents, formatDate, formatQty, formatUnitPrice, parseEuros, scaleUnitPrice } from "@/lib/format";
import { type PurchaseInput, useAddPurchase, useDeletePurchase, useStores, useUpdatePurchase } from "@/lib/purchaseQueries";
import { useLocations } from "@/lib/queries";
import { flattenTree } from "@/lib/tree";
import type { ProductDetail, Purchase } from "@/lib/types";
import { PriceChart } from "./charts";
import { NumberInput, Sheet, Spinner, useConfirm } from "./ui";

const euroText = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2).replace(".", ","));

function PurchaseForm({ product, purchase, onDone }: { product: ProductDetail; purchase?: Purchase; onDone: () => void }) {
  const stores = useStores();
  const locations = useLocations();
  const add = useAddPurchase();
  const update = useUpdatePurchase();
  const del = useDeletePurchase();
  const { ask, dialog } = useConfirm();
  const [date, setDate] = useState(purchase ? purchase.date.slice(0, 10) : todayIso());
  const [qty, setQty] = useState<number | null>(purchase?.quantity ?? null);
  // Prix saisi au total ou à l'unité : c'est le plus naturel selon le ticket.
  const [mode, setMode] = useState<"total" | "unit">("total");
  const [price, setPrice] = useState(euroText(purchase?.totalCents ?? null));
  const [store, setStore] = useState(purchase?.store?.name ?? "");
  const [promo, setPromo] = useState(purchase?.isPromo ?? false);
  const [note, setNote] = useState(purchase?.note ?? "");
  const [addToStock, setAddToStock] = useState(true);
  // Emplacement habituel, sinon l'unique endroit où le produit est déjà rangé.
  const [locationId, setLocationId] = useState(product.defaultLocationId ?? (product.stock.length === 1 ? product.stock[0].locationId : null) ?? "");
  const unit = purchase?.unit ?? product.unit;
  const priceScale = scaleUnitPrice(1, unit); // saisie « par kg » pour un produit en g

  const cents = parseEuros(price);
  const totalCents = cents == null ? null : mode === "total" ? cents : qty != null ? Math.round((cents * qty) / priceScale.cents) : null;
  const unitCents = totalCents != null && qty ? totalCents / qty : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const data: PurchaseInput = { date, quantity: qty, totalCents, storeName: store || null, isPromo: promo, note: note || null };
    if (purchase) update.mutate({ id: purchase.id, productId: product.id, data }, { onSuccess: onDone });
    else add.mutate({ ...data, productId: product.id, addToStock, locationId: locationId || null }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
        </div>
        <div>
          <label className="label">Quantité{unit ? ` (${unit})` : ""}</label>
          <NumberInput value={qty} onChange={setQty} placeholder="—" />
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label mb-0">Prix</span>
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
            {(["total", "unit"] as const).map((m) => (
              <button type="button" key={m} className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-surface shadow-sm" : "text-ink-2"}`} onClick={() => setMode(m)}>
                {m === "total" ? "Total" : `Par ${priceScale.unit}`}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <input className="input pr-8" inputMode="decimal" placeholder="Facultatif" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.,]/g, ""))} />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3">€</span>
        </div>
        {unitCents != null && mode === "total" && <p className="mt-1 text-xs text-ink-2">soit {formatUnitPrice(unitCents, unit)}</p>}
        {totalCents != null && mode === "unit" && <p className="mt-1 text-xs text-ink-2">soit {formatCents(totalCents)} au total</p>}
        {mode === "unit" && cents != null && qty == null && <p className="mt-1 text-xs text-watch">Indiquez la quantité pour calculer le total.</p>}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div>
          <label className="label">Magasin</label>
          <input className="input" list="stores" placeholder="Facultatif" value={store} onChange={(e) => setStore(e.target.value)} />
          <datalist id="stores">{(stores.data ?? []).map((s) => <option key={s.id} value={s.name} />)}</datalist>
        </div>
        <button type="button" className={`chip h-12 ${promo ? "chip-on" : ""}`} aria-pressed={promo} onClick={() => setPromo(!promo)}>
          <Tag className="size-4" /> Promo
        </button>
      </div>
      <input className="input" placeholder="Commentaire" value={note} onChange={(e) => setNote(e.target.value)} />
      {!purchase && (
        <div className="card space-y-2 p-3">
          <label className="flex items-center gap-3">
            <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={addToStock} onChange={(e) => setAddToStock(e.target.checked)} />
            <span className="font-medium">Ajouter au stock</span>
          </label>
          {addToStock && (
            <select className="input py-2.5" value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Emplacement">
              <option value="">Sans emplacement</option>
              {flattenTree(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {"  ".repeat(l.depth)}
                  {l.icon} {l.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {purchase && <p className="text-xs text-ink-3">Corriger un achat ne modifie pas le stock (utilisez « Compter » pour cela).</p>}
      <div className="flex gap-2">
        {purchase && (
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              if (await ask("Supprimer cet achat ?", { message: "Il disparaît de l'historique des prix. Le stock n'est pas modifié." })) del.mutate({ id: purchase.id, productId: product.id }, { onSuccess: onDone });
            }}
          >
            Supprimer
          </button>
        )}
        <button className="btn-primary flex-1" disabled={add.isPending || update.isPending}>
          {add.isPending || update.isPending ? <Spinner className="text-brand-ink" /> : "Enregistrer"}
        </button>
      </div>
      {dialog}
    </form>
  );
}

export function PurchaseSection({ product }: { product: ProductDetail }) {
  const [editing, setEditing] = useState<Purchase | "new" | null>(null);
  const p = product.pricing;
  const unit = product.unit;
  const scale = scaleUnitPrice(1, unit); // 1 c/g → 10 €/kg…
  const f = scale.cents;
  const value = stockValueCents(product.quantity, p?.avgCents);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold">Prix & achats</h2>
        <button className="btn-ghost min-h-9 px-2 text-sm text-brand" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Achat
        </button>
      </div>

      {p ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="card p-3">
              <p className="text-xs text-ink-2">Prix moyen</p>
              <p className="text-lg leading-tight font-bold">{formatCents(p.avgCents * f)}</p>
              <p className="text-[11px] text-ink-3">par {scale.unit}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-ink-2">Dernier</p>
              <p className="text-lg leading-tight font-bold">{formatCents(p.last.unitCents * f)}</p>
              <p className="truncate text-[11px] text-ink-3">
                {formatDate(p.last.date)}
                {p.last.isPromo ? " · promo" : ""}
              </p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-ink-2">Meilleur</p>
              <p className="text-lg leading-tight font-bold">{formatCents(p.best.unitCents * f)}</p>
              <p className="truncate text-[11px] text-ink-3">{p.best.store ?? formatDate(p.best.date)}</p>
            </div>
          </div>
          {value != null && (
            <p className="text-sm text-ink-2">
              Valeur du stock : <b className="text-ink">{formatCents(value)}</b> ({formatQty(product.quantity, unit)} au prix moyen)
            </p>
          )}
          {p.history && p.history.length >= 2 && (
            <div className="card p-3">
              <p className="mb-1 text-sm font-semibold">Prix par {scale.unit}</p>
              <PriceChart points={p.history.map((h) => ({ ...h, unitCents: h.unitCents * f }))} avgCents={p.avgCents * f} unitLabel={scale.unit} />
            </div>
          )}
        </div>
      ) : (
        <p className="card p-4 text-sm text-ink-2">{product.purchases.length ? "Aucun prix renseigné sur les achats : le prix moyen apparaîtra dès qu'un prix sera saisi." : "Aucun achat enregistré."}</p>
      )}

      {product.purchases.length > 0 && (
        <ul className="card mt-3 divide-y divide-line text-sm">
          {product.purchases.map((x) => {
            const u = unitPriceCents(x);
            return (
              <li key={x.id}>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left" onClick={() => setEditing(x)}>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{formatDate(x.date)}</span>
                    {x.isPromo && <span className="ml-2 rounded-full bg-watch-soft px-1.5 py-0.5 text-[10px] font-bold text-watch">PROMO</span>}
                    <span className="block truncate text-xs text-ink-3">
                      {[x.quantity != null ? formatQty(x.quantity, x.unit) : null, x.store?.name, x.note].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{x.totalCents != null ? formatCents(x.totalCents) : "—"}</span>
                    {u != null && <span className="text-xs text-ink-3 tabular-nums">{formatUnitPrice(u, x.unit)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? `Achat · ${product.name || "produit"}` : "Modifier l'achat"}>
        {editing !== null && <PurchaseForm key={editing === "new" ? "new" : editing.id} product={product} purchase={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </section>
  );
}
