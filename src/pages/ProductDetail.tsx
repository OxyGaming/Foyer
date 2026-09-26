import { ClipboardCheck, MapPin, Minus, MoveRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PurchaseSection } from "@/components/PurchaseSection";
import { NumberInput, PageHeader, PageLoader, Sheet, StatusBadge, Thumb, useConfirm } from "@/components/ui";
import { formatDateTime, formatQty } from "@/lib/format";
import { useAdjustStock, useCategories, useDeleteProduct, useDeleteStockLine, useLocations, useProduct, useSetStock } from "@/lib/queries";
import { flattenTree, pathLabel } from "@/lib/tree";
import type { Location, Movement, ProductDetail, StockLine } from "@/lib/types";

const MOVE_LABEL: Record<Movement["type"], string> = {
  adjust: "Ajustement",
  inventory: "Inventaire",
  purchase: "Achat",
  consume: "Consommation",
  move: "Déplacement",
};

function LocationSelect({ locations, value, onChange, exclude }: { locations: Location[]; value: string; onChange: (v: string) => void; exclude?: (string | null)[] }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Emplacement">
      <option value="">Sans emplacement</option>
      {flattenTree(locations).map((l) => (
        <option key={l.id} value={l.id} disabled={exclude?.includes(l.id)}>
          {"  ".repeat(l.depth)}
          {l.icon} {l.name}
        </option>
      ))}
    </select>
  );
}

type Dialog = { kind: "count"; line: StockLine } | { kind: "move"; line: StockLine } | { kind: "add" } | null;

