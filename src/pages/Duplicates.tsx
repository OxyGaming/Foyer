import { ChevronRight, GitMerge } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { EmptyState, PageHeader, PageLoader } from "@/components/ui";
import { findDuplicates, preferredKeeper, stockSummary } from "@/lib/duplicates";
import { useMergeProduct, useProducts } from "@/lib/queries";
import type { Product } from "@/lib/types";

function DuplicateGroup({ group }: { group: Product[] }) {
  const merge = useMergeProduct();
  const [keepId, setKeepId] = useState(() => preferredKeeper(group).id);
  const [busy, setBusy] = useState(false);
  const keep = group.find((p) => p.id === keepId) ?? group[0];

  async function mergeAll() {
    setBusy(true);
    try {
      // Une à une : si des unités sont incomparables, on s'arrête avec le message du serveur.
      for (const p of group) if (p.id !== keep.id) await merge.mutateAsync({ id: p.id, intoId: keep.id });
      toast.success(`« ${keep.name} » : fiches fusionnées`);
    } catch {
      // Message déjà affiché par la mutation.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-3">
      <h2 className="mb-2 px-1 font-bold">{keep.name || "Sans nom"}</h2>
      <div className="space-y-1.5">
        {group.map((p) => (
          <div key={p.id} className={`flex items-center gap-2 rounded-xl border p-2 ${p.id === keep.id ? "border-brand bg-brand-soft/40" : "border-line"}`}>
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input type="radio" className="size-4 shrink-0 accent-[var(--brand)]" name={`keep-${group[0].id}`} checked={p.id === keep.id} onChange={() => setKeepId(p.id)} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {p.name || "Sans nom"}
                  {p.id === keep.id && <span className="font-normal text-brand"> · gardée</span>}
                </span>
                <span className="block text-xs text-ink-2">{stockSummary(p)}</span>
              </span>
            </label>
            <Link to={`/produits/${p.id}`} className="icon-btn size-9 text-ink-3" aria-label={`Ouvrir la fiche ${p.name}`}>
              <ChevronRight className="size-4" />
            </Link>
          </div>
        ))}
      </div>
      <button className="btn-primary mt-3 w-full" disabled={busy} onClick={mergeAll}>
        <GitMerge className="size-4" /> Fusionner {group.length > 2 ? `les ${group.length} fiches` : "les deux fiches"}
      </button>
    </section>
  );
}

export function DuplicatesPage() {
  const products = useProducts();
  const groups = useMemo(() => findDuplicates(products.data ?? []), [products.data]);
  if (products.isPending) return <PageLoader />;
  return (
    <>
      <PageHeader back="/stock" title="Doublons" subtitle={groups.length ? `${groups.length} produit${groups.length > 1 ? "s" : ""} en plusieurs fiches` : undefined} />
      <div className="space-y-3 px-4 pb-6">
        {groups.length === 0 ? (
          <EmptyState icon="✨" title="Aucun doublon">
            Chaque produit n'a qu'une fiche.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Recettes et courses ne voient qu'une des fiches d'un même produit. Choisissez celle à garder (par défaut, celle qui a du stock) : stock, historique, achats, recettes et courses des autres y sont
              regroupés.
            </p>
            {groups.map((g) => (
              <DuplicateGroup key={g.map((p) => p.id).join()} group={g} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
