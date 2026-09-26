import { Camera, ChevronLeft, Copy, Heart, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { roundQty } from "../../shared/stock";
import { PageLoader, Spinner, Thumb, useConfirm } from "@/components/ui";
import { DIFFICULTY, formatMinutes, formatQty } from "@/lib/format";
import { uploadPhoto } from "@/lib/image";
import { useCategories, useDeleteRecipe, useDuplicateRecipe, useProducts, useRecipe, useSaveRecipe, useToggleFavorite } from "@/lib/queries";

export function RecipeDetailPage() {
  const { id = "" } = useParams();
  const recipe = useRecipe(id);
  const categories = useCategories();
  const products = useProducts();
  const fav = useToggleFavorite();
  const save = useSaveRecipe();
  const dup = useDuplicateRecipe();
  const del = useDeleteRecipe();
  const navigate = useNavigate();
  const { ask, dialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [servings, setServings] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());

  const stockByProduct = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  if (recipe.isPending) return <PageLoader />;
  if (!recipe.data) {
    return (
      <div className="p-8 text-center">
        <p className="text-ink-2">Recette introuvable.</p>
        <Link to="/recettes" className="btn-soft mt-4">
          Retour aux recettes
        </Link>
      </div>
    );
  }
  const r = recipe.data;
  const baseServings = r.servings;
  const shownServings = servings ?? baseServings;
  const factor = baseServings && shownServings ? shownServings / baseServings : 1;
  const cats = (categories.data ?? []).filter((c) => r.categoryIds.includes(c.id));
  const meta = [
    r.servings != null && `👥 ${formatQty(shownServings)} portion${(shownServings ?? 0) > 1 ? "s" : ""}`,
    r.prepMinutes != null && `🔪 ${formatMinutes(r.prepMinutes)}`,
    r.cookMinutes != null && `🔥 ${formatMinutes(r.cookMinutes)}`,
    r.difficulty != null && `📊 ${DIFFICULTY[r.difficulty]}`,
  ].filter(Boolean) as string[];

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const p = await uploadPhoto(file);
      await save.mutateAsync({ id: r.id, data: { photoId: p.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete() {
    if (!(await ask(`Supprimer « ${r.name || "cette recette"} » ?`, { message: "La recette, ses ingrédients et ses étapes seront supprimés. Les produits du stock ne sont pas touchés." }))) return;
    await del.mutateAsync(r.id);
    toast.success("Recette supprimée");
    navigate("/recettes", { replace: true });
  }

  return (
    <div>
      {/* Couverture */}
      <div className="relative">
        <Thumb photoId={r.photoId} variant="full" alt={r.name} fallback={<span className="text-6xl">🍽️</span>} className="aspect-[4/3] max-h-[50dvh] w-full sm:rounded-b-3xl" />
        <div className="pt-safe absolute inset-x-0 top-0 flex items-center justify-between p-2">
          <button className="icon-btn bg-black/35 text-white backdrop-blur-sm" onClick={() => (history.length > 1 ? navigate(-1) : navigate("/recettes"))} aria-label="Retour">
            <ChevronLeft className="size-6" />
          </button>
          <div className="flex gap-2">
            <button className="icon-btn bg-black/35 text-white backdrop-blur-sm" onClick={() => fileRef.current?.click()} aria-label={r.photoId ? "Changer la photo" : "Ajouter une photo"}>
              {uploading ? <Spinner className="text-white" /> : <Camera className="size-5" />}
            </button>
            <button className="icon-btn bg-black/35 text-white backdrop-blur-sm" onClick={() => fav.mutate({ id: r.id, favorite: !r.favorite })} aria-label="Favori">
              <Heart className={`size-5 ${r.favorite ? "fill-current text-rose-400" : ""}`} />
            </button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
      </div>

      <div className="space-y-6 px-4 pt-4">
        <div>
          <h1 className="text-2xl leading-tight font-bold tracking-tight">{r.name || "Recette sans nom"}</h1>
          {(cats.length > 0 || r.tags.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cats.map((c) => (
                <span key={c.id} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
                  {c.icon} {c.name}
                </span>
              ))}
              {r.tags.map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2">
                  #{t}
                </span>
              ))}
            </div>
          )}
          {meta.length > 0 && <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">{meta.map((m) => <span key={m}>{m}</span>)}</p>}
          {r.description && <p className="mt-3 whitespace-pre-line text-ink-2">{r.description}</p>}
        </div>

        {/* Ingrédients */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">Ingrédients</h2>
            {baseServings != null && r.ingredients.some((i) => i.quantity != null) && (
              <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
                <button className="flex size-8 items-center justify-center rounded-full bg-surface" onClick={() => setServings(Math.max(1, Math.round((shownServings ?? 1) - 1)))} aria-label="Moins de portions">
                  <Minus className="size-4" />
                </button>
                <span className="min-w-16 text-center text-sm font-semibold">{formatQty(shownServings)} pers.</span>
                <button className="flex size-8 items-center justify-center rounded-full bg-surface" onClick={() => setServings(Math.round((shownServings ?? 0) + 1))} aria-label="Plus de portions">
                  <Plus className="size-4" />
                </button>
              </div>
            )}
          </div>
          {r.ingredients.length === 0 ? (
            <Link to={`/recettes/${r.id}/modifier`} className="card block p-4 text-center text-sm text-ink-2">
              Aucun ingrédient — <span className="font-semibold text-brand">en ajouter</span>
            </Link>
          ) : (
            <ul className="card divide-y divide-line">
              {r.ingredients.map((i, idx) => {
                const p = i.productId ? stockByProduct.get(i.productId) : undefined;
                const inStock = p?.quantity != null && p.quantity > 0;
                return (
                  <li key={i.id ?? idx} className="flex items-center gap-3 px-4 py-3">
                    <span className={`size-2 shrink-0 rounded-full ${inStock ? "bg-ok" : "bg-line"}`} title={inStock ? "En stock" : undefined} />
                    <span className="flex-1">
                      {p ? (
                        <Link to={`/produits/${p.id}`} className="font-medium">
                          {i.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{i.name}</span>
                      )}
                      {i.note && <span className="text-sm text-ink-3"> · {i.note}</span>}
                    </span>
                    {(i.quantity != null || i.unit) && (
                      <span className="text-right font-semibold tabular-nums text-ink-2">{formatQty(i.quantity != null ? roundQty(i.quantity * factor) : null, i.unit)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Étapes */}
        <section>
          <h2 className="mb-2 text-lg font-bold">Préparation</h2>
          {r.steps.length === 0 ? (
            <Link to={`/recettes/${r.id}/modifier`} className="card block p-4 text-center text-sm text-ink-2">
              Aucune étape — <span className="font-semibold text-brand">en ajouter</span>
            </Link>
          ) : (
            <ol className="space-y-2">
              {r.steps.map((s, idx) => {
                const isDone = done.has(idx);
                return (
                  <li key={s.id}>
                    <button
                      className={`card flex w-full gap-3 p-4 text-left transition ${isDone ? "opacity-50" : ""}`}
                      onClick={() => setDone((d) => { const n = new Set(d); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })}
                      aria-pressed={isDone}
                    >
                      <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isDone ? "bg-ok text-white" : "bg-brand-soft text-brand"}`}>{isDone ? "✓" : idx + 1}</span>
                      <span className={`whitespace-pre-line ${isDone ? "line-through" : ""}`}>{s.text}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {r.notes && (
          <section>
            <h2 className="mb-2 text-lg font-bold">Notes</h2>
            <p className="card whitespace-pre-line bg-watch-soft/50 p-4 text-ink-2">{r.notes}</p>
          </section>
        )}

        <div className="grid grid-cols-3 gap-2 pb-4">
          <Link to={`/recettes/${r.id}/modifier`} className="btn-primary">
            <Pencil className="size-4" /> Modifier
          </Link>
          <button
            className="btn-soft"
            disabled={dup.isPending}
            onClick={async () => {
              const copy = await dup.mutateAsync(r.id);
              toast.success("Recette dupliquée");
              navigate(`/recettes/${copy.id}/modifier`);
            }}
          >
            <Copy className="size-4" /> Dupliquer
          </button>
          <button className="btn-danger" onClick={onDelete}>
            <Trash2 className="size-4" /> Supprimer
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
