import { useIsMutating } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, PackageCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDayMonth, todayIso, weekStart } from "../../shared/dates";
import { compatibleUnits, convertQty } from "../../shared/units";
import { useOnline } from "@/components/Layout";
import { EmptyState, NumberInput, PageHeader, PageLoader, Sheet, Spinner, Thumb, useConfirm } from "@/components/ui";
import { formatQty, parseNum } from "@/lib/format";
import { parseIngredientLine } from "@/lib/ingredients";
import { clientId } from "@/lib/planQueries";
import { useStores } from "@/lib/purchaseQueries";
import { useCategories, useLocations, useProducts } from "@/lib/queries";
import {
  isCovered,
  itemQty,
  type StockInEntry,
  useAddItem,
  useClearChecked,
  useDeleteItem,
  usePatchItem,
  useRestock,
  useShopping,
  useStockIn,
  useSyncShopping,
} from "@/lib/shoppingQueries";
import { flattenTree } from "@/lib/tree";
import type { Category, Product, ShoppingItem } from "@/lib/types";

type Range = { from: string; to: string };

function presets(today: string): { key: string; label: string; range: Range }[] {
  const monday = weekStart(today);
  return [
    { key: "7d", label: "7 prochains jours", range: { from: today, to: addDays(today, 6) } },
    { key: "week", label: "Fin de semaine", range: { from: today, to: addDays(monday, 6) } },
    { key: "next", label: "Semaine prochaine", range: { from: addDays(monday, 7), to: addDays(monday, 13) } },
    { key: "14d", label: "14 jours", range: { from: today, to: addDays(today, 13) } },
  ];
}

/** Période du planning utilisée : celle enregistrée si encore d'actualité, sinon les 7 prochains jours. */
function currentRange(stored: { planFrom: string | null; planTo: string | null } | undefined, today: string): Range {
  if (stored?.planFrom && stored.planTo && stored.planTo >= today) {
    return { from: stored.planFrom < today ? today : stored.planFrom, to: stored.planTo };
  }
  return { from: today, to: addDays(today, 6) };
}

function rootCategory(cats: Category[], id: string | null | undefined) {
  let c = cats.find((x) => x.id === id);
  for (let g = 0; c?.parentId && g < 10; g++) c = cats.find((x) => x.id === c!.parentId) ?? c;
  return c;
}

