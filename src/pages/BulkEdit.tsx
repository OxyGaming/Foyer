import { ArrowDown, ArrowUp, ExternalLink, Monitor, Save, Search, Trash2, Undo2 } from "lucide-react";
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import { stockStatus } from "../../shared/stock";
import { matches } from "../../shared/text";
import { FillHandle } from "@/components/FillHandle";
import { EmptyState, NumberInput, PageHeader, PageLoader, Sheet, Spinner, StatusBadge, useConfirm } from "@/components/ui";
import { formatQty, STOCK_UNIT_SUGGESTIONS } from "@/lib/format";
import { type BulkUpdate, useBulkProducts, useCategories, useLocations, useProducts } from "@/lib/queries";
import { descendantIds, flattenTree, pathLabel } from "@/lib/tree";
import type { Category, Location, Product } from "@/lib/types";

type Draft = {
  name: string;
  brand: string | null;
  categoryId: string | null;
  parentId: string | null;
  unit: string | null;
  defaultLocationId: string | null;
  quantity: number | null;
  minStock: number | null;
  targetStock: number | null;
  reference: string | null;
};
type Key = keyof Draft;
type Edits = Record<string, Partial<Draft>>;
type Option = { value: string; label: string };

const original = (p: Product): Draft => ({
  name: p.name,
  brand: p.brand,
  categoryId: p.categoryId,
  parentId: p.parentId,
  unit: p.unit,
  defaultLocationId: p.defaultLocationId,
  quantity: p.quantity,
  minStock: p.minStock,
  targetStock: p.targetStock,
  reference: p.reference,
});

/** Colonnes éditables, dans l'ordre (sert aussi à la navigation au clavier). */
const COLS: Key[] = ["name", "brand", "categoryId", "parentId", "unit", "defaultLocationId", "quantity", "minStock", "targetStock", "reference"];

/** Champs modifiables d'un coup sur la sélection. */
const BULK_FIELDS: { key: Key; label: string }[] = [
  { key: "categoryId", label: "Catégorie" },
  { key: "parentId", label: "Famille (générique)" },
  { key: "defaultLocationId", label: "Emplacement habituel" },
  { key: "unit", label: "Unité" },
  { key: "minStock", label: "Seuil mini" },
  { key: "targetStock", label: "Stock cible" },
  { key: "brand", label: "Marque" },
];

type SortKey = "name" | "brand" | "category" | "family" | "location" | "quantity" | "status";
const STATUS_RANK = { out: 0, low: 1, watch: 2, ok: 3, none: 4 } as const;

const treeOptions = (items: (Category | Location)[]): Option[] =>
  flattenTree(items).map((n) => ({ value: n.id, label: `${"   ".repeat(n.depth)}${n.icon ? `${n.icon} ` : ""}${n.name || "Sans nom"}` }));

const cellCls = "w-full min-w-0 rounded-md bg-transparent px-2 py-1.5 outline-none focus:bg-surface focus:ring-2 focus:ring-brand";

/**
 * Vue tableur (PC) : toutes les fiches produits sur une grille, modifiables en
 * masse puis enregistrées d'un seul coup.
 */
