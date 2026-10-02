import { ArrowDown, ArrowUp, ExternalLink, Heart, ListOrdered, Save, Search, Trash2, Undo2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import { matches } from "../../shared/text";
import { FillHandle } from "@/components/FillHandle";
import { type IngredientRow, IngredientsEditor, ingredientsInput, toIngredientRows } from "@/components/IngredientsEditor";
import { Pager } from "@/components/Pager";
import { EmptyState, NumberInput, PageHeader, PageLoader, Sheet, Spinner, Thumb, useConfirm } from "@/components/ui";
import { DIFFICULTY } from "@/lib/format";
import { type RecipeBulkUpdate, useBulkRecipes, useCategories, useProducts, useRecipes } from "@/lib/queries";
import { useSwipe } from "@/lib/swipe";
import type { Category, Product, RecipeSummary } from "@/lib/types";

type Draft = {
  name: string;
  favorite: boolean;
  categoryIds: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: number | null;
  tags: string[];
  ingredients: IngredientRow[];
};
type Key = keyof Draft;
type Edits = Record<string, Partial<Draft>>;

const original = (r: RecipeSummary): Draft => ({
  name: r.name,
  favorite: r.favorite,
  categoryIds: r.categoryIds,
  servings: r.servings,
  prepMinutes: r.prepMinutes,
  cookMinutes: r.cookMinutes,
  difficulty: r.difficulty,
  tags: r.tags,
  ingredients: toIngredientRows(r.ingredients),
});

/** Comparaison avec la valeur enregistrée : listes sans ordre, ingrédients dans l'ordre et sans clé d'affichage. */
function same(key: Key, a: unknown, b: unknown) {
  if (key === "ingredients") return JSON.stringify(ingredientsInput(a as IngredientRow[])) === JSON.stringify(ingredientsInput(b as IngredientRow[]));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  return a === b;
}
const parseTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))];

/** Colonnes saisissables au clavier (Entrée / flèches : même colonne, ligne suivante). */
const COLS: Key[] = ["favorite", "name", "categoryIds", "servings", "prepMinutes", "cookMinutes", "difficulty", "tags"];

type BulkAction = "addCat" | "removeCat" | "addTag" | "removeTag" | "difficulty" | "servings" | "favorite";
const BULK_ACTIONS: { value: BulkAction; label: string }[] = [
  { value: "addCat", label: "Ajouter la catégorie" },
  { value: "removeCat", label: "Retirer la catégorie" },
  { value: "addTag", label: "Ajouter le tag" },
  { value: "removeTag", label: "Retirer le tag" },
  { value: "difficulty", label: "Difficulté" },
  { value: "servings", label: "Portions" },
  { value: "favorite", label: "Favori" },
];

type SortKey = "name" | "time" | "ingredients" | "updated";
const cellCls = "w-full min-w-0 rounded-md bg-transparent px-2 py-1.5 outline-none focus:bg-surface focus:ring-2 focus:ring-brand";

type IngredientInfo = { count: number; unlinked: number; label: string };

/** Résumé des ingrédients ; « non reliés » porte sur la version enregistrée (les nouveaux le seront à l'enregistrement). */
function ingredientSummary(r: RecipeSummary, rows: IngredientRow[], products: Map<string, Product>): IngredientInfo {
  const kept = rows.filter((i) => i.name.trim() || i.quantity != null);
  const unlinked = r.ingredients.filter((i) => !i.productId || !products.has(i.productId)).length;
  return { count: kept.length, unlinked, label: kept.map((i) => i.name).join(", ") };
}

/**
 * Édition en masse des recettes (informations générales). PC : tableau. Mobile :
 * une fiche à la fois, balayer pour passer à la recette suivante. Tout est
 * enregistré d'un coup.
 */
