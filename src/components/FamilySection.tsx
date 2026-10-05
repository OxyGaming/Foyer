import { Layers, Plus, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { convertQty } from "../../shared/units";
import { AlternativesSheet, ProductPickSheet } from "@/components/AlternativesSheet";
import { StatusBadge } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { useBulkProducts, useSaveProduct } from "@/lib/queries";
import type { Product } from "@/lib/types";

const stockLabel = (p: Product) => (p.quantity != null ? formatQty(p.quantity, p.unit) : p.stock.length ? "en stock" : "pas en stock");

/** Stock cumulé d'une famille dans l'unité du générique ; null si rien n'est comparable. */
export function familyStock(head: Product, members: Product[]): number | null {
  const parts = [head, ...members].map((m) => (m.quantity != null ? convertQty(m.quantity, m.unit, head.unit) : null)).filter((q): q is number => q != null);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) * 1000) / 1000 : null;
}

/**
 * Famille d'un produit : un générique (« Pâtes ») et ses déclinaisons
 * (spaghetti, coquillettes…). Une recette qui demande le générique accepte
 * toute la famille ; une recette qui demande « Spaghetti » n'accepte qu'eux.
 */
export function FamilySection({ product: p, products }: { product: Product; products: Product[] }) {
  const bulk = useBulkProducts();
  const save = useSaveProduct();
  const [picking, setPicking] = useState<"parent" | "children" | null>(null);
  const byId = useMemo(() => new Map(products.map((x) => [x.id, x])), [products]);
  const childrenOf = (id: string) => products.filter((x) => x.parentId === id).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const parent = p.parentId ? byId.get(p.parentId) : undefined;
  const children = childrenOf(p.id);
  const isHead = children.length > 0;
  const setParent = (ids: string[], parentId: string | null) => bulk.mutate({ updates: ids.map((id) => ({ id, parentId })) });

  async function attachToNew(name: string) {
    const head = await save.mutateAsync({ data: { name, unit: p.unit, categoryId: p.categoryId } });
    setPicking(null);
    if (head.id !== p.id) setParent([p.id], head.id);
  }

  const total = isHead ? familyStock(p, children) : null;

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
        <Layers className="size-5 text-ink-3" /> Famille
      </h2>
      {parent ? (
        <div className="card p-3">
          <p>
            Déclinaison de{" "}
            <Link to={`/produits/${parent.id}`} className="font-bold text-brand">
              {parent.name || "Sans nom"}
            </Link>
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            Une recette qui demande « {parent.name} » peut utiliser ce produit. Une recette qui demande « {p.name} » n'accepte que lui.
          </p>
          {childrenOf(parent.id).length > 1 && (
            <p className="mt-1 text-xs text-ink-3">
              Avec :{" "}
              {childrenOf(parent.id)
                .filter((c) => c.id !== p.id)
                .map((c) => c.name)
                .join(", ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <button className="btn-ghost min-h-9 px-2 text-sm" onClick={() => setPicking("parent")}>
              Changer de famille
            </button>
            <button className="btn-ghost min-h-9 px-2 text-sm text-danger" disabled={bulk.isPending} onClick={() => setParent([p.id], null)}>
              <X className="size-4" /> Retirer de la famille
            </button>
          </div>
        </div>
      ) : isHead ? (
        <div className="card">
          <div className="p-3">
            <p className="font-semibold">
              Produit générique · {children.length} déclinaison{children.length > 1 ? "s" : ""}
              {total != null && <span className="font-normal text-ink-2"> · {formatQty(total, p.unit)} en tout</span>}
            </p>
            <p className="mt-0.5 text-sm text-ink-2">
              Une recette qui demande « {p.name} » accepte n'importe lequel de ces produits, et leurs stocks s'additionnent. L'étoile désigne celui qu'on achète quand
              il en manque{p.preferredId ? "" : " (sinon c'est « " + p.name + " » qui part dans les courses)"}.
            </p>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {children.map((c) => {
              const preferred = p.preferredId === c.id;
              return (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <button
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${preferred ? "text-watch" : "text-ink-3"}`}
                    aria-pressed={preferred}
                    aria-label={preferred ? `${c.name} : produit acheté en priorité` : `Acheter ${c.name} en priorité`}
                    title={preferred ? "Acheté en priorité" : "Acheter en priorité"}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ id: p.id, data: { preferredId: preferred ? null : c.id } })}
                  >
                    <Star className={`size-4 ${preferred ? "fill-current" : ""}`} />
                  </button>
                  <Link to={`/produits/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                    {c.name || "Sans nom"}
                  </Link>
                  <span className="shrink-0 text-sm text-ink-2 tabular-nums">{stockLabel(c)}</span>
                  <StatusBadge status={c.status} compact />
                  <button className="icon-btn size-8 shrink-0" aria-label={`Retirer ${c.name} de la famille`} disabled={bulk.isPending} onClick={() => setParent([c.id], null)}>
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <button className="flex w-full items-center justify-center gap-2 border-t border-line p-3 text-sm font-semibold text-brand" onClick={() => setPicking("children")}>
            <Plus className="size-4" /> Ajouter des déclinaisons
          </button>
        </div>
      ) : (
        <div className="card p-3">
          <p className="text-sm text-ink-2">
            Regroupez les produits interchangeables : « Spaghetti » et « Coquillettes » sous « Pâtes ». Une recette qui demande des pâtes acceptera alors l'un ou
            l'autre, et les stocks s'additionnent.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <button className="btn-soft min-h-9 text-sm" onClick={() => setPicking("parent")}>
              Rattacher à un générique
            </button>
            <button className="btn-ghost min-h-9 text-sm" onClick={() => setPicking("children")}>
              <Plus className="size-4" /> Lui ajouter des déclinaisons
            </button>
          </div>
        </div>
      )}

      <ProductPickSheet
        open={picking === "parent"}
        onClose={() => setPicking(null)}
        // Un générique n'a pas de parent ; un produit qui a des déclinaisons ne peut pas en devenir une.
        products={isHead ? [] : products.filter((x) => x.id !== p.id && !x.parentId)}
        title={`Famille de « ${p.name || "ce produit"} »`}
        initialQuery=""
        currentId={p.parentId}
        onPick={(id) => {
          setPicking(null);
          setParent([p.id], id);
        }}
        onCreate={attachToNew}
      />
      <AlternativesSheet
        open={picking === "children"}
        onClose={() => setPicking(null)}
        products={products}
        name={p.name}
        mainId={p.id}
        value={children.map((c) => c.id)}
        title={`Déclinaisons de « ${p.name || "ce produit"} »`}
        intro={<>Cochez les produits qui sont des « {p.name || "ce produit"} ». Un produit déjà rangé dans une autre famille y est déplacé.</>}
        // Les génériques ne peuvent pas devenir des déclinaisons.
        exclude={(x) => products.some((c) => c.parentId === x.id)}
        busy={bulk.isPending}
        onSave={(ids) => {
          const removed = children.filter((c) => !ids.includes(c.id)).map((c) => ({ id: c.id, parentId: null }));
          const added = ids.filter((id) => byId.get(id)?.parentId !== p.id).map((id) => ({ id, parentId: p.id }));
          if (!removed.length && !added.length) return setPicking(null);
          bulk.mutate({ updates: [...removed, ...added] }, { onSuccess: () => setPicking(null) });
        }}
      />
    </section>
  );
}
