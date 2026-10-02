import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { matches, productKey } from "../../shared/text";
import { Sheet, StatusBadge } from "@/components/ui";
import { formatQty } from "@/lib/format";
import type { Product } from "@/lib/types";

/** Produits qui ressemblent à l'ingrédient : même catégorie que le produit principal, ou un mot en commun. */
export function suggestedAlternatives(products: Product[], name: string, mainId: string | null): Set<string> {
  const main = mainId ? products.find((p) => p.id === mainId) : undefined;
  const words = productKey(name || main?.name)
    .split(" ")
    .filter((w) => w.length > 2);
  return new Set(
    products
      .filter((p) => p.id !== mainId)
      .filter((p) => (main?.categoryId && p.categoryId === main.categoryId) || productKey(p.name).split(" ").some((w) => words.includes(w)))
      .map((p) => p.id),
  );
}

/**
 * Choix des variantes acceptées pour un ingrédient : « Pâtes » peut être fait
 * avec des tagliatelles ou des coquillettes, pas avec des raviolis.
 */
export function AlternativesSheet({
  open,
  onClose,
  products,
  name,
  mainId,
  value,
  onSave,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  /** Nom de l'ingrédient. */
  name: string;
  mainId: string | null;
  value: string[];
  onSave: (ids: string[]) => void;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPicked(value);
    setQ("");
    setAll(false);
    // Seulement à l'ouverture : la saisie en cours n'est pas écrasée.
  }, [open]);

  const main = mainId ? products.find((p) => p.id === mainId) : undefined;
  const suggested = useMemo(() => suggestedAlternatives(products, name, mainId), [products, name, mainId]);
  const list = useMemo(() => {
    const others = products.filter((p) => p.id !== mainId);
    if (q.trim()) return others.filter((p) => matches(p.name, q) || matches(p.brand, q));
    // Les variantes déjà choisies restent visibles, puis les suggestions.
    return others.filter((p) => picked.includes(p.id) || suggested.has(p.id) || all);
  }, [products, mainId, q, picked, suggested, all]);
  const toggle = (id: string) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  return (
    <Sheet open={open} onClose={onClose} title={`Variantes acceptées · ${name || "ingrédient"}`}>
      <p className="mb-3 text-sm text-ink-2">
        Cochez les produits qui conviennent aussi{main ? <> à la place de « {main.name} »</> : null}. Le stock de l'un d'eux suffit pour cuisiner ; s'il n'y a rien, c'est {main ? "le produit principal" : "l'ingrédient"} qui part dans les courses.
      </p>
      <label className="relative mb-2 block">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
        <input className="input pl-10" type="search" placeholder="Chercher un produit…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="max-h-[45dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {list.length === 0 && <li className="p-4 text-center text-sm text-ink-3">{q ? "Aucun produit ne correspond" : "Aucune suggestion : cherchez un produit"}</li>}
        {list.map((p) => {
          const on = picked.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${on ? "bg-brand-soft" : ""}`} onClick={() => toggle(p.id)} aria-pressed={on}>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand bg-brand text-brand-ink" : "border-line"}`}>{on && <Check className="size-3.5" />}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.name || "Sans nom"}</span>
                <span className="shrink-0 text-xs text-ink-2 tabular-nums">{p.quantity != null ? formatQty(p.quantity, p.unit) : p.stock.length ? "en stock" : "—"}</span>
                <StatusBadge status={p.status} compact />
              </button>
            </li>
          );
        })}
      </ul>
      {!q && !all && (
        <button type="button" className="btn-ghost mt-1 min-h-9 w-full text-sm" onClick={() => setAll(true)}>
          Voir tous les produits
        </button>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className="btn-soft" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onSave(picked)}>
          Valider{picked.length ? ` (${picked.length})` : ""}
        </button>
      </div>
    </Sheet>
  );
}

/** Choix d'un seul produit (produit principal relié à un ingrédient). */
export function ProductPickSheet({
  open,
  onClose,
  products,
  title,
  initialQuery,
  currentId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  title: string;
  initialQuery: string;
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  useEffect(() => {
    if (open) setQ(initialQuery);
  }, [open, initialQuery]);
  const list = useMemo(() => {
    const found = q.trim() ? products.filter((p) => matches(p.name, q) || matches(p.brand, q)) : products;
    return found.slice(0, 80);
  }, [products, q]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <label className="relative mb-2 block">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
        <input className="input pl-10" type="search" placeholder="Chercher un produit…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      <ul className="max-h-[55dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {list.length === 0 && <li className="p-4 text-center text-sm text-ink-3">Aucun produit ne correspond</li>}
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${p.id === currentId ? "bg-brand-soft" : ""}`} onClick={() => onPick(p.id)}>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name || "Sans nom"}</span>
              <span className="shrink-0 text-xs text-ink-2 tabular-nums">{p.quantity != null ? formatQty(p.quantity, p.unit) : p.unit ?? ""}</span>
              {p.id === currentId && <Check className="size-4 text-brand" />}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