function ItemRow({ item, product, onEdit }: { item: ShoppingItem; product?: Product; onEdit: () => void }) {
  const patch = usePatchItem();
  const qty = itemQty(item);
  const covered = isCovered(item);
  const sub = [
    item.recipesLabel && `pour ${item.recipesLabel}`,
    item.source === "restock" && "sous le seuil minimum",
    item.stockQty != null && item.stockQty > 0 && !item.checked && `en stock : ${formatQty(item.stockQty, item.unit)}`,
    item.quantityOverride != null && "quantité ajustée",
    item.note,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-1 pr-2">
      <button
        className="flex size-14 shrink-0 items-center justify-center"
        onClick={() => patch.mutate({ id: item.id, patch: { checked: !item.checked } })}
        role="checkbox"
        aria-checked={item.checked}
        aria-label={`${item.checked ? "Décocher" : "Cocher"} ${item.name}`}
      >
        <span className={`flex size-7 items-center justify-center rounded-full border-2 transition ${item.checked ? "border-ok bg-ok text-white" : covered ? "border-ok/50 text-ok" : "border-ink-3"}`}>
          {(item.checked || covered) && <Check className="size-4" strokeWidth={3} />}
        </span>
      </button>
      <button className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left" onClick={onEdit}>
        {product?.photoId && <Thumb photoId={product.photoId} fallback="" className="size-9 shrink-0 rounded-lg" />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${item.checked ? "text-ink-3 line-through" : ""}`}>{item.name || "Article"}</span>
          {sub.length > 0 && <span className="block truncate text-xs text-ink-3">{sub.join(" · ")}</span>}
        </span>
        {covered ? (
          <span className="text-xs font-semibold text-ok">Stock suffisant ✓</span>
        ) : (
          (qty != null || item.unit) && <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-sm font-bold tabular-nums">{formatQty(qty, item.unit)}</span>
        )}
      </button>
    </div>
  );
}

function EditItemSheet({ item, onClose }: { item: ShoppingItem | null; onClose: () => void }) {
  return (
    <Sheet open={!!item} onClose={onClose} title={item?.name || "Article"}>
      {item && <EditItemForm key={item.id} item={item} onClose={onClose} />}
    </Sheet>
  );
}

function EditItemForm({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const patch = usePatchItem();
  const del = useDeleteItem();
  const [qty, setQty] = useState<number | null>(itemQty(item));
  const [note, setNote] = useState(item.note ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");
  const save = (e: FormEvent) => {
    e.preventDefault();
    const p: Record<string, unknown> = {};
    if (qty !== itemQty(item)) p.quantity = qty;
    if ((note || null) !== item.note) p.note = note || null;
    if (item.source !== "plan" && (unit || null) !== item.unit) p.unit = unit || null;
    if (Object.keys(p).length) patch.mutate({ id: item.id, patch: p });
    onClose();
  };
  return (
    <form onSubmit={save} className="space-y-4">
      {item.source === "plan" && (
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-xl bg-surface-2 p-2">
            <p className="text-xs text-ink-2">Planning</p>
            <p className="font-bold">{item.neededQty != null ? formatQty(item.neededQty, item.unit) : "—"}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-2">
            <p className="text-xs text-ink-2">En stock</p>
            <p className="font-bold">{item.stockQty != null ? formatQty(item.stockQty, item.unit) : "?"}</p>
          </div>
          <div className="rounded-xl bg-brand-soft p-2 text-brand">
            <p className="text-xs">Calculé</p>
            <p className="font-bold">{item.quantity != null ? formatQty(item.quantity, item.unit) : "—"}</p>
          </div>
        </div>
      )}
      {item.recipesLabel && <p className="text-sm text-ink-2">Pour : {item.recipesLabel}</p>}
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div>
          <label className="label">Quantité à acheter</label>
          <NumberInput value={qty} onChange={setQty} placeholder="—" className="input text-lg font-bold" />
        </div>
        <div>
          <label className="label">Unité</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={item.source === "plan"} placeholder="—" />
        </div>
      </div>
      <div>
        <label className="label">Note</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Marque, format…" />
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-danger" onClick={() => { del.mutate(item.id); onClose(); }} aria-label="Retirer de la liste">
          <Trash2 className="size-4" />
        </button>
        {item.source === "plan" && item.quantityOverride != null && (
          <button type="button" className="btn-soft" onClick={() => { patch.mutate({ id: item.id, patch: { resetQuantity: true } }); onClose(); }}>
            Revenir au calcul
          </button>
        )}
        <button className="btn-primary flex-1">Enregistrer</button>
      </div>
    </form>
  );
}

/** Retour de courses : chaque article coché peut être rangé (quantité, emplacement, prix facultatifs). */
function StockInSheet({ open, items, products, onClose }: { open: boolean; items: ShoppingItem[]; products: Map<string, Product>; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Ranger les achats">
      {open && <StockInForm items={items} products={products} onDone={onClose} />}
    </Sheet>
  );
}

type StockRow = { on: boolean; qty: number | null; locationId: string; price: string };

function StockInForm({ items, products, onDone }: { items: ShoppingItem[]; products: Map<string, Product>; onDone: () => void }) {
  const locations = useLocations();
  const stockIn = useStockIn();
  const stores = useStores();
  const [store, setStore] = useState("");
  // Initialisé une seule fois à l'ouverture (les saisies ne sont pas écrasées).
  const [rows, setRows] = useState<Record<string, StockRow>>(() => {
    const init: Record<string, StockRow> = {};
    for (const i of items) {
      const p = i.productId ? products.get(i.productId) : undefined;
      const q = itemQty(i);
      // Quantité convertie dans l'unité du stock quand c'est possible (500 ml → 0,5 L).
      const qty = q != null && p?.unit && compatibleUnits(i.unit, p.unit) ? convertQty(q, i.unit, p.unit) : q;
      init[i.id] = { on: true, qty: qty ? Math.round(qty * 1000) / 1000 : null, locationId: p?.defaultLocationId ?? "", price: "" };
    }
    return init;
  });

  const locs = flattenTree(locations.data ?? []);
  const selected = items.filter((i) => rows[i.id]?.on).length;

  function submit() {
    const entries: StockInEntry[] = items.map((i) => {
      const r = rows[i.id];
      const price = r ? parseNum(r.price) : null;
      return { itemId: i.id, addToStock: !!r?.on, quantity: r?.qty ?? null, locationId: r?.locationId || null, totalCents: price != null ? Math.round(price * 100) : null };
    });
    stockIn.mutate({ entries, storeName: store.trim() || null }, { onSuccess: onDone });
  }

  return (
    <>
      <p className="mb-3 text-sm text-ink-2">Les articles cochés sont ajoutés au stock et l'achat est enregistré. Magasin, prix et emplacement sont facultatifs.</p>
      <input className="input mb-3" list="stock-in-stores" placeholder="Magasin (facultatif)" value={store} onChange={(e) => setStore(e.target.value)} />
      <datalist id="stock-in-stores">{(stores.data ?? []).map((s) => <option key={s.id} value={s.name} />)}</datalist>
      <ul className="space-y-2">
        {items.map((i) => {
          const r = rows[i.id];
          if (!r) return null;
          const p = i.productId ? products.get(i.productId) : undefined;
          const set = (patch: Partial<StockRow>) => setRows((all) => ({ ...all, [i.id]: { ...r, ...patch } }));
          return (
            <li key={i.id} className={`card p-3 ${r.on ? "" : "opacity-60"}`}>
              <label className="flex items-center gap-3">
                <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={r.on} onChange={(e) => set({ on: e.target.checked })} />
                <span className="flex-1 font-semibold">{i.name}</span>
                {!p && <span className="text-xs text-ink-3">nouveau produit</span>}
              </label>
              {r.on && (
                <div className="mt-2 grid grid-cols-[5.5rem_1fr_5.5rem] gap-2">
                  <div className="relative">
                    <NumberInput value={r.qty} onChange={(v) => set({ qty: v })} placeholder="Qté" className="input px-2.5 py-2 pr-8" />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-ink-3">{p?.unit ?? i.unit ?? ""}</span>
                  </div>
                  <select className="input px-2 py-2 text-sm" value={r.locationId} onChange={(e) => set({ locationId: e.target.value })} aria-label="Emplacement">
                    <option value="">Sans emplacement</option>
                    {locs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {" ".repeat(l.depth * 2)}
                        {l.icon} {l.name}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <input className="input px-2.5 py-2 pr-6" inputMode="decimal" placeholder="Prix" value={r.price} onChange={(e) => set({ price: e.target.value.replace(/[^0-9.,]/g, "") })} aria-label="Prix total" />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-ink-3">€</span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Les articles décochés ici sont simplement retirés de la liste.</p>
      <button className="btn-primary mt-3 w-full" disabled={stockIn.isPending} onClick={submit}>
        {stockIn.isPending ? <Spinner className="text-brand-ink" /> : <><PackageCheck className="size-4" /> Ranger {selected} article{selected > 1 ? "s" : ""}</>}
      </button>
    </>
  );
}

export function ShoppingPage() {
  const online = useOnline();
  const shopping = useShopping({ poll: online });
  const products = useProducts();
  const categories = useCategories();
  const add = useAddItem();
  const sync = useSyncShopping();
  const restock = useRestock();
  const clear = useClearChecked();
  const pendingOffline = useIsMutating({ mutationKey: ["shopping"] });
  const { ask, dialog } = useConfirm();
  const today = todayIso();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [showCovered, setShowCovered] = useState(false);
  const [stocking, setStocking] = useState(false);
  const range = currentRange(shopping.data?.list, today);

  // Régénère depuis le planning à l'ouverture (en ligne, sans action en attente).
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !online || pendingOffline > 0 || shopping.isPending) return;
    synced.current = true;
    sync.mutate(range);
    // La période est lue au moment du déclenchement, volontairement hors dépendances.
  }, [online, pendingOffline, shopping.isPending]);

  const productMap = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const cats = useMemo(() => (categories.data ?? []).filter((c) => c.kind === "product"), [categories.data]);
  const items = shopping.data?.items ?? [];
  const onList = new Set(items.filter((i) => !i.checked && i.productId).map((i) => i.productId));
  const alerts = (products.data ?? []).filter((p) => p.toBuy != null && !onList.has(p.id)).length;
  const checked = items.filter((i) => i.checked);
  const covered = items.filter(isCovered);
  const toBuy = items.filter((i) => !i.checked && !isCovered(i));

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; icon: string; order: number; items: ShoppingItem[] }>();
    for (const i of toBuy) {
      const root = rootCategory(cats, i.productId ? productMap.get(i.productId)?.categoryId : null);
      const key = root?.id ?? "_none";
      if (!m.has(key)) m.set(key, { key, label: root?.name ?? "Autres", icon: root?.icon ?? "🛒", order: root ? cats.indexOf(root) : 1e9, items: [] });
      m.get(key)!.items.push(i);
    }
    return [...m.values()].sort((a, b) => a.order - b.order);
  }, [toBuy, cats, productMap]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseIngredientLine(text);
    if (!parsed) return;
    const match = (products.data ?? []).find((p) => p.name.localeCompare(parsed.name, "fr", { sensitivity: "base" }) === 0);
    add.mutate({ id: clientId(), name: match?.name ?? parsed.name, productId: match?.id ?? null, quantity: parsed.quantity, unit: parsed.unit ?? (match ? match.unit : null) });
    setText("");
  }

  const syncTo = (r: Range) => sync.mutate(r);
  const activePreset = presets(today).find((p) => p.range.from === range.from && p.range.to === range.to)?.key;

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={shopping.data ? `${toBuy.length} article${toBuy.length > 1 ? "s" : ""} à acheter` : undefined}
        actions={
          <button className="icon-btn" onClick={() => syncTo(range)} disabled={!online || sync.isPending} aria-label="Actualiser depuis le planning">
            <RefreshCw className={`size-5 ${sync.isPending ? "animate-spin" : ""}`} />
          </button>
        }
      />
      <div className="space-y-4 px-4">
        <form onSubmit={submit} className="flex gap-2">
          <input className="input flex-1" list="shopping-products" placeholder="Ajouter : lessive, 6 œufs, 2 L de lait…" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
          <datalist id="shopping-products">{(products.data ?? []).filter((p) => p.name).map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <button className="icon-btn size-12 bg-brand text-brand-ink active:bg-brand" disabled={!text.trim()} aria-label="Ajouter à la liste">
            <Plus className="size-5" />
          </button>
        </form>

        <div className="card p-3">
          <p className="mb-2 text-sm text-ink-2">
            Recettes du planning du <b className="text-ink">{formatDayMonth(range.from)}</b> au <b className="text-ink">{formatDayMonth(range.to)}</b>, stock déduit.
          </p>
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
            {presets(today).map((p) => (
              <button key={p.key} className={`chip min-h-8 text-xs ${activePreset === p.key ? "chip-on" : ""}`} onClick={() => syncTo(p.range)} disabled={!online || sync.isPending}>
                {p.label}
              </button>
            ))}
          </div>
          {!online && <p className="mt-2 text-xs text-ink-3">Hors connexion : la liste reste utilisable, elle sera recalculée au retour du réseau.</p>}
        </div>

        {alerts > 0 && online && (
          <button className="card flex w-full items-center gap-3 border-low/30 bg-low-soft p-3 text-left text-low" onClick={() => restock.mutate()} disabled={restock.isPending}>
            <AlertTriangle className="size-5 shrink-0" />
            <span className="flex-1 text-sm font-semibold">{alerts > 1 ? `Ajouter les ${alerts} produits sous le seuil minimum` : "Ajouter le produit sous le seuil minimum"}</span>
            {restock.isPending ? <Spinner /> : <Plus className="size-5" />}
          </button>
        )}

        {shopping.isPending ? (
          <PageLoader />
        ) : items.length === 0 ? (
          <EmptyState icon="🛒" title="Liste vide">
            <p>Planifiez des recettes ou ajoutez des articles ci-dessus.</p>
          </EmptyState>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key}>
                <h2 className="mb-1.5 flex items-center gap-2 px-1 text-sm font-bold tracking-wide text-ink-2 uppercase">
                  <span>{g.icon}</span> {g.label} <span className="font-medium text-ink-3">· {g.items.length}</span>
                </h2>
                <div className="card divide-y divide-line overflow-hidden">
                  {g.items.map((i) => (
                    <ItemRow key={i.id} item={i} product={i.productId ? productMap.get(i.productId) : undefined} onEdit={() => setEditing(i)} />
                  ))}
                </div>
              </section>
            ))}
            {toBuy.length === 0 && checked.length === 0 && <EmptyState icon="✅" title="Rien à acheter">Tout ce que demande le planning est déjà en stock.</EmptyState>}

            {covered.length > 0 && (
              <section>
                <button className="flex w-full items-center gap-2 px-1 py-1 text-sm font-bold tracking-wide text-ok uppercase" onClick={() => setShowCovered((v) => !v)} aria-expanded={showCovered}>
                  ✓ Déjà en stock · {covered.length}
                  <ChevronDown className={`ml-auto size-4 transition ${showCovered ? "rotate-180" : ""}`} />
                </button>
                {showCovered && (
                  <div className="card mt-1.5 divide-y divide-line overflow-hidden">
                    {covered.map((i) => (
                      <ItemRow key={i.id} item={i} product={i.productId ? productMap.get(i.productId) : undefined} onEdit={() => setEditing(i)} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {checked.length > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-bold tracking-wide text-ink-2 uppercase">Dans le panier · {checked.length}</h2>
                <div className="card divide-y divide-line overflow-hidden">
                  {checked.map((i) => (
                    <ItemRow key={i.id} item={i} product={i.productId ? productMap.get(i.productId) : undefined} onEdit={() => setEditing(i)} />
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <button className="btn-primary" onClick={() => setStocking(true)} disabled={!online}>
                    <PackageCheck className="size-4" /> Ranger dans le stock
                  </button>
                  <button
                    className="btn-soft"
                    disabled={!online || clear.isPending}
                    onClick={async () => (await ask("Vider le panier ?", { message: "Les articles cochés sont retirés de la liste sans être ajoutés au stock.", confirm: "Vider" })) && clear.mutate()}
                  >
                    Vider
                  </button>
                </div>
                {!online && <p className="mt-1.5 text-xs text-ink-3">Le rangement dans le stock sera possible au retour du réseau.</p>}
              </section>
            )}
          </>
        )}
      </div>
      <EditItemSheet item={editing} onClose={() => setEditing(null)} />
      <StockInSheet open={stocking} items={checked} products={productMap} onClose={() => setStocking(false)} />
      {dialog}
    </>
  );
}