export function ProductDetailPage() {
  const { id = "" } = useParams();
  const product = useProduct(id);
  const locations = useLocations();
  const categories = useCategories();
  const adjust = useAdjustStock();
  const setStock = useSetStock();
  const delLine = useDeleteStockLine();
  const delProduct = useDeleteProduct();
  const navigate = useNavigate();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [loc, setLoc] = useState("");

  if (product.isPending) return <PageLoader />;
  if (!product.data) {
    return (
      <>
        <PageHeader back="/stock" title="Produit" />
        <p className="p-8 text-center text-ink-2">Produit introuvable.</p>
      </>
    );
  }
  const p: ProductDetail = product.data;
  const locs = locations.data ?? [];
  const cats = categories.data ?? [];
  const cat = cats.find((c) => c.id === p.categoryId);

  const open = (d: Dialog) => {
    setDialog(d);
    if (d?.kind === "count") setQty(d.line.quantity);
    if (d?.kind === "add") {
      setQty(null);
      setLoc(p.stock.some((s) => s.locationId === p.defaultLocationId) ? "" : (p.defaultLocationId ?? ""));
    }
    if (d?.kind === "move") setLoc("");
  };

  async function onDelete() {
    const ok = await ask(`Supprimer « ${p.name || "ce produit"} » ?`, {
      message: "Le produit, son stock et son historique seront supprimés. Les recettes gardent l'ingrédient (sans lien au stock).",
    });
    if (!ok) return;
    await delProduct.mutateAsync(p.id);
    toast.success("Produit supprimé");
    navigate("/stock", { replace: true });
  }

  return (
    <>
      <PageHeader
        back
        title={p.name || "Produit sans nom"}
        subtitle={[cat ? pathLabel(cats, cat.id) : null, p.brand].filter(Boolean).join(" · ") || undefined}
        actions={
          <Link to={`/produits/${p.id}/modifier`} className="icon-btn" aria-label="Modifier">
            <Pencil className="size-5" />
          </Link>
        }
      />
      <div className="space-y-5 px-4 pb-6">
        <div className="flex items-center gap-4">
          <Thumb photoId={p.photoId} variant="full" fallback={<span className="text-4xl">{cat?.icon ?? "📦"}</span>} className="size-28 shrink-0 rounded-2xl" />
          <div className="min-w-0">
            <p className="text-sm text-ink-2">En stock</p>
            <p className="text-3xl font-bold tabular-nums">{p.quantity != null ? formatQty(p.quantity, p.unit) : "—"}</p>
            <div className="mt-1">
              <StatusBadge status={p.status} />
            </div>
            {p.toBuy != null && <p className="mt-1 text-sm font-semibold">À acheter : {formatQty(p.toBuy, p.unit)}</p>}
          </div>
        </div>

        {(p.minStock != null || p.targetStock != null) && (
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-3">
              <p className="text-xs text-ink-2">Minimum</p>
              <p className="font-bold">{p.minStock != null ? formatQty(p.minStock, p.unit) : "—"}</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-ink-2">Stock cible</p>
              <p className="font-bold">{p.targetStock != null ? formatQty(p.targetStock, p.unit) : "—"}</p>
            </div>
          </div>
        )}

        {/* Lignes de stock par emplacement */}
        <section>
          <h2 className="mb-2 text-lg font-bold">Où est-il rangé ?</h2>
          <div className="card divide-y divide-line">
            {p.stock.length === 0 && <p className="p-4 text-sm text-ink-2">Pas encore de stock enregistré.</p>}
            {p.stock.map((line) => (
              <div key={line.id} className="p-3">
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate font-medium">{line.locationId ? pathLabel(locs, line.locationId) : "Sans emplacement"}</span>
                  <button className="flex size-10 items-center justify-center rounded-full bg-surface-2 active:scale-90 disabled:opacity-30" disabled={!line.quantity} onClick={() => adjust.mutate({ productId: p.id, itemId: line.id, delta: -1 })} aria-label="Moins un">
                    <Minus className="size-4" />
                  </button>
                  <span className="min-w-12 text-center text-lg font-bold tabular-nums">{line.quantity != null ? formatQty(line.quantity) : "?"}</span>
                  <button className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand active:scale-90" onClick={() => adjust.mutate({ productId: p.id, itemId: line.id, delta: 1 })} aria-label="Plus un">
                    <Plus className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex gap-1 pl-6">
                  <button className="btn-ghost min-h-8 px-2 text-xs" onClick={() => open({ kind: "count", line })}>
                    <ClipboardCheck className="size-3.5" /> Compter
                  </button>
                  <button className="btn-ghost min-h-8 px-2 text-xs" onClick={() => open({ kind: "move", line })}>
                    <MoveRight className="size-3.5" /> Déplacer
                  </button>
                  <button
                    className="btn-ghost min-h-8 px-2 text-xs text-danger"
                    onClick={async () => {
                      if (await ask("Retirer cette ligne de stock ?", { confirm: "Retirer" })) delLine.mutate({ productId: p.id, itemId: line.id });
                    }}
                  >
                    <Trash2 className="size-3.5" /> Retirer
                  </button>
                </div>
              </div>
            ))}
            <button className="flex w-full items-center justify-center gap-2 p-3 text-sm font-semibold text-brand" onClick={() => open({ kind: "add" })}>
              <Plus className="size-4" /> {p.stock.length ? "Ajouter un autre emplacement" : "Enregistrer une quantité"}
            </button>
          </div>
        </section>

        {(p.reference || p.notes) && (
          <section className="card space-y-2 p-4 text-sm">
            {p.reference && (
              <p>
                <span className="text-ink-2">Référence : </span>
                {p.reference}
              </p>
            )}
            {p.notes && <p className="whitespace-pre-line text-ink-2">{p.notes}</p>}
          </section>
        )}

        <PurchaseSection product={p} />

        {p.recipes.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-bold">Utilisé dans</h2>
            <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
              {p.recipes.map((r) => (
                <Link key={r.id} to={`/recettes/${r.id}`} className="w-32 shrink-0">
                  <Thumb photoId={r.photoId} fallback="🍽️" className="aspect-square w-full rounded-xl" />
                  <p className="mt-1 line-clamp-2 text-sm font-medium">{r.name || "Sans nom"}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {p.movements.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-bold">Historique</h2>
            <ul className="card divide-y divide-line text-sm">
              {p.movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1">
                    <span className="font-medium">{MOVE_LABEL[m.type] ?? m.type}</span>
                    {m.note && <span className="text-ink-3"> · {m.note}</span>}
                    <span className="block text-xs text-ink-3">{formatDateTime(m.createdAt)}</span>
                  </span>
                  {m.delta != null && m.type !== "move" && (
                    <span className={`font-semibold tabular-nums ${m.delta < 0 ? "text-low" : "text-ok"}`}>
                      {m.delta > 0 ? "+" : ""}
                      {formatQty(m.delta)}
                    </span>
                  )}
                  {m.quantityAfter != null && <span className="w-12 text-right text-ink-2 tabular-nums">→ {formatQty(m.quantityAfter)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <button className="btn-danger w-full" onClick={onDelete}>
          <Trash2 className="size-4" /> Supprimer le produit
        </button>
      </div>

      {/* Inventaire : saisie du comptage réel */}
      <Sheet open={dialog?.kind === "count"} onClose={() => setDialog(null)} title="Inventaire">
        {dialog?.kind === "count" && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await setStock.mutateAsync({ productId: p.id, itemId: dialog.line.id, quantity: qty, inventory: true });
              toast.success("Comptage enregistré");
              setDialog(null);
            }}
          >
            <p className="text-sm text-ink-2">
              Enregistré : <b>{dialog.line.quantity != null ? formatQty(dialog.line.quantity, p.unit) : "inconnu"}</b>. Combien en comptez-vous réellement ?
            </p>
            <NumberInput value={qty} onChange={setQty} placeholder="Quantité comptée" className="input text-center text-2xl font-bold" />
            <button className="btn-primary w-full" disabled={setStock.isPending}>
              Corriger le stock
            </button>
          </form>
        )}
      </Sheet>

      <Sheet open={dialog?.kind === "move"} onClose={() => setDialog(null)} title="Déplacer vers…">
        {dialog?.kind === "move" && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await setStock.mutateAsync({ productId: p.id, itemId: dialog.line.id, locationId: loc || null });
              toast.success("Déplacé");
              setDialog(null);
            }}
          >
            <LocationSelect locations={locs} value={loc} onChange={setLoc} exclude={[dialog.line.locationId]} />
            <p className="text-xs text-ink-3">S'il y a déjà du stock à cet endroit, les quantités sont additionnées.</p>
            <button className="btn-primary w-full" disabled={setStock.isPending || (loc || null) === dialog.line.locationId}>
              Déplacer
            </button>
          </form>
        )}
      </Sheet>

      <Sheet open={dialog?.kind === "add"} onClose={() => setDialog(null)} title="Enregistrer une quantité">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await setStock.mutateAsync({ productId: p.id, locationId: loc || null, quantity: qty });
            setDialog(null);
          }}
        >
          <LocationSelect locations={locs} value={loc} onChange={setLoc} />
          <NumberInput value={qty} onChange={setQty} placeholder={`Quantité${p.unit ? ` (${p.unit})` : ""} — facultatif`} />
          <button className="btn-primary w-full" disabled={setStock.isPending}>
            Enregistrer
          </button>
        </form>
      </Sheet>
      {confirmDialog}
    </>
  );
}
