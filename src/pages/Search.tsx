import { Search as SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmptyState, PageHeader, Spinner, Thumb } from "@/components/ui";
import { useSearch } from "@/lib/queries";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const deferred = useDeferredValue(q.trim());
  const search = useSearch(deferred);
  const navigate = useNavigate();
  const r = deferred ? search.data : undefined;
  const empty = r && !r.recipes.length && !r.products.length && !r.categories.length && !r.locations.length;

  return (
    <>
      <PageHeader title="Recherche" />
      <div className="space-y-5 px-4">
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3" />
          <input
            className="input py-3.5 pl-11 text-lg"
            type="search"
            autoFocus
            placeholder="Recette, produit, ingrédient, emplacement…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
            }}
          />
          {search.isFetching && <Spinner className="absolute top-1/2 right-3.5 -translate-y-1/2" />}
        </label>

        {!deferred && <EmptyState icon="🔎" title="Que cherchez-vous ?">Par exemple « lait » : recettes qui en contiennent, produit, emplacement…</EmptyState>}
        {empty && <EmptyState icon="🤷" title={`Rien pour « ${deferred} »`} />}

        {r && r.products.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-2 uppercase">Produits · stock</h2>
            <div className="card divide-y divide-line overflow-hidden">
              {r.products.map((p) => (
                <Link key={p.id} to={`/produits/${p.id}`} className="flex items-center gap-3 px-3 py-2.5">
                  <Thumb photoId={p.photoId} fallback="📦" className="size-11 rounded-xl" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name || "Sans nom"}</p>
                    <p className="truncate text-xs text-ink-2">{[p.category, p.brand].filter(Boolean).join(" · ")}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {r && r.recipes.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-2 uppercase">Recettes</h2>
            <div className="card divide-y divide-line overflow-hidden">
              {r.recipes.map((x) => (
                <Link key={x.id} to={`/recettes/${x.id}`} className="flex items-center gap-3 px-3 py-2.5">
                  <Thumb photoId={x.photoId} fallback="🍽️" className="size-11 rounded-xl" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{x.name || "Sans nom"}</p>
                    {x.reason && <p className="truncate text-xs text-ink-2">{x.reason}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {r && (r.categories.length > 0 || r.locations.length > 0) && (
          <section>
            <h2 className="mb-2 text-sm font-bold tracking-wide text-ink-2 uppercase">Catégories & emplacements</h2>
            <div className="flex flex-wrap gap-2">
              {r.categories.map((c) => (
                <button key={c.id} className="chip" onClick={() => navigate(c.kind === "recipe" ? `/recettes?categorie=${c.id}` : `/stock?groupe=category&filtre=${c.id}`)}>
                  {c.icon} {c.name} <span className="text-ink-3">· {c.kind === "recipe" ? "recettes" : "stock"}</span>
                </button>
              ))}
              {r.locations.map((l) => (
                <button key={l.id} className="chip" onClick={() => navigate(`/stock?groupe=location&filtre=${l.id}`)}>
                  {l.icon ?? "📍"} {l.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