export function BulkEditPage() {
  const products = useProducts();
  const categories = useCategories();
  const locations = useLocations();
  const bulk = useBulkProducts();
  const { ask, dialog } = useConfirm();

  const cats = useMemo(() => (categories.data ?? []).filter((c) => c.kind === "product"), [categories.data]);
  const locs = useMemo(() => locations.data ?? [], [locations.data]);
  const catOptions = useMemo(() => treeOptions(cats), [cats]);
  const locOptions = useMemo(() => treeOptions(locs), [locs]);

  const [edits, setEdits] = useState<Edits>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  // Familles : dans les lignes, les génériques existants ; dans la barre de sélection,
  // n'importe quel produit sans famille (il devient alors générique).
  const headIds = useMemo(() => new Set((products.data ?? []).map((p) => p.parentId).filter((v): v is string => !!v)), [products.data]);
  const headOptions = useMemo(
    () => [...headIds].map((id) => ({ value: id, label: byId.get(id)?.name || "Sans nom" })).sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [headIds, byId],
  );
  const familyOptions = useMemo(
    () => (products.data ?? []).filter((p) => !p.parentId).map((p) => ({ value: p.id, label: `${p.name || "Sans nom"}${headIds.has(p.id) ? " (générique)" : ""}` })),
    [products.data, headIds],
  );
  const changedCount = Object.keys(edits).length;
  const dirty = changedCount > 0;

  const setCell = useCallback(
    (id: string, key: Key, value: Draft[Key]) => {
      const p = byId.get(id);
      if (!p) return;
      // Texte vide = champ vidé (sauf le nom, qui reste une chaîne).
      const v = typeof value === "string" && key !== "name" && !value.trim() ? null : value;
      setEdits((prev) => {
        const row = { ...prev[id] };
        if (v === original(p)[key]) delete row[key];
        else (row as Record<Key, unknown>)[key] = v;
        const next = { ...prev };
        if (Object.keys(row).length) next[id] = row;
        else delete next[id];
        return next;
      });
    },
    [byId],
  );

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const rows = useMemo(() => {
    let list = products.data ?? [];
    if (q.trim()) list = list.filter((p) => matches(p.name, q) || matches(p.brand, q) || matches(p.reference, q));
    if (catFilter === "_none") list = list.filter((p) => !p.categoryId);
    else if (catFilter) {
      const ids = descendantIds(cats, catFilter);
      list = list.filter((p) => p.categoryId && ids.has(p.categoryId));
    }
    if (locFilter === "_none") list = list.filter((p) => !p.defaultLocationId && p.stock.every((s) => !s.locationId));
    else if (locFilter) {
      const ids = descendantIds(locs, locFilter);
      list = list.filter((p) => (p.defaultLocationId && ids.has(p.defaultLocationId)) || p.stock.some((s) => s.locationId && ids.has(s.locationId)));
    }
    if (onlyChanged) list = list.filter((p) => edits[p.id]);
    // Tri sur les valeurs enregistrées : les lignes ne sautent pas pendant la saisie.
    const val = (p: Product): string | number => {
      switch (sort.key) {
        case "name":
          return p.name.toLocaleLowerCase("fr");
        case "brand":
          return (p.brand ?? "￿").toLocaleLowerCase("fr");
        case "category":
          return p.categoryId ? pathLabel(cats, p.categoryId).toLocaleLowerCase("fr") : "￿";
        case "family":
          return (byId.get(p.parentId ?? (headIds.has(p.id) ? p.id : ""))?.name ?? "￿").toLocaleLowerCase("fr");
        case "location":
          return p.defaultLocationId ? pathLabel(locs, p.defaultLocationId).toLocaleLowerCase("fr") : "￿";
        case "quantity":
          return p.quantity ?? Infinity;
        case "status":
          return STATUS_RANK[p.status];
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
      return d * sort.dir || a.name.localeCompare(b.name, "fr");
    });
    // `edits` seulement pour le filtre « modifiés » : inutile de retrier à chaque frappe sinon.
  }, [products.data, q, catFilter, locFilter, onlyChanged, onlyChanged ? edits : null, sort, cats, locs, byId, headIds]);

  /** Poignée de recopie : la valeur (modifiée ou non) de la ligne source va sur les lignes visées. */
  function onFill(c: number, from: number, to: number[]) {
    const key = COLS[c];
    const src = rows[from];
    if (!key || !src) return;
    const value = { ...original(src), ...edits[src.id] }[key];
    for (const t of to) {
      const p = rows[t];
      // Quantité répartie sur plusieurs emplacements : non modifiable ici. Un générique n'a pas de famille.
      if (!p || (key === "quantity" && p.stock.length > 1) || (key === "parentId" && (headIds.has(p.id) || value === p.id))) continue;
      setCell(p.id, key, value);
    }
  }

  const allSelected = rows.length > 0 && rows.every((p) => selected.has(p.id));

  async function save() {
    if (!dirty || bulk.isPending) return;
    const updates: BulkUpdate[] = Object.entries(edits).map(([id, e]) => ({ id, ...e }));
    bulk.mutate({ updates }, { onSuccess: () => setEdits({}) });
  }

  async function removeSelected() {
    const ids = [...selected];
    const ok = await ask(`Supprimer ${ids.length} produit${ids.length > 1 ? "s" : ""} ?`, {
      message: "Leur stock et leur historique disparaissent. Les recettes gardent le nom de l'ingrédient.",
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

  // Ctrl+S enregistre ; fermeture de l'onglet avec des modifications : avertissement du navigateur.
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

  /** Entrée / flèches haut-bas : même colonne, ligne suivante ou précédente. */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
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

  return (
    <>
      <div className="lg:hidden">
        <PageHeader back="/stock" title="Édition en masse" />
        <EmptyState icon={<Monitor className="size-12 text-ink-3" />} title="Vue réservée à l'ordinateur">
          <p>Ouvrez Foyer sur un écran plus large pour modifier vos produits en tableau.</p>
          <Link to="/stock" className="btn-primary mt-4">
            Retour au stock
          </Link>
        </EmptyState>
      </div>

      <div className="hidden h-dvh flex-col lg:flex">
        <PageHeader
          back="/stock"
          title="Édition en masse"
          subtitle={products.data ? `${rows.length} / ${products.data.length} produits · Entrée pour descendre, tirer le coin d'une cellule pour recopier, Ctrl+S pour enregistrer` : undefined}
          actions={
            <div className="flex items-center gap-2 pr-2">
              {dirty && (
                <button className="btn-ghost" onClick={() => setEdits({})} disabled={bulk.isPending}>
                  <Undo2 className="size-4" /> Annuler
                </button>
              )}
              <button className="btn-primary" onClick={save} disabled={!dirty || bulk.isPending}>
                {bulk.isPending ? <Spinner className="text-brand-ink" /> : <Save className="size-4" />}
                Enregistrer{dirty ? ` (${changedCount})` : ""}
              </button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <label className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input className="input py-2 pl-9" type="search" placeholder="Nom, marque, référence…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="input w-56 py-2" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filtrer par catégorie">
            <option value="">Toutes les catégories</option>
            {catOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="_none">Sans catégorie</option>
          </select>
          <select className="input w-56 py-2" value={locFilter} onChange={(e) => setLocFilter(e.target.value)} aria-label="Filtrer par emplacement">
            <option value="">Tous les emplacements</option>
            {locOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="_none">Sans emplacement</option>
          </select>
          <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
            <input type="checkbox" className="size-4 accent-brand" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
            Modifiés uniquement
          </label>
        </div>

        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            catOptions={catOptions}
            locOptions={locOptions}
            familyOptions={familyOptions}
            onApply={(key, value) =>
              selected.forEach((id) => {
                // Un générique ne peut pas entrer dans une famille, ni un produit dans la sienne.
                if (key === "parentId" && (headIds.has(id) || value === id)) return;
                setCell(id, key, value);
              })
            }
            onDelete={removeSelected}
            onClear={() => setSelected(new Set())}
            busy={bulk.isPending}
          />
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-t border-line">
          {products.isPending ? (
            <PageLoader />
          ) : rows.length === 0 ? (
            <EmptyState icon="🔍" title="Aucun produit ne correspond" />
          ) : (
            <div ref={gridRef} className="relative">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 w-10 border-b border-line bg-surface-2 px-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      aria-label="Tout sélectionner"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((p) => p.id)))}
                    />
                  </th>
                  {header("name", "Nom", "min-w-56")}
                  {header("brand", "Marque", "min-w-32")}
                  {header("category", "Catégorie", "min-w-44")}
                  {header("family", "Famille", "min-w-40")}
                  {header(null, "Unité", "w-28")}
                  {header("location", "Empl. habituel", "min-w-44")}
                  {header("quantity", "Quantité", "w-36")}
                  {header(null, "Seuil mini", "w-24")}
                  {header(null, "Cible", "w-24")}
                  {header(null, "Référence", "min-w-28")}
                  {header("status", "Statut", "w-32")}
                  <th className="sticky top-0 z-10 w-10 border-b border-line bg-surface-2" />
                </tr>
              </thead>
              <tbody ref={tableRef} onKeyDown={onKeyDown}>
                {rows.map((p, i) => (
                  <Row
                    key={p.id}
                    p={p}
                    index={i}
                    edit={edits[p.id]}
                    selected={selected.has(p.id)}
                    catOptions={catOptions}
                    locOptions={locOptions}
                    headOptions={headOptions}
                    childCount={headIds.has(p.id) ? (products.data ?? []).filter((x) => x.parentId === p.id).length : 0}
                    locs={locs}
                    onChange={setCell}
                    onToggle={toggle}
                  />
                ))}
              </tbody>
            </table>
            <FillHandle container={gridRef} scroller={scrollRef} onFill={onFill} />
            </div>
          )}
        </div>
      </div>

      <datalist id="bulk-units">
        {STOCK_UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      {dialog}
      <Sheet open={blocker.state === "blocked"} onClose={() => blocker.reset?.()} title="Quitter sans enregistrer ?">
        <p className="mb-5 text-ink-2">
          {changedCount} produit{changedCount > 1 ? "s" : ""} modifié{changedCount > 1 ? "s" : ""} n'
          {changedCount > 1 ? "ont" : "a"} pas été enregistré{changedCount > 1 ? "s" : ""}.
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

// ─── Ligne du tableau ────────────────────────────────────────────────────────

type RowProps = {
  p: Product;
  index: number;
  edit: Partial<Draft> | undefined;
  selected: boolean;
  catOptions: Option[];
  locOptions: Option[];
  /** Génériques existants. */
  headOptions: Option[];
  /** Nombre de déclinaisons si ce produit est un générique. */
  childCount: number;
  locs: Location[];
  onChange: (id: string, key: Key, value: Draft[Key]) => void;
  onToggle: (id: string) => void;
};

const Row = memo(function Row({ p, index, edit, selected, catOptions, locOptions, headOptions, childCount, locs, onChange, onToggle }: RowProps) {
  const d = { ...original(p), ...edit };
  const changed = (k: Key) => !!edit && k in edit;
  const td = (k: Key) => `border-b border-line px-0.5 py-0.5 ${changed(k) ? "bg-brand-soft" : ""}`;
  const nav = (k: Key) => ({ "data-r": index, "data-c": COLS.indexOf(k) });
  const set = <K extends Key>(k: K, v: Draft[K]) => onChange(p.id, k, v);
  // Quantité répartie sur plusieurs emplacements : on la corrige depuis la fiche.
  const split = p.stock.length > 1;

  return (
    <tr className={selected ? "bg-surface-2" : "hover:bg-surface-2/50"}>
      <td className="border-b border-line px-3">
        <input type="checkbox" className="size-4 accent-brand" checked={selected} onChange={() => onToggle(p.id)} aria-label={`Sélectionner ${p.name}`} />
      </td>
      <td className={td("name")}>
        <input className={`${cellCls} font-semibold`} value={d.name} placeholder="Sans nom" onChange={(e) => set("name", e.target.value)} {...nav("name")} />
      </td>
      <td className={td("brand")}>
        <input className={cellCls} value={d.brand ?? ""} onChange={(e) => set("brand", e.target.value)} {...nav("brand")} />
      </td>
      <td className={td("categoryId")}>
        <select className={cellCls} value={d.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)} {...nav("categoryId")}>
          <option value="">—</option>
          {catOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className={td("parentId")}>
        {childCount > 0 ? (
          <span className="block px-2 py-1.5 whitespace-nowrap text-ink-2" title="Produit générique : ses déclinaisons se gèrent depuis sa fiche">
            Générique <span className="text-xs text-ink-3">({childCount})</span>
          </span>
        ) : (
          <select className={cellCls} value={d.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)} {...nav("parentId")}>
            <option value="">—</option>
            {/* Le générique actuel reste proposé même s'il n'a plus d'autre déclinaison. */}
            {[...headOptions, ...(p.parentId && !headOptions.some((o) => o.value === p.parentId) ? [{ value: p.parentId, label: "(générique actuel)" }] : [])].map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className={td("unit")}>
        <input className={cellCls} list="bulk-units" value={d.unit ?? ""} placeholder="pièce" onChange={(e) => set("unit", e.target.value)} {...nav("unit")} />
      </td>
      <td className={td("defaultLocationId")}>
        <select className={cellCls} value={d.defaultLocationId ?? ""} onChange={(e) => set("defaultLocationId", e.target.value || null)} {...nav("defaultLocationId")}>
          <option value="">—</option>
          {locOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className={td("quantity")}>
        {split ? (
          <span
            className="block px-2 py-1.5 text-right whitespace-nowrap text-ink-2"
            title={p.stock.map((s) => `${s.locationId ? pathLabel(locs, s.locationId) : "Sans emplacement"} : ${formatQty(s.quantity, p.unit)}`).join("\n")}
          >
            {formatQty(p.quantity, p.unit)} <span className="text-xs text-ink-3">({p.stock.length} empl.)</span>
          </span>
        ) : (
          <NumberInput className={`${cellCls} text-right`} value={d.quantity} onChange={(v) => set("quantity", v)} {...nav("quantity")} />
        )}
      </td>
      <td className={td("minStock")}>
        <NumberInput className={`${cellCls} text-right`} value={d.minStock} onChange={(v) => set("minStock", v)} {...nav("minStock")} />
      </td>
      <td className={td("targetStock")}>
        <NumberInput className={`${cellCls} text-right`} value={d.targetStock} onChange={(v) => set("targetStock", v)} {...nav("targetStock")} />
      </td>
      <td className={td("reference")}>
        <input className={cellCls} value={d.reference ?? ""} onChange={(e) => set("reference", e.target.value)} {...nav("reference")} />
      </td>
      <td className="border-b border-line px-2">
        <StatusBadge status={stockStatus(split ? p.quantity : d.quantity, d.minStock)} />
      </td>
      <td className="border-b border-line px-2">
        <Link to={`/produits/${p.id}`} className="text-ink-3 hover:text-brand" aria-label="Ouvrir la fiche" title="Ouvrir la fiche">
          <ExternalLink className="size-4" />
        </Link>
      </td>
    </tr>
  );
});

// ─── Actions sur la sélection ────────────────────────────────────────────────

function BulkBar({
  count,
  catOptions,
  locOptions,
  familyOptions,
  onApply,
  onDelete,
  onClear,
  busy,
}: {
  count: number;
  catOptions: Option[];
  locOptions: Option[];
  familyOptions: Option[];
  onApply: (key: Key, value: Draft[Key]) => void;
  onDelete: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const [field, setField] = useState<Key>("categoryId");
  const [text, setText] = useState("");
  const [num, setNum] = useState<number | null>(null);
  const isNum = field === "minStock" || field === "targetStock";
  const options = field === "categoryId" ? catOptions : field === "defaultLocationId" ? locOptions : field === "parentId" ? familyOptions : null;

  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-3 py-2">
      <span className="text-sm font-semibold">
        {count} sélectionné{count > 1 ? "s" : ""} :
      </span>
      <select
        className="input w-48 py-1.5"
        value={field}
        onChange={(e) => {
          setField(e.target.value as Key);
          setText("");
          setNum(null);
        }}
        aria-label="Champ à modifier"
      >
        {BULK_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <span className="text-sm text-ink-2">devient</span>
      {options ? (
        <select className="input w-56 py-1.5" value={text} onChange={(e) => setText(e.target.value)} aria-label="Nouvelle valeur">
          <option value="">— aucun —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : isNum ? (
        <NumberInput className="input w-28 py-1.5" value={num} onChange={setNum} placeholder="vide" aria-label="Nouvelle valeur" />
      ) : (
        <input
          className="input w-44 py-1.5"
          list={field === "unit" ? "bulk-units" : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="vide"
          aria-label="Nouvelle valeur"
        />
      )}
      <button className="btn-primary py-1.5" onClick={() => onApply(field, isNum ? num : text || null)}>
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