export function RecipeBulkEditPage() {
  const recipes = useRecipes();
  const categories = useCategories();
  const products = useProducts();
  const bulk = useBulkRecipes();
  const { ask, dialog } = useConfirm();

  const cats = useMemo(() => (categories.data ?? []).filter((c) => c.kind === "recipe"), [categories.data]);
  const productMap = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const byId = useMemo(() => new Map((recipes.data ?? []).map((r) => [r.id, r])), [recipes.data]);
  // Valeurs enregistrées, calculées une fois : les clés des lignes d'ingrédients restent stables.
  const originals = useMemo(() => new Map((recipes.data ?? []).map((r) => [r.id, original(r)])), [recipes.data]);

  const [edits, setEdits] = useState<Edits>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [catSheet, setCatSheet] = useState<string | null>(null);
  const [ingSheet, setIngSheet] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const changedCount = Object.keys(edits).length;
  const dirty = changedCount > 0;

  const setCell = useCallback(
    <K extends Key>(id: string, key: K, value: Draft[K]) => {
      const base = originals.get(id);
      if (!base) return;
      setEdits((prev) => {
        const row = { ...prev[id] };
        if (same(key, value, base[key])) delete row[key];
        else row[key] = value;
        const next = { ...prev };
        if (Object.keys(row).length) next[id] = row;
        else delete next[id];
        return next;
      });
    },
    [originals],
  );
  const draftOf = useCallback((r: RecipeSummary): Draft => ({ ...(originals.get(r.id) ?? original(r)), ...edits[r.id] }), [originals, edits]);

  const rows = useMemo(() => {
    let list = recipes.data ?? [];
    if (q.trim()) list = list.filter((r) => matches(r.name, q) || r.tags.some((t) => matches(t, q)) || r.ingredients.some((i) => matches(i.name, q)));
    if (catFilter === "_none") list = list.filter((r) => !r.categoryIds.length);
    else if (catFilter === "_fav") list = list.filter((r) => r.favorite);
    else if (catFilter) list = list.filter((r) => r.categoryIds.includes(catFilter));
    if (onlyChanged) list = list.filter((r) => edits[r.id]);
    // Tri sur les valeurs enregistrées : les lignes ne sautent pas pendant la saisie.
    const val = (r: RecipeSummary): string | number => {
      switch (sort.key) {
        case "name":
          return r.name.toLocaleLowerCase("fr");
        case "time":
          return (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) || Infinity;
        case "ingredients":
          return r.ingredients.length;
        case "updated":
          return r.updatedAt;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
      return d * sort.dir || a.name.localeCompare(b.name, "fr");
    });
    // `edits` seulement pour le filtre « modifiées ».
  }, [recipes.data, q, catFilter, onlyChanged, onlyChanged ? edits : null, sort]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function save() {
    if (!dirty || bulk.isPending) return;
    const updates: RecipeBulkUpdate[] = Object.entries(edits).map(([id, { ingredients, ...e }]) => ({ id, ...e, ...(ingredients ? { ingredients: ingredientsInput(ingredients) } : {}) }));
    bulk.mutate({ updates }, { onSuccess: () => setEdits({}) });
  }

  async function removeSelected() {
    const ids = [...selected];
    const ok = await ask(`Supprimer ${ids.length} recette${ids.length > 1 ? "s" : ""} ?`, {
      message: "Leurs ingrédients et étapes disparaissent. Le planning garde le nom des plats ; le stock n'est pas touché.",
    });
    if (!ok) return;
    bulk.mutate(
      { deletes: ids },
      {
        onSuccess: () => {
          setSelected(new Set());
          setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))));
        },
      },
    );
  }

  function applyBulk(action: BulkAction, value: string | number | boolean | null) {
    for (const id of selected) {
      const r = byId.get(id);
      if (!r) continue;
      const d = draftOf(r);
      switch (action) {
        case "addCat":
          if (typeof value === "string" && value && !d.categoryIds.includes(value)) setCell(id, "categoryIds", [...d.categoryIds, value]);
          break;
        case "removeCat":
          setCell(id, "categoryIds", d.categoryIds.filter((c) => c !== value));
          break;
        case "addTag":
          setCell(id, "tags", [...new Set([...d.tags, ...parseTags(String(value ?? ""))])]);
          break;
        case "removeTag": {
          const out = parseTags(String(value ?? ""));
          setCell(id, "tags", d.tags.filter((t) => !out.includes(t)));
          break;
        }
        case "difficulty":
          setCell(id, "difficulty", typeof value === "number" ? value : null);
          break;
        case "servings":
          setCell(id, "servings", typeof value === "number" ? value : null);
          break;
        case "favorite":
          setCell(id, "favorite", value === true);
          break;
      }
    }
  }

  /** Poignée de recopie : la valeur (modifiée ou non) de la ligne source va sur les lignes visées. */
  function onFill(c: number, from: number, to: number[]) {
    const key = COLS[c];
    const src = rows[from];
    if (!key || !src) return;
    const value = draftOf(src)[key];
    for (const t of to) if (rows[t]) setCell(rows[t].id, key, value);
  }

  // Ctrl+S enregistre ; quitter avec des modifications : avertissement.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const el = e.target as HTMLElement;
    if (el.dataset.r == null) return;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const isSelect = el.tagName === "SELECT";
    let dr = 0;
    if (e.key === "Enter") dr = e.shiftKey ? -1 : 1;
    else if (e.key === "ArrowDown" && !isSelect) dr = 1;
    else if (e.key === "ArrowUp" && !isSelect) dr = -1;
    else return;
    const next = tableRef.current?.querySelector<HTMLElement>(`[data-r="${r + dr}"][data-c="${c}"]`);
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  }

  // Mobile : position dans la liste filtrée.
  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const current = rows[at];
  const swipe = useSwipe({
    onPrev: at > 0 ? () => setCursor(at - 1) : null,
    onNext: at < rows.length - 1 ? () => setCursor(at + 1) : null,
  });
  useEffect(() => setCursor(0), [q, catFilter, onlyChanged]);

  const header = (key: SortKey | null, label: string, className = "") => (
    <th className={`sticky top-0 z-10 border-b border-line bg-surface-2 px-2 py-2 text-left text-xs font-bold tracking-wide whitespace-nowrap text-ink-2 uppercase ${className}`}>
      {key ? (
        <button className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>
          {label}
          {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : (
        label
      )}
    </th>
  );

  const saveButton = (
    <div className="flex items-center gap-1 pr-2">
      {dirty && (
        <button className="btn-ghost px-2" onClick={() => setEdits({})} disabled={bulk.isPending} aria-label="Annuler les modifications">
          <Undo2 className="size-4" /> <span className="hidden sm:inline">Annuler</span>
        </button>
      )}
      <button className="btn-primary min-h-10 px-3" onClick={save} disabled={!dirty || bulk.isPending}>
        {bulk.isPending ? <Spinner className="text-brand-ink" /> : <Save className="size-4" />}
        Enregistrer{dirty ? ` (${changedCount})` : ""}
      </button>
    </div>
  );

  const filters = (
    <>
      <label className="relative w-full lg:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <input className="input py-2 pl-9" type="search" placeholder="Nom, ingrédient, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <select className="input min-w-0 flex-1 py-2 lg:w-56 lg:flex-none" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filtrer par catégorie">
        <option value="">Toutes les catégories</option>
        <option value="_fav">Favoris</option>
        {cats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon ? `${c.icon} ` : ""}
            {c.name}
          </option>
        ))}
        <option value="_none">Sans catégorie</option>
      </select>
      <label className="flex items-center gap-2 text-sm font-medium whitespace-nowrap text-ink-2">
        <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
        Modifiées
      </label>
    </>
  );

  const catRecipe = catSheet ? byId.get(catSheet) : undefined;
  const ingRecipe = ingSheet ? byId.get(ingSheet) : undefined;

  return (
    <>
      <div className="flex min-h-dvh flex-col lg:h-dvh">
        <PageHeader
          back="/recettes"
          title="Édition en masse"
          subtitle={recipes.data ? `${rows.length} / ${recipes.data.length} recettes` : undefined}
          actions={saveButton}
        />
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">{filters}</div>

        {recipes.isPending ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon="🔍" title="Aucune recette ne correspond" />
        ) : (
          <>
            {/* Mobile : une fiche à la fois */}
            <div className="px-4 pb-8 lg:hidden">
              <Pager index={at} count={rows.length} onPrev={at > 0 ? () => setCursor(at - 1) : null} onNext={at < rows.length - 1 ? () => setCursor(at + 1) : null} />
              <div className="mt-3 overflow-x-clip">
                <div ref={swipe}>
                  {current && (
                    <RecipeCardEditor
                      key={current.id}
                      r={current}
                      d={draftOf(current)}
                      edit={edits[current.id]}
                      cats={cats}
                      products={products.data ?? []}
                      onChange={setCell}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* PC : tableau */}
            <div className="hidden min-h-0 flex-1 flex-col lg:flex">
              {selected.size > 0 && <BulkBar count={selected.size} cats={cats} onApply={applyBulk} onDelete={removeSelected} onClear={() => setSelected(new Set())} busy={bulk.isPending} />}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-t border-line">
                <div ref={gridRef} className="relative">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 w-10 border-b border-line bg-surface-2 px-3">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--brand)]"
                          aria-label="Tout sélectionner"
                          checked={allSelected}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                        />
                      </th>
                      {header(null, "", "w-10")}
                      {header("name", "Nom", "min-w-64")}
                      {header(null, "Catégories", "min-w-48")}
                      {header(null, "Portions", "w-24")}
                      {header("time", "Prépa", "w-24")}
                      {header(null, "Cuisson", "w-24")}
                      {header(null, "Difficulté", "w-32")}
                      {header(null, "Tags", "min-w-48")}
                      {header("ingredients", "Ingrédients", "min-w-56")}
                      <th className="sticky top-0 z-10 w-10 border-b border-line bg-surface-2" />
                    </tr>
                  </thead>
                  <tbody ref={tableRef} onKeyDown={onKeyDown}>
                    {rows.map((r, i) => (
                      <Row
                        key={r.id}
                        r={r}
                        index={i}
                        base={originals.get(r.id)!}
                        edit={edits[r.id]}
                        selected={selected.has(r.id)}
                        cats={cats}
                        ingredients={ingredientSummary(r, edits[r.id]?.ingredients ?? originals.get(r.id)?.ingredients ?? [], productMap)}
                        onChange={setCell}
                        onToggle={(id) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(id)) n.delete(id);
                            else n.add(id);
                            return n;
                          })
                        }
                        onCategories={setCatSheet}
                        onIngredients={setIngSheet}
                      />
                    ))}
                  </tbody>
                </table>
                <FillHandle container={gridRef} scroller={scrollRef} onFill={onFill} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <Sheet open={!!catRecipe} onClose={() => setCatSheet(null)} title={`Catégories · ${catRecipe?.name || "recette"}`}>
        {catRecipe && <CategoryChips cats={cats} value={draftOf(catRecipe).categoryIds} onChange={(v) => setCell(catRecipe.id, "categoryIds", v)} />}
        <button className="btn-primary mt-4 w-full" onClick={() => setCatSheet(null)}>
          OK
        </button>
      </Sheet>
      <Sheet open={!!ingRecipe} onClose={() => setIngSheet(null)} title={`Ingrédients · ${ingRecipe?.name || "recette"}`}>
        {ingRecipe && (
          <>
            <IngredientsEditor rows={draftOf(ingRecipe).ingredients} onChange={(v) => setCell(ingRecipe.id, "ingredients", v)} products={products.data ?? []} />
            <p className="mt-3 text-xs text-ink-3">Les nouveaux ingrédients seront reliés au stock à l'enregistrement du tableau.</p>
          </>
        )}
        <button className="btn-primary mt-4 w-full" onClick={() => setIngSheet(null)}>
          OK
        </button>
      </Sheet>
      {dialog}
      <Sheet open={blocker.state === "blocked"} onClose={() => blocker.reset?.()} title="Quitter sans enregistrer ?">
        <p className="mb-5 text-ink-2">
          {changedCount} recette{changedCount > 1 ? "s" : ""} modifiée{changedCount > 1 ? "s" : ""} n'
          {changedCount > 1 ? "ont" : "a"} pas été enregistrée{changedCount > 1 ? "s" : ""}.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-soft" onClick={() => blocker.reset?.()}>
            Rester
          </button>
          <button className="btn bg-danger text-white" onClick={() => blocker.proceed?.()}>
            Quitter
          </button>
        </div>
      </Sheet>
    </>
  );
}

