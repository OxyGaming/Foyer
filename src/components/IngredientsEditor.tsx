import { ArrowDown, ArrowUp, ClipboardList, Plus, Shuffle, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { AlternativesSheet } from "@/components/AlternativesSheet";
import { NumberInput, Sheet } from "@/components/ui";
import { UNIT_SUGGESTIONS } from "@/lib/format";
import { parseIngredientLines } from "@/lib/ingredients";
import type { Ingredient, Product } from "@/lib/types";

/** Ligne d'ingrédient en cours d'édition ; `key` ne sert qu'à l'affichage. */
export type IngredientRow = Omit<Ingredient, "id"> & { key: string };

export const newKey = () => Math.random().toString(36).slice(2);

export const toIngredientRows = (list: Omit<Ingredient, "id">[]): IngredientRow[] =>
  list.map((i) => ({ name: i.name, productId: i.productId, quantity: i.quantity, unit: i.unit, note: i.note ?? null, alternatives: i.alternatives ?? [], key: newKey() }));

/** Ce qu'on envoie au serveur : sans clé d'affichage ni ligne vide. */
export const ingredientsInput = (rows: IngredientRow[]): Omit<Ingredient, "id">[] =>
  rows.map(({ key: _k, ...i }) => i).filter((i) => i.name.trim() || i.quantity != null);

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

/** Liste d'ingrédients modifiable : quantité, unité, précision, ordre, remplaçants, collage d'une liste. */
export function IngredientsEditor({ rows, onChange, products }: { rows: IngredientRow[]; onChange: (rows: IngredientRow[]) => void; products: Product[] }) {
  const [paste, setPaste] = useState<string | null>(null);
  const [altFor, setAltFor] = useState<string | null>(null);
  const ids = useId();
  const unitsList = `${ids}-units`;
  const namesList = `${ids}-names`;
  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  // Déclinaisons par générique : un ingrédient relié à « Pâtes » accepte déjà toute la famille.
  const familySize = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) if (p.parentId) m.set(p.parentId, (m.get(p.parentId) ?? 0) + 1);
    return m;
  }, [products]);
  const altRow = rows.find((r) => r.key === altFor);

  const update = (key: string, patch: Partial<IngredientRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function importLines() {
    const added = (paste ?? "").split("\n").flatMap(parseIngredientLines);
    onChange([...rows.filter((r) => r.name || r.quantity != null), ...toIngredientRows(added)]);
    setPaste(null);
  }

  return (
    <div className="space-y-2">
      <datalist id={unitsList}>{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id={namesList}>{products.filter((p) => p.name).map((p) => <option key={p.id} value={p.name} />)}</datalist>
      {rows.map((row, idx) => (
        <div key={row.key} className="card p-2">
          <div className="flex gap-2">
            <input
              className="input flex-1 py-2.5"
              list={namesList}
              placeholder="Ingrédient"
              value={row.name}
              onChange={(e) => update(row.key, { name: e.target.value, productId: null })}
              aria-label="Ingrédient"
            />
            <button type="button" className="icon-btn size-10" onClick={() => onChange(rows.filter((r) => r.key !== row.key))} aria-label="Retirer l'ingrédient">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <NumberInput className="input w-16 py-2 sm:w-20" value={row.quantity} onChange={(v) => update(row.key, { quantity: v })} placeholder="Qté" />
            <input className="input w-20 py-2 sm:w-24" list={unitsList} placeholder="Unité" value={row.unit ?? ""} onChange={(e) => update(row.key, { unit: e.target.value || null })} aria-label="Unité" />
            <input className="input min-w-0 flex-1 py-2" placeholder="Précision" value={row.note ?? ""} onChange={(e) => update(row.key, { note: e.target.value || null })} aria-label="Précision" />
            <div className="flex flex-col">
              <button type="button" className="px-1 text-ink-3 disabled:opacity-30" disabled={idx === 0} onClick={() => onChange(move(rows, idx, idx - 1))} aria-label="Monter">
                <ArrowUp className="size-4" />
              </button>
              <button type="button" className="px-1 text-ink-3 disabled:opacity-30" disabled={idx === rows.length - 1} onClick={() => onChange(move(rows, idx, idx + 1))} aria-label="Descendre">
                <ArrowDown className="size-4" />
              </button>
            </div>
          </div>
          {row.name.trim() && (
            <button type="button" className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs text-ink-2 hover:bg-surface-2" onClick={() => setAltFor(row.key)}>
              <Shuffle className="size-3.5 shrink-0 text-ink-3" />
              {row.productId && familySize.get(row.productId) ? (
                <span className="shrink-0 font-medium text-brand">Toute la famille ({familySize.get(row.productId)}){row.alternatives?.length ? " · " : ""}</span>
              ) : null}
              {row.alternatives?.length ? (
                <span className="truncate">ou {row.alternatives.map((id) => productName.get(id) ?? "?").join(", ")}</span>
              ) : !(row.productId && familySize.get(row.productId)) ? (
                <span className="text-ink-3">Remplaçants pour cette recette…</span>
              ) : null}
            </button>
          )}
        </div>
      ))}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button type="button" className="btn-soft" onClick={() => onChange([...rows, ...toIngredientRows([{ name: "", productId: null, quantity: null, unit: null, note: null }])])}>
          <Plus className="size-4" /> Ajouter un ingrédient
        </button>
        <button type="button" className="btn-soft px-3" onClick={() => setPaste("")} title="Coller une liste d'ingrédients">
          <ClipboardList className="size-4" /> <span className="hidden sm:inline">Coller une liste</span>
        </button>
      </div>

      <AlternativesSheet
        open={!!altRow}
        onClose={() => setAltFor(null)}
        products={products}
        name={altRow?.name ?? ""}
        mainId={altRow?.productId ?? null}
        value={altRow?.alternatives ?? []}
        onSave={(alternatives) => {
          if (altRow) update(altRow.key, { alternatives });
          setAltFor(null);
        }}
      />
      <Sheet open={paste !== null} onClose={() => setPaste(null)} title="Coller une liste d'ingrédients">
        <p className="mb-3 text-sm text-ink-2">Une ligne par ingrédient. Ex. « 500 ml de lait », « 3 œufs », « Sel ».</p>
        <textarea className="input min-h-48 font-mono text-sm" autoFocus value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} placeholder={"250 g de farine\n3 œufs\n500 ml de lait\n1 pincée de sel"} />
        <button type="button" className="btn-primary mt-3 w-full" onClick={importLines}>
          Ajouter à la recette
        </button>
      </Sheet>
    </div>
  );
}
