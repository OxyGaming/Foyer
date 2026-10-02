import { Check, FileText, Package, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ProductPickSheet } from "@/components/AlternativesSheet";
import { NumberInput, PageHeader, PageLoader, Spinner } from "@/components/ui";
import { formatCents, numToInput, parseEuros, STOCK_UNIT_SUGGESTIONS } from "@/lib/format";
import { pdfRows } from "@/lib/pdfText";
import { useImportReceipt, useReceiptLabels, useStores } from "@/lib/purchaseQueries";
import { useProducts } from "@/lib/queries";
import { matchProduct, parseReceipt, suggestName } from "@/lib/receiptParse";

type Line = {
  key: string;
  label: string;
  include: boolean;
  productId: string | null;
  /** Nom du produit à créer quand aucun produit n'est choisi. */
  newName: string;
  how: "learned" | "name" | null;
  quantity: number | null;
  unit: string;
  priceText: string;
  isPromo: boolean;
  addToStock: boolean;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Import d'une facture PDF de drive : le texte est lu dans l'appli (le fichier
 * n'est pas envoyé), chaque ligne est rapprochée d'un produit, puis relue avant
 * d'enregistrer achats et stock d'un coup.
 */
export function InvoiceImportPage() {
  const products = useProducts();
  const labels = useReceiptLabels();
  const stores = useStores();
  const save = useImportReceipt();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [store, setStore] = useState("");
  const [date, setDate] = useState(todayIso());
  const [invoiceTotal, setInvoiceTotal] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const update = (key: string, patch: Partial<Line>) => setLines((l) => l?.map((x) => (x.key === key ? { ...x, ...patch } : x)) ?? l);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    setFileName(file.name);
    try {
      const parsed = parseReceipt(await pdfRows(file));
      if (!parsed.lines.length) {
        setError("Aucun article trouvé dans ce PDF. Est-ce bien une facture de drive (et pas une image scannée) ?");
        setLines(null);
        return;
      }
      const learned = new Map((labels.data ?? []).map((l) => [l.label, l.productId]));
      setStore(parsed.store ? `${parsed.store} Drive` : "");
      if (parsed.date) setDate(parsed.date);
      setInvoiceTotal(parsed.totalCents);
      setLines(
        parsed.lines.map((l, i) => {
          const m = matchProduct(l.label, products.data ?? [], learned);
          return {
            key: `${i}-${l.label}`,
            label: l.label,
            include: true,
            productId: m.productId,
            newName: suggestName(l.label),
            how: m.how,
            quantity: l.quantity,
            unit: l.unit,
            priceText: l.totalCents != null ? numToInput(l.totalCents / 100) : "",
            isPromo: l.isPromo,
            addToStock: true,
          };
        }),
      );
    } catch {
      setError("Impossible de lire ce fichier. Choisissez une facture au format PDF.");
      setLines(null);
    } finally {
      setReading(false);
    }
  }

  const kept = (lines ?? []).filter((l) => l.include);
  const sum = kept.reduce((s, l) => s + (parseEuros(l.priceText) ?? 0), 0);
  const ready = kept.length > 0 && kept.every((l) => l.productId || l.newName.trim());
  const pickLine = lines?.find((l) => l.key === picking);

  function submit() {
    if (!ready) return;
    save.mutate(
      {
        date,
        storeName: store.trim() || null,
        lines: kept.map((l) => ({
          label: l.label,
          ...(l.productId ? { productId: l.productId } : { newProductName: l.newName.trim() }),
          quantity: l.quantity,
          unit: l.unit || null,
          totalCents: parseEuros(l.priceText),
          isPromo: l.isPromo,
          addToStock: l.addToStock,
        })),
      },
      { onSuccess: () => navigate("/achats") },
    );
  }

  return (
    <>
      <PageHeader back="/achats" title="Importer une facture" subtitle={fileName ?? "Facture PDF de drive"} />
      <datalist id="invoice-units">{STOCK_UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id="invoice-stores">{(stores.data ?? []).map((s) => <option key={s.id} value={s.name} />)}</datalist>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      <div className="space-y-4 px-4 pb-32">
        {!lines && (
          <div className="card space-y-3 p-5 text-center">
            <FileText className="mx-auto size-10 text-ink-3" />
            <p className="font-semibold">Choisissez la facture PDF de votre commande drive</p>
            <p className="text-sm text-ink-2">
              Elle est lue sur cet appareil : le fichier n'est envoyé nulle part. Vous relisez ensuite chaque ligne avant que les achats et le stock soient mis à jour.
            </p>
            <button className="btn-primary w-full" onClick={() => fileRef.current?.click()} disabled={reading || products.isPending}>
              {reading ? <Spinner className="text-brand-ink" /> : <Upload className="size-4" />} Choisir un PDF
            </button>
            {error && <p className="text-sm text-low">{error}</p>}
          </div>
        )}
        {reading && lines && <PageLoader />}

        {lines && (
          <>
            <div className="card grid grid-cols-2 gap-3 p-3">
              <label className="block">
                <span className="label">Magasin</span>
                <input className="input py-2" list="invoice-stores" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Magasin" />
              </label>
              <label className="block">
                <span className="label">Date</span>
                <input className="input py-2" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <p className="col-span-2 text-sm text-ink-2">
                {kept.length} article{kept.length > 1 ? "s" : ""} · {formatCents(sum)}
                {invoiceTotal != null &&
                  (Math.abs(invoiceTotal - sum) <= 1 ? (
                    <span className="text-ok"> · correspond au total de la facture ✓</span>
                  ) : (
                    <span className="text-watch"> · total de la facture : {formatCents(invoiceTotal)} (frais, consignes ou ligne mal lue ?)</span>
                  ))}
              </p>
            </div>
            <p className="px-1 text-xs text-ink-3">
              « Reconnu » : déjà associé lors d'une facture précédente. « À vérifier » : deviné d'après le nom. Vos choix sont retenus pour la prochaine fois.
            </p>

            <ul className="space-y-2">
              {lines.map((l) => {
                const p = l.productId ? byId.get(l.productId) : undefined;
                return (
                  <li key={l.key} className={`card space-y-2 p-3 ${l.include ? "" : "opacity-50"}`}>
                    <div className="flex items-start gap-2">
                      <label className="flex min-w-0 flex-1 items-start gap-2">
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" checked={l.include} onChange={(e) => update(l.key, { include: e.target.checked })} />
                        <span className="min-w-0 font-mono text-xs break-words text-ink-2">{l.label}</span>
                      </label>
                      {l.include && l.how === "learned" && <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">Reconnu</span>}
                      {l.include && l.how === "name" && <span className="shrink-0 rounded-full bg-watch-soft px-2 py-0.5 text-[11px] font-semibold text-watch">À vérifier</span>}
                    </div>
                    {l.include && (
                      <>
                        {p ? (
                          <button className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-left" onClick={() => setPicking(l.key)}>
                            <Package className="size-4 shrink-0 text-ink-3" />
                            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                            <span className="text-xs text-brand">Changer</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">Nouveau</span>
                            <input className="input min-w-0 flex-1 py-2" value={l.newName} onChange={(e) => update(l.key, { newName: e.target.value })} aria-label="Nom du nouveau produit" />
                            <button className="btn-ghost min-h-9 shrink-0 px-2 text-xs" onClick={() => setPicking(l.key)}>
                              Existant…
                            </button>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <NumberInput className="input w-20 py-2" value={l.quantity} onChange={(v) => update(l.key, { quantity: v })} placeholder="Qté" aria-label="Quantité" />
                          <input className="input w-24 py-2" list="invoice-units" value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} aria-label="Unité" />
                          <label className="relative">
                            <input className="input w-24 py-2 pr-6 text-right" inputMode="decimal" value={l.priceText} onChange={(e) => update(l.key, { priceText: e.target.value })} aria-label="Prix payé" />
                            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-ink-3">€</span>
                          </label>
                          <button className={`chip ${l.isPromo ? "chip-on" : ""}`} onClick={() => update(l.key, { isPromo: !l.isPromo })} aria-pressed={l.isPromo}>
                            Promo
                          </button>
                          <label className="ml-auto flex items-center gap-1.5 text-sm text-ink-2">
                            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={l.addToStock} onChange={(e) => update(l.key, { addToStock: e.target.checked })} />
                            Au stock
                          </label>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <button className="btn-ghost w-full text-sm" onClick={() => fileRef.current?.click()}>
              <FileText className="size-4" /> Choisir une autre facture
            </button>
          </>
        )}
      </div>

      {lines && (
        <div className="pb-safe fixed inset-x-0 bottom-16 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto max-w-3xl">
            <button className="btn-primary w-full" onClick={submit} disabled={!ready || save.isPending}>
              {save.isPending ? <Spinner className="text-brand-ink" /> : <Check className="size-4" />}
              Enregistrer {kept.length} achat{kept.length > 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      <ProductPickSheet
        open={!!pickLine}
        onClose={() => setPicking(null)}
        products={products.data ?? []}
        title={pickLine ? `« ${pickLine.label} » correspond à…` : ""}
        initialQuery={pickLine ? (pickLine.productId ? "" : pickLine.newName) : ""}
        currentId={pickLine?.productId ?? null}
        onPick={(productId) => {
          if (pickLine) update(pickLine.key, { productId, how: null });
          setPicking(null);
        }}
        onCreate={(name) => {
          if (pickLine) update(pickLine.key, { productId: null, newName: name, how: null });
          setPicking(null);
        }}
      />
    </>
  );
}