// ─── Morceaux communs ────────────────────────────────────────────────────────

function CategoryChips({ cats, value, onChange }: { cats: Category[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!cats.length) return <p className="text-sm text-ink-3">Aucune catégorie de recette : créez-en dans les réglages.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {cats.map((c) => {
        const on = value.includes(c.id);
        return (
          <button type="button" key={c.id} className={`chip ${on ? "chip-on" : ""}`} onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])} aria-pressed={on}>
            {c.icon} {c.name}
          </button>
        );
      })}
    </div>
  );
}

/** Tags saisis « rapide, végé » ; la liste n'est mise à jour qu'en quittant le champ. */
function TagsInput({ value, onChange, className, ...rest }: { value: string[]; onChange: (v: string[]) => void; className: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value.join(", "));
  const joined = value.join(", ");
  useEffect(() => setText(joined), [joined]);
  return <input {...rest} className={className} value={text} placeholder="rapide, végé…" onChange={(e) => setText(e.target.value)} onBlur={() => onChange(parseTags(text))} />;
}

function IngredientsCell({ ingredients, onOpen }: { ingredients: IngredientInfo; onOpen: () => void }) {
  return (
    <button className="block w-full max-w-80 rounded-md px-2 py-1.5 text-left hover:bg-surface" onClick={onOpen} title={ingredients.label || "Ajouter des ingrédients"}>
      <span className="block truncate">
        <span className="font-semibold tabular-nums">{ingredients.count}</span>
        {ingredients.label && <span className="text-ink-2"> · {ingredients.label}</span>}
      </span>
      {ingredients.unlinked > 0 && (
        <span className="block text-xs text-low">
          {ingredients.unlinked} non relié{ingredients.unlinked > 1 ? "s" : ""} au stock
        </span>
      )}
    </button>
  );
}

