import { type FormEvent, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Field, NumberInput, PageHeader, PageLoader, Spinner } from "@/components/ui";
import { UNIT_SUGGESTIONS } from "@/lib/format";
import { useCategories, useLocations, useProduct, useSaveProduct } from "@/lib/queries";
import { flattenTree } from "@/lib/tree";
import type { Product, ProductInput } from "@/lib/types";

export function ProductEditPage() {
  const { id } = useParams();
  const product = useProduct(id ?? "");
  if (id && product.isPending) return <PageLoader />;
  return <ProductForm key={id ?? "new"} product={id ? product.data : undefined} />;
}

function ProductForm({ product }: { product?: Product }) {
  const location = useLocation();
  const [d, setD] = useState({
    name: product?.name ?? (location.state as { name?: string } | null)?.name ?? "",
    photoId: product?.photoId ?? null,
    categoryId: product?.categoryId ?? "",
    unit: product?.unit ?? "",
    minStock: product?.minStock ?? null,
    targetStock: product?.targetStock ?? null,
    defaultLocationId: product?.defaultLocationId ?? "",
    brand: product?.brand ?? "",
    reference: product?.reference ?? "",
    notes: product?.notes ?? "",
    quantity: null as number | null,
  });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((s) => ({ ...s, [k]: v }));
  const categories = useCategories();
  const locations = useLocations();
  const save = useSaveProduct();
  const navigate = useNavigate();
  const cats = flattenTree((categories.data ?? []).filter((c) => c.kind === "product"));
  const locs = flattenTree(locations.data ?? []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const data: ProductInput = {
      name: d.name,
      photoId: d.photoId,
      categoryId: d.categoryId || null,
      unit: d.unit || null,
      minStock: d.minStock,
      targetStock: d.targetStock,
      defaultLocationId: d.defaultLocationId || null,
      brand: d.brand,
      reference: d.reference,
      notes: d.notes,
    };
    if (!product && d.quantity != null) {
      data.quantity = d.quantity;
      data.locationId = d.defaultLocationId || null;
    }
    const saved = await save.mutateAsync({ id: product?.id, data });
    toast.success("Produit enregistré");
    navigate(`/produits/${saved.id}`, { replace: true });
  }

  const thresholdsOdd = d.minStock != null && d.targetStock != null && d.targetStock < d.minStock;

  return (
    <form onSubmit={submit}>
      <PageHeader
        back
        title={product ? "Modifier le produit" : "Nouveau produit"}
        actions={
          <button className="btn-primary min-h-10 px-4" disabled={save.isPending}>
            {save.isPending ? <Spinner className="text-brand-ink" /> : "Enregistrer"}
          </button>
        }
      />
      <datalist id="units">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="space-y-5 px-4 pb-8">
        <Field label="Nom">{(fid) => <input id={fid} className="input text-lg font-semibold" placeholder="Ex. Lessive" value={d.name} onChange={(e) => set("name", e.target.value)} />}</Field>

        <PhotoPicker value={d.photoId} onChange={(v) => set("photoId", v)} fallback="📦" aspect="aspect-[16/9]" />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Catégorie">
            {(fid) => (
              <select id={fid} className="input" value={d.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">—</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {"  ".repeat(c.depth)}
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Unité">{(fid) => <input id={fid} className="input" list="units" placeholder="pièce, L, kg…" value={d.unit} onChange={(e) => set("unit", e.target.value)} />}</Field>
        </div>

        <Field label="Emplacement habituel">
          {(fid) => (
            <select id={fid} className="input" value={d.defaultLocationId} onChange={(e) => set("defaultLocationId", e.target.value)}>
              <option value="">—</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {"  ".repeat(l.depth)}
                  {l.icon} {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        {!product && (
          <Field label="Quantité actuelle" hint="Rangée à l'emplacement habituel. Laissez vide si vous ne savez pas.">
            {(fid) => <NumberInput id={fid} value={d.quantity} onChange={(v) => set("quantity", v)} placeholder="—" />}
          </Field>
        )}

        <div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock minimum">{(fid) => <NumberInput id={fid} value={d.minStock} onChange={(v) => set("minStock", v)} placeholder="—" />}</Field>
            <Field label="Stock cible">{(fid) => <NumberInput id={fid} value={d.targetStock} onChange={(v) => set("targetStock", v)} placeholder="—" />}</Field>
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {thresholdsOdd ? "⚠️ Le stock cible est inférieur au minimum." : "Sans minimum, aucune alerte n'est affichée pour ce produit."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Marque">{(fid) => <input id={fid} className="input" value={d.brand} onChange={(e) => set("brand", e.target.value)} />}</Field>
          <Field label="Référence">{(fid) => <input id={fid} className="input" value={d.reference} onChange={(e) => set("reference", e.target.value)} />}</Field>
        </div>

        <Field label="Notes">{(fid) => <textarea id={fid} className="input min-h-20" value={d.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>

        <button className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? <Spinner className="text-brand-ink" /> : "Enregistrer le produit"}
        </button>
      </div>
    </form>
  );
}
