import { ArrowDown, ArrowUp, ClipboardList, Plus, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Field, NumberInput, PageHeader, PageLoader, Sheet, Spinner } from "@/components/ui";
import { UNIT_SUGGESTIONS } from "@/lib/format";
import { parseIngredientLine } from "@/lib/ingredients";
import { useCategories, useProducts, useRecipe, useSaveRecipe } from "@/lib/queries";
import type { Ingredient, Recipe, RecipeInput } from "@/lib/types";

type Row = Omit<Ingredient, "id"> & { key: string };
type StepRow = { key: string; text: string };
const newKey = () => Math.random().toString(36).slice(2);

type Draft = {
  name: string;
  photoId: string | null;
  description: string;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: number | null;
  categoryIds: string[];
  tags: string[];
  ingredients: Row[];
  steps: StepRow[];
  notes: string;
};

function toDraft(r?: Recipe, name = ""): Draft {
  return {
    name: r?.name ?? name,
    photoId: r?.photoId ?? null,
    description: r?.description ?? "",
    servings: r?.servings ?? null,
    prepMinutes: r?.prepMinutes ?? null,
    cookMinutes: r?.cookMinutes ?? null,
    difficulty: r?.difficulty ?? null,
    categoryIds: r?.categoryIds ?? [],
    tags: r?.tags ?? [],
    ingredients: (r?.ingredients ?? []).map(({ id: _id, ...i }) => ({ ...i, key: newKey() })),
    steps: (r?.steps ?? []).map((s) => ({ key: newKey(), text: s.text })),
    notes: r?.notes ?? "",
  };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

export function RecipeEditPage() {
  const { id } = useParams();
  const recipe = useRecipe(id ?? "");
  if (id && recipe.isPending) return <PageLoader />;
  return <RecipeForm key={id ?? "new"} recipe={id ? recipe.data : undefined} />;
}

function RecipeForm({ recipe }: { recipe?: Recipe }) {
  const location = useLocation();
  const [d, setD] = useState<Draft>(() => toDraft(recipe, (location.state as { name?: string } | null)?.name));
  const [tagText, setTagText] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const categories = useCategories();
  const products = useProducts();
  const save = useSaveRecipe();
  const navigate = useNavigate();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const recipeCats = (categories.data ?? []).filter((c) => c.kind === "recipe");

  function addTag(raw: string) {
    const t = raw.trim().replace(/^#/, "");
    if (t && !d.tags.includes(t)) set("tags", [...d.tags, t]);
    setTagText("");
  }

  function updateRow(key: string, patch: Partial<Row>) {
    set("ingredients", d.ingredients.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function importLines() {
    const rows = (paste ?? "").split("\n").map(parseIngredientLine).filter((x) => x !== null).map((x) => ({ ...x, key: newKey() }));
    set("ingredients", [...d.ingredients.filter((r) => r.name || r.quantity != null), ...rows]);
    setPaste(null);
    if (rows.length) toast.success(`${rows.length} ingrédient(s) ajouté(s)`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pendingTag = tagText.trim();
    const data: RecipeInput = {
      name: d.name,
      photoId: d.photoId,
      description: d.description,
      servings: d.servings,
      prepMinutes: d.prepMinutes,
      cookMinutes: d.cookMinutes,
      difficulty: d.difficulty,
      categoryIds: d.categoryIds,
      tags: pendingTag ? [...d.tags, pendingTag.replace(/^#/, "")] : d.tags,
      ingredients: d.ingredients.map(({ key: _k, ...i }) => i).filter((i) => i.name.trim() || i.quantity != null),
      steps: d.steps.map((s) => ({ text: s.text })).filter((s) => s.text.trim()),
      notes: d.notes,
    };
    const saved = await save.mutateAsync({ id: recipe?.id, data });
    toast.success("Recette enregistrée");
    navigate(`/recettes/${saved.id}`, { replace: true });
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        back
        title={recipe ? "Modifier la recette" : "Nouvelle recette"}
        actions={
          <button className="btn-primary min-h-10 px-4" disabled={save.isPending}>
            {save.isPending ? <Spinner className="text-brand-ink" /> : "Enregistrer"}
          </button>
        }
      />
      <datalist id="units">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id="product-names">{(products.data ?? []).filter((p) => p.name).map((p) => <option key={p.id} value={p.name} />)}</datalist>

      <div className="space-y-6 px-4 pb-8">
        <Field label="Nom">{(fid) => <input id={fid} className="input text-lg font-semibold" placeholder="Ex. Tartiflette" value={d.name} onChange={(e) => set("name", e.target.value)} />}</Field>

        <PhotoPicker value={d.photoId} onChange={(v) => set("photoId", v)} fallback="🍽️" />

        <Field label="Description">{(fid) => <textarea id={fid} className="input min-h-20" value={d.description} onChange={(e) => set("description", e.target.value)} />}</Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Portions">{(fid) => <NumberInput id={fid} value={d.servings} onChange={(v) => set("servings", v)} placeholder="4" />}</Field>
          <Field label="Prépa (min)">{(fid) => <NumberInput id={fid} integer value={d.prepMinutes} onChange={(v) => set("prepMinutes", v)} placeholder="15" />}</Field>
          <Field label="Cuisson (min)">{(fid) => <NumberInput id={fid} integer value={d.cookMinutes} onChange={(v) => set("cookMinutes", v)} placeholder="30" />}</Field>
        </div>

        <div>
          <span className="label">Difficulté</span>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <button type="button" key={n} className={`chip justify-center ${d.difficulty === n ? "chip-on" : ""}`} onClick={() => set("difficulty", d.difficulty === n ? null : n)}>
                {["", "Facile", "Moyen", "Difficile"][n]}
              </button>
            ))}
          </div>
        </div>

        {recipeCats.length > 0 && (
          <div>
            <span className="label">Catégories</span>
            <div className="flex flex-wrap gap-2">
              {recipeCats.map((c) => {
                const on = d.categoryIds.includes(c.id);
                return (
                  <button type="button" key={c.id} className={`chip ${on ? "chip-on" : ""}`} onClick={() => set("categoryIds", on ? d.categoryIds.filter((x) => x !== c.id) : [...d.categoryIds, c.id])}>
                    {c.icon} {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <span className="label">Tags</span>
          <div className="flex flex-wrap gap-2">
            {d.tags.map((t) => (
              <span key={t} className="chip pr-1.5">
                #{t}
                <button type="button" className="rounded-full p-0.5 hover:bg-surface-2" onClick={() => set("tags", d.tags.filter((x) => x !== t))} aria-label={`Retirer ${t}`}>
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            <input
              className="input min-w-32 flex-1 py-2"
              placeholder="rapide, végé…"
              value={tagText}
              onChange={(e) => (e.target.value.endsWith(",") ? addTag(e.target.value.slice(0, -1)) : setTagText(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagText);
                }
              }}
              onBlur={() => tagText && addTag(tagText)}
            />
          </div>
        </div>

        {/* Ingrédients */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">Ingrédients</h2>
            <button type="button" className="btn-ghost min-h-9 px-2 text-sm" onClick={() => setPaste("")}>
              <ClipboardList className="size-4" /> Coller une liste
            </button>
          </div>
          <div className="space-y-2">
            {d.ingredients.map((row, idx) => (
              <div key={row.key} className="card p-2">
                <div className="flex gap-2">
                  <input
                    className="input flex-1 py-2.5"
                    list="product-names"
                    placeholder="Ingrédient"
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value, productId: null })}
                    aria-label="Ingrédient"
                  />
                  <button type="button" className="icon-btn size-10" onClick={() => set("ingredients", d.ingredients.filter((r) => r.key !== row.key))} aria-label="Retirer l'ingrédient">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <NumberInput className="input w-20 py-2" value={row.quantity} onChange={(v) => updateRow(row.key, { quantity: v })} placeholder="Qté" />
                  <input className="input w-24 py-2" list="units" placeholder="Unité" value={row.unit ?? ""} onChange={(e) => updateRow(row.key, { unit: e.target.value || null })} aria-label="Unité" />
                  <input className="input flex-1 py-2" placeholder="Précision" value={row.note ?? ""} onChange={(e) => updateRow(row.key, { note: e.target.value || null })} aria-label="Précision" />
                  <div className="flex flex-col">
                    <button type="button" className="px-1 text-ink-3 disabled:opacity-30" disabled={idx === 0} onClick={() => set("ingredients", move(d.ingredients, idx, idx - 1))} aria-label="Monter">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" className="px-1 text-ink-3 disabled:opacity-30" disabled={idx === d.ingredients.length - 1} onClick={() => set("ingredients", move(d.ingredients, idx, idx + 1))} aria-label="Descendre">
                      <ArrowDown className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn-soft w-full" onClick={() => set("ingredients", [...d.ingredients, { key: newKey(), name: "", productId: null, quantity: null, unit: null, note: null }])}>
              <Plus className="size-4" /> Ajouter un ingrédient
            </button>
          </div>
        </section>

        {/* Étapes */}
        <section>
          <h2 className="mb-2 text-lg font-bold">Étapes</h2>
          <div className="space-y-2">
            {d.steps.map((s, idx) => (
              <div key={s.key} className="flex gap-2">
                <span className="mt-2.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">{idx + 1}</span>
                <textarea
                  className="input min-h-20 flex-1"
                  placeholder="Décrivez l'étape…"
                  value={s.text}
                  onChange={(e) => set("steps", d.steps.map((x) => (x.key === s.key ? { ...x, text: e.target.value } : x)))}
                  aria-label={`Étape ${idx + 1}`}
                />
                <div className="flex flex-col items-center">
                  <button type="button" className="icon-btn size-9" onClick={() => set("steps", d.steps.filter((x) => x.key !== s.key))} aria-label="Retirer l'étape">
                    <X className="size-4" />
                  </button>
                  <button type="button" className="p-1 text-ink-3 disabled:opacity-30" disabled={idx === 0} onClick={() => set("steps", move(d.steps, idx, idx - 1))} aria-label="Monter">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" className="p-1 text-ink-3 disabled:opacity-30" disabled={idx === d.steps.length - 1} onClick={() => set("steps", move(d.steps, idx, idx + 1))} aria-label="Descendre">
                    <ArrowDown className="size-4" />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="btn-soft w-full" onClick={() => set("steps", [...d.steps, { key: newKey(), text: "" }])}>
              <Plus className="size-4" /> Ajouter une étape
            </button>
          </div>
        </section>

        <Field label="Notes personnelles">{(fid) => <textarea id={fid} className="input min-h-24" placeholder="Astuces, variantes…" value={d.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>

        <button className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? <Spinner className="text-brand-ink" /> : "Enregistrer la recette"}
        </button>
      </div>

      <Sheet open={paste !== null} onClose={() => setPaste(null)} title="Coller une liste d'ingrédients">
        <p className="mb-3 text-sm text-ink-2">Une ligne par ingrédient. Ex. « 500 ml de lait », « 3 œufs », « Sel ».</p>
        <textarea className="input min-h-48 font-mono text-sm" autoFocus value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} placeholder={"250 g de farine\n3 œufs\n500 ml de lait\n1 pincée de sel"} />
        <button type="button" className="btn-primary mt-3 w-full" onClick={importLines}>
          Ajouter à la recette
        </button>
      </Sheet>
    </form>
  );
}