type Change = <K extends Key>(id: string, key: K, value: Draft[K]) => void;

// ─── Ligne du tableau (PC) ───────────────────────────────────────────────────

type RowProps = {
  r: RecipeSummary;
  base: Draft;
  index: number;
  edit: Partial<Draft> | undefined;
  selected: boolean;
  cats: Category[];
  ingredients: IngredientInfo;
  onChange: Change;
  onToggle: (id: string) => void;
  onCategories: (id: string) => void;
  onIngredients: (id: string) => void;
};

const Row = memo(function Row({ r, base, index, edit, selected, cats, ingredients, onChange, onToggle, onCategories, onIngredients }: RowProps) {
  const d = { ...base, ...edit };
  const changed = (k: Key) => !!edit && k in edit;
  const td = (k: Key) => `border-b border-line px-0.5 py-0.5 ${changed(k) ? "bg-brand-soft" : ""}`;
  const nav = (k: Key) => ({ "data-r": index, "data-c": COLS.indexOf(k) });
  const catNames = d.categoryIds.map((id) => cats.find((c) => c.id === id)).filter((c) => !!c);

  return (
    <tr className={selected ? "bg-surface-2" : "hover:bg-surface-2/50"}>
      <td className="border-b border-line px-3">
        <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={selected} onChange={() => onToggle(r.id)} aria-label={`Sélectionner ${r.name}`} />
      </td>
      <td className={td("favorite")}>
        <button className="flex size-8 items-center justify-center rounded-md hover:bg-surface" onClick={() => onChange(r.id, "favorite", !d.favorite)} aria-label={d.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} aria-pressed={d.favorite} {...nav("favorite")}>
          <Heart className={`size-4 ${d.favorite ? "fill-current text-rose-400" : "text-ink-3"}`} />
        </button>
      </td>
      <td className={td("name")}>
        <input className={`${cellCls} font-semibold`} value={d.name} placeholder="Recette sans nom" onChange={(e) => onChange(r.id, "name", e.target.value)} {...nav("name")} />
      </td>
      <td className={td("categoryIds")}>
        <button className="flex w-full flex-wrap gap-1 rounded-md px-2 py-1.5 text-left hover:bg-surface focus:ring-2 focus:ring-brand focus:outline-none" onClick={() => onCategories(r.id)} {...nav("categoryIds")}>
          {catNames.length ? (
            catNames.map((c) => (
              <span key={c.id} className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
                {c.icon} {c.name}
              </span>
            ))
          ) : (
            <span className="text-ink-3">—</span>
          )}
        </button>
      </td>
      <td className={td("servings")}>
        <NumberInput className={`${cellCls} text-right`} value={d.servings} onChange={(v) => onChange(r.id, "servings", v)} {...nav("servings")} />
      </td>
      <td className={td("prepMinutes")}>
        <NumberInput integer className={`${cellCls} text-right`} value={d.prepMinutes} placeholder="min" onChange={(v) => onChange(r.id, "prepMinutes", v)} {...nav("prepMinutes")} />
      </td>
      <td className={td("cookMinutes")}>
        <NumberInput integer className={`${cellCls} text-right`} value={d.cookMinutes} placeholder="min" onChange={(v) => onChange(r.id, "cookMinutes", v)} {...nav("cookMinutes")} />
      </td>
      <td className={td("difficulty")}>
        <select className={cellCls} value={d.difficulty ?? ""} onChange={(e) => onChange(r.id, "difficulty", e.target.value ? Number(e.target.value) : null)} {...nav("difficulty")}>
          <option value="">—</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {DIFFICULTY[n]}
            </option>
          ))}
        </select>
      </td>
      <td className={td("tags")}>
        <TagsInput className={cellCls} value={d.tags} onChange={(v) => onChange(r.id, "tags", v)} {...nav("tags")} />
      </td>
      <td className={td("ingredients")}>
        <IngredientsCell ingredients={ingredients} onOpen={() => onIngredients(r.id)} />
      </td>
      <td className="border-b border-line px-2">
        <Link to={`/recettes/${r.id}`} className="text-ink-3 hover:text-brand" aria-label="Ouvrir la recette" title="Ouvrir la recette">
          <ExternalLink className="size-4" />
        </Link>
      </td>
    </tr>
  );
});

