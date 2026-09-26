import { ChevronDown, Download, FileSpreadsheet, FileText, TriangleAlert } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { PageHeader, Spinner } from "@/components/ui";
import { downloadRecipeTemplate, readRecipeWorkbook } from "@/lib/excelFile";
import { formatQty } from "@/lib/format";
import { useImportRecipes, useRecipes } from "@/lib/queries";
import { type ImportedRecipe, type ParsedImport, parseRecipeText } from "@/lib/recipeImport";

const EXAMPLE = `☐ Crumble de potimarron
* 1 potimarron (~1 kg)
* 100 g farine
* Sel, poivre, muscade

☐ Quiche Lorraine
* 1 pâte brisée
* 200 g lardons
* 3 œufs`;

export function RecipeImportPage() {
  const recipes = useRecipes();
  const importRecipes = useImportRecipes();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [tag, setTag] = useState("");

  const existingNames = () => (recipes.data ?? []).map((r) => r.name);

  function show(p: ParsedImport, emptyMessage: string) {
    setParsed(p);
    setNames(Object.fromEntries(p.recipes.map((r) => [r.key, r.name])));
    // Les doublons sont décochés d'office : on peut toujours les recocher.
    setSelected(new Set(p.recipes.filter((r) => !r.duplicateOf).map((r) => r.key)));
    setOpen(null);
    if (!p.recipes.length) toast.error(p.ignored[0] ?? emptyMessage);
  }

  const analyse = (source = text) => show(parseRecipeText(source, existingNames()), "Aucune recette reconnue dans ce texte");

  async function onTextFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const content = await file.text();
    setText(content);
    analyse(content);
  }

  async function onExcelFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      show(await readRecipeWorkbook(file, existingNames()), "Aucune recette trouvée dans ce fichier");
    } catch {
      toast.error("Fichier illisible : enregistrez-le au format Excel (.xlsx)");
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    try {
      await downloadRecipeTemplate();
    } catch {
      toast.error("Téléchargement impossible (connexion ?)");
    }
  }

  const chosen = useMemo(() => (parsed?.recipes ?? []).filter((r) => selected.has(r.key)), [parsed, selected]);
  const duplicates = parsed?.recipes.filter((r) => r.duplicateOf).length ?? 0;

  function toggle(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    const t = tag.trim().replace(/^#/, "");
    const res = await importRecipes.mutateAsync(
      chosen.map((r) => {
        const tags = [...(r.extra?.tags ?? []), ...(t ? [t] : [])];
        return {
          ...r.extra,
          name: (names[r.key] ?? r.name).trim(),
          ingredients: r.ingredients,
          steps: r.steps.map((text) => ({ text })),
          notes: r.notes.join("\n") || null,
          ...(tags.length ? { tags } : {}),
        };
      }),
    );
    toast.success(`${res.count} recette${res.count > 1 ? "s" : ""} importée${res.count > 1 ? "s" : ""}`);
    navigate("/recettes", { replace: true });
  }

  if (!parsed || !parsed.recipes.length) {
    return (
      <>
        <PageHeader back="/recettes" title="Importer des recettes" />
        <div className="space-y-5 px-4 pb-8">
          <section className="card space-y-3 p-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="size-8 shrink-0 text-ok" />
              <div>
                <p className="font-semibold">Depuis un fichier Excel</p>
                <p className="text-sm text-ink-2">Une ligne par recette, une ligne par ingrédient : rien à deviner.</p>
              </div>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
              <li>Téléchargez le modèle et remplissez-le (Excel, LibreOffice, Google Sheets…).</li>
              <li>Choisissez le fichier : un aperçu s'affiche avant tout enregistrement.</li>
            </ol>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="btn-soft" onClick={template}>
                <Download className="size-4" /> Modèle
              </button>
              <button type="button" className="btn-primary" disabled={busy || recipes.isPending} onClick={() => excelRef.current?.click()}>
                {busy ? <Spinner className="text-brand-ink" /> : <><FileSpreadsheet className="size-4" /> Choisir le fichier</>}
              </button>
            </div>
            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onExcelFile}
            />
          </section>

          <details className="card p-4">
            <summary className="cursor-pointer font-semibold">Ou coller du texte</summary>
            <div className="mt-3 space-y-3">
              <textarea className="input min-h-60 font-mono text-sm" placeholder={EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="btn-soft" onClick={() => fileRef.current?.click()}>
                  <FileText className="size-4" /> Fichier texte
                </button>
                <button type="button" className="btn-primary" disabled={!text.trim() || recipes.isPending} onClick={() => analyse()}>
                  Analyser
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={onTextFile} />
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                <li>Titre : ligne avec case (☐, ☑, [ ]), « # Titre », ou ligne suivie d'une liste</li>
                <li>Ingrédient : ligne commençant par *, - ou • (« 2 boîtes de thon », « 5-6 tomates », « Sel, poivre »)</li>
                <li>Étapes : lignes numérotées (1. 2. …) ou placées après « Préparation : »</li>
              </ul>
            </div>
          </details>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back="/recettes"
        title="Vérifier l'import"
        subtitle={`${parsed.recipes.length} recette${parsed.recipes.length > 1 ? "s" : ""} trouvée${parsed.recipes.length > 1 ? "s" : ""}${duplicates ? ` · ${duplicates} doublon${duplicates > 1 ? "s" : ""}` : ""}`}
      />
      <div className="space-y-3 px-4 pb-20">
        <div className="flex gap-2">
          <button className="chip" onClick={() => setSelected(new Set(parsed.recipes.map((r) => r.key)))}>
            Tout cocher
          </button>
          <button className="chip" onClick={() => setSelected(new Set())}>
            Tout décocher
          </button>
          <button className="chip ml-auto" onClick={() => setParsed(null)}>
            Recommencer
          </button>
        </div>

        <ul className="space-y-2">
          {parsed.recipes.map((r) => (
            <ImportRow
              key={r.key}
              r={r}
              name={names[r.key] ?? r.name}
              onName={(v) => setNames((n) => ({ ...n, [r.key]: v }))}
              checked={selected.has(r.key)}
              onToggle={() => toggle(r.key)}
              open={open === r.key}
              onOpen={() => setOpen(open === r.key ? null : r.key)}
            />
          ))}
        </ul>

        {parsed.ignored.length > 0 && (
          <p className="text-sm text-ink-3">
            Lignes ignorées : {parsed.ignored.map((l) => `« ${l} »`).join(", ")}
          </p>
        )}

        <label className="block">
          <span className="label">Tag ajouté à toutes (facultatif)</span>
          <input className="input" placeholder="Ex. Batch cooking" value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
        <p className="text-sm text-ink-2">Les ingrédients sont reliés au catalogue produits (créés s'ils n'existent pas) : ils serviront aux courses et au stock.</p>
      </div>

      <div className="fixed inset-x-0 bottom-20 z-30 px-4">
        <div className="mx-auto max-w-3xl">
          <button className="btn-primary w-full shadow-xl" disabled={!chosen.length || importRecipes.isPending} onClick={submit}>
            {importRecipes.isPending ? <Spinner className="text-brand-ink" /> : `Importer ${chosen.length} recette${chosen.length > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </>
  );
}

function ImportRow({
  r,
  name,
  onName,
  checked,
  onToggle,
  open,
  onOpen,
}: {
  r: ImportedRecipe;
  name: string;
  onName: (v: string) => void;
  checked: boolean;
  onToggle: () => void;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <li className={`card overflow-hidden ${checked ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3 p-3">
        <input type="checkbox" className="size-5 shrink-0 accent-[var(--brand)]" checked={checked} onChange={onToggle} aria-label={`Importer ${name}`} />
        <div className="min-w-0 flex-1">
          <input
            className="w-full bg-transparent font-semibold outline-none focus:underline"
            value={name}
            placeholder="Recette sans nom"
            onChange={(e) => onName(e.target.value)}
            aria-label="Nom de la recette"
          />
          <p className="text-xs text-ink-2">
            {r.ingredients.length} ingrédient{r.ingredients.length > 1 ? "s" : ""}
            {r.steps.length > 0 && ` · ${r.steps.length} étape${r.steps.length > 1 ? "s" : ""}`}
            {r.extra?.servings != null && ` · ${r.extra.servings} pers.`}
          </p>
          {r.duplicateOf && (
            <p className="mt-1 flex items-center gap-1 text-xs text-watch">
              <TriangleAlert className="size-3.5 shrink-0" />
              {r.duplicateOf.existing ? `Existe déjà : « ${r.duplicateOf.name} »` : `Doublon de « ${r.duplicateOf.name} » plus haut`}
            </p>
          )}
        </div>
        {(r.ingredients.length > 0 || r.steps.length > 0 || r.notes.length > 0) && (
          <button className="icon-btn" onClick={onOpen} aria-label={open ? "Masquer le détail" : "Voir le détail"} aria-expanded={open}>
            <ChevronDown className={`size-5 transition ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t border-line bg-surface-2 px-4 py-3 text-sm">
          {r.ingredients.length > 0 && (
            <ul className="space-y-1">
              {r.ingredients.map((i, n) => (
                <li key={n} className="flex gap-2">
                  <span className="w-20 shrink-0 text-right text-ink-2 tabular-nums">{formatQty(i.quantity, i.unit)}</span>
                  <span>
                    {i.name}
                    {i.note && <span className="text-ink-3"> ({i.note})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.steps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5">
              {r.steps.map((s, n) => (
                <li key={n}>{s}</li>
              ))}
            </ol>
          )}
          {r.notes.map((n, k) => (
            <p key={k} className="text-ink-2 italic">
              {n}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