// ─── Fiche (mobile) ──────────────────────────────────────────────────────────

function RecipeCardEditor({
  r,
  d,
  edit,
  cats,
  products,
  onChange,
}: {
  r: RecipeSummary;
  d: Draft;
  edit: Partial<Draft> | undefined;
  cats: Category[];
  products: Product[];
  onChange: Change;
}) {
  const ring = (k: Key) => (edit && k in edit ? "ring-2 ring-brand/40" : "");
  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-start gap-3">
        <Thumb photoId={r.photoId} fallback="🍽️" className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <input className={`input py-2 text-lg font-semibold ${ring("name")}`} value={d.name} placeholder="Recette sans nom" onChange={(e) => onChange(r.id, "name", e.target.value)} aria-label="Nom" />
        </div>
        <button className={`icon-btn shrink-0 rounded-full ${ring("favorite")}`} onClick={() => onChange(r.id, "favorite", !d.favorite)} aria-label="Favori" aria-pressed={d.favorite}>
          <Heart className={`size-5 ${d.favorite ? "fill-current text-rose-400" : "text-ink-3"}`} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="label">Portions</span>
          <NumberInput className={`input py-2 ${ring("servings")}`} value={d.servings} onChange={(v) => onChange(r.id, "servings", v)} placeholder="4" />
        </label>
        <label className="block">
          <span className="label">Prépa (min)</span>
          <NumberInput integer className={`input py-2 ${ring("prepMinutes")}`} value={d.prepMinutes} onChange={(v) => onChange(r.id, "prepMinutes", v)} placeholder="15" />
        </label>
        <label className="block">
          <span className="label">Cuisson (min)</span>
          <NumberInput integer className={`input py-2 ${ring("cookMinutes")}`} value={d.cookMinutes} onChange={(v) => onChange(r.id, "cookMinutes", v)} placeholder="30" />
        </label>
      </div>

      <div>
        <span className="label">Difficulté</span>
        <div className={`grid grid-cols-3 gap-2 rounded-full ${ring("difficulty")}`}>
          {[1, 2, 3].map((n) => (
            <button type="button" key={n} className={`chip justify-center ${d.difficulty === n ? "chip-on" : ""}`} onClick={() => onChange(r.id, "difficulty", d.difficulty === n ? null : n)}>
              {DIFFICULTY[n]}
            </button>
          ))}
        </div>
      </div>

      <div className={`rounded-xl ${ring("categoryIds")}`}>
        <span className="label">Catégories</span>
        <CategoryChips cats={cats} value={d.categoryIds} onChange={(v) => onChange(r.id, "categoryIds", v)} />
      </div>

      <label className="block">
        <span className="label">Tags (séparés par des virgules)</span>
        <TagsInput className={`input py-2 ${ring("tags")}`} value={d.tags} onChange={(v) => onChange(r.id, "tags", v)} />
      </label>

      <div className={`rounded-xl ${ring("ingredients")}`}>
        <span className="label">Ingrédients</span>
        <IngredientsEditor rows={d.ingredients} onChange={(v) => onChange(r.id, "ingredients", v)} products={products} />
      </div>

      <Link to={`/recettes/${r.id}/modifier`} className="btn-ghost w-full">
        <ListOrdered className="size-4" /> {r.stepCount} étape{r.stepCount > 1 ? "s" : ""} · modifier la préparation
      </Link>
    </div>
  );
}

// ─── Actions sur la sélection (PC) ───────────────────────────────────────────

function BulkBar({
  count,
  cats,
  onApply,
  onDelete,
  onClear,
  busy,
}: {
  count: number;
  cats: Category[];
  onApply: (action: BulkAction, value: string | number | boolean | null) => void;
  onDelete: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const [action, setAction] = useState<BulkAction>("addCat");
  const [text, setText] = useState("");
  const [num, setNum] = useState<number | null>(null);
  const reset = (a: BulkAction) => {
    setAction(a);
    setText(a === "difficulty" ? "1" : a === "favorite" ? "yes" : "");
    setNum(null);
  };
  const value = (): string | number | boolean | null => {
    if (action === "servings") return num;
    if (action === "difficulty") return text ? Number(text) : null;
    if (action === "favorite") return text === "yes";
    return text || null;
  };

  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-3 py-2">
      <span className="text-sm font-semibold">
        {count} sélectionnée{count > 1 ? "s" : ""} :
      </span>
      <select className="input w-52 py-1.5" value={action} onChange={(e) => reset(e.target.value as BulkAction)} aria-label="Action">
        {BULK_ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      {action === "addCat" || action === "removeCat" ? (
        <select className="input w-56 py-1.5" value={text} onChange={(e) => setText(e.target.value)} aria-label="Catégorie">
          <option value="">— choisir —</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ` : ""}
              {c.name}
            </option>
          ))}
        </select>
      ) : action === "difficulty" ? (
        <select className="input w-40 py-1.5" value={text} onChange={(e) => setText(e.target.value)} aria-label="Difficulté">
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {DIFFICULTY[n]}
            </option>
          ))}
          <option value="">— aucune —</option>
        </select>
      ) : action === "favorite" ? (
        <select className="input w-32 py-1.5" value={text} onChange={(e) => setText(e.target.value)} aria-label="Favori">
          <option value="yes">Oui</option>
          <option value="no">Non</option>
        </select>
      ) : action === "servings" ? (
        <NumberInput className="input w-28 py-1.5" value={num} onChange={setNum} placeholder="vide" aria-label="Portions" />
      ) : (
        <input className="input w-44 py-1.5" value={text} onChange={(e) => setText(e.target.value)} placeholder="rapide, végé" aria-label="Tags" />
      )}
      <button className="btn-primary py-1.5" onClick={() => onApply(action, value())} disabled={(action === "addCat" || action === "removeCat" || action === "addTag" || action === "removeTag") && !text}>
        Appliquer
      </button>
      <span className="flex-1" />
      <button className="btn-ghost py-1.5" onClick={onClear}>
        Désélectionner
      </button>
      <button className="btn-danger py-1.5" onClick={onDelete} disabled={busy}>
        <Trash2 className="size-4" /> Supprimer
      </button>
    </div>
  );
}
