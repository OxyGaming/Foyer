import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addDays, formatDayMonth, formatDayShort, isIsoDate, MEAL_LABEL, MEALS, type Meal, todayIso, weekDays, weekStart } from "../../shared/dates";
import { useMealSlots } from "@/components/MealSheets";
import { PageLoader } from "@/components/ui";
import { formatQty } from "@/lib/format";
import { usePlan } from "@/lib/planQueries";
import { buildPrintPlan, type Marker } from "@/lib/printPlan";
import { useMe, useRecipes, useWeekStartDay } from "@/lib/queries";

/** Repère d'un ingrédient partagé : forme colorée + numéro (lisible aussi en noir et blanc). */
function MarkerBadge({ marker, size = 11 }: { marker: Marker; size?: number }) {
  const s = size;
  const h = s / 2;
  const shape =
    marker.shape === "circle" ? (
      <circle cx={h} cy={h} r={h - 0.5} />
    ) : marker.shape === "square" ? (
      <rect x={0.75} y={0.75} width={s - 1.5} height={s - 1.5} rx={1.5} />
    ) : marker.shape === "diamond" ? (
      <polygon points={`${h},0.3 ${s - 0.3},${h} ${h},${s - 0.3} 0.3,${h}`} />
    ) : (
      <polygon points={`${h},0.5 ${s - 0.3},${s - 0.8} 0.3,${s - 0.8}`} />
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 align-[-1px]">
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill={marker.color} aria-hidden>
        {shape}
      </svg>
      <span className="text-[0.85em] font-bold tabular-nums">{marker.index}</span>
    </span>
  );
}

const range = (date: string) => `${formatDayMonth(date)}`;
const yearOf = (date: string) => date.slice(0, 4);

export function PlanningPrintPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("semaine");
  const weekFrom = weekStart(requested && isIsoDate(requested) ? requested : todayIso(), useWeekStartDay());
  const weekTo = addDays(weekFrom, 6);
  const plan = usePlan(weekFrom, weekTo);
  const recipes = useRecipes();
  const me = useMe();
  const slots = useMealSlots();
  const [showQty, setShowQty] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);

  const data = useMemo(() => buildPrintPlan(plan.data ?? [], new Map((recipes.data ?? []).map((r) => [r.id, r]))), [plan.data, recipes.data]);
  // Repas masqués dans les réglages mais présents cette semaine : on les imprime quand même.
  const meals: Meal[] = MEALS.filter((m) => slots.includes(m) || (plan.data ?? []).some((i) => i.meal === m));
  const days = weekDays(weekFrom);
  const goWeek = (n: number) => setParams({ semaine: addDays(weekFrom, n * 7) }, { replace: true });

  if (plan.isPending || recipes.isPending) return <PageLoader />;

  return (
    <div className="min-h-dvh bg-[#e7e3dc] pb-10 text-[#1f1c18] print:bg-white print:pb-0">
      {/* A4 paysage, marges fines ; les couleurs des repères sont conservées à l'impression. */}
      <style>{"@page { size: A4 landscape; margin: 8mm; } @media print { html, body { background: #fff !important; } }"}</style>

      <div className="pt-safe sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-[#e7e3dc]/95 px-3 py-2 backdrop-blur print:hidden">
        <Link to={`/planning?semaine=${weekFrom}`} className="icon-btn text-[#1f1c18]" aria-label="Retour au planning">
          <ChevronLeft className="size-6" />
        </Link>
        <div className="flex items-center rounded-xl bg-white/70">
          <button className="icon-btn size-10 text-[#1f1c18]" onClick={() => goWeek(-1)} aria-label="Semaine précédente">
            <ChevronLeft className="size-5" />
          </button>
          <span className="px-1 text-sm font-semibold">
            {range(weekFrom)} – {range(weekTo)}
          </span>
          <button className="icon-btn size-10 text-[#1f1c18]" onClick={() => goWeek(1)} aria-label="Semaine suivante">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4 accent-[#2f6b4f]" checked={showQty} onChange={(e) => setShowQty(e.target.checked)} /> Quantités
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4 accent-[#2f6b4f]" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} /> Repères
        </label>
        <button className="btn ml-auto bg-[#2f6b4f] text-white" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimer
        </button>
      </div>

      <div className="overflow-x-auto px-3 print:overflow-visible print:px-0">
        <article className="mx-auto w-[277mm] bg-white p-[6mm] shadow-lg [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:w-auto print:p-0 print:shadow-none">
          <header className="mb-3 flex items-end justify-between border-b-2 border-[#1f1c18] pb-1.5">
            <h1 className="text-[18pt] leading-none font-bold">
              Menu de la semaine · {range(weekFrom)} – {range(weekTo)} {yearOf(weekTo)}
            </h1>
            <p className="text-[9pt] text-[#6b645a]">{me.data?.household.name}</p>
          </header>

          <div className="grid border-t border-l border-[#cfc8bd]" style={{ gridTemplateColumns: `18mm repeat(7, minmax(0, 1fr))` }}>
            <div className="border-r border-b border-[#cfc8bd]" />
            {days.map((d) => (
              <div key={d} className="border-r border-b border-[#cfc8bd] bg-[#f3efe8] px-1.5 py-1 text-[9.5pt] font-bold capitalize">
                {formatDayShort(d)}
              </div>
            ))}
            {meals.map((m) => (
              <div key={m} className="contents">
                <div className="flex items-start border-r border-b border-[#cfc8bd] bg-[#f3efe8] px-1.5 py-1 text-[8.5pt] font-bold tracking-wide uppercase [break-inside:avoid]">
                  {MEAL_LABEL[m]}
                </div>
                {days.map((d) => {
                  const entries = data.cells.get(`${d}|${m}`) ?? [];
                  return (
                    <div key={d} className="min-h-[18mm] border-r border-b border-[#cfc8bd] px-1.5 py-1 [break-inside:avoid]">
                      {entries.map((e) => (
                        <div key={e.id} className="mb-1.5 last:mb-0">
                          <p className="text-[9.5pt] leading-tight font-bold">
                            {e.title}
                            {e.isRecipe && e.servings != null && <span className="font-normal text-[#6b645a]"> · {formatQty(e.servings)} p.</span>}
                          </p>
                          {e.ingredients.length > 0 && (
                            <ul className="mt-0.5 space-y-px text-[7.5pt] leading-snug">
                              {e.ingredients.map((ing, i) => {
                                const marker = showMarkers ? data.markers.get(ing.key) : undefined;
                                return (
                                  <li key={i} className="flex items-start gap-1">
                                    {marker ? <MarkerBadge marker={marker} size={8} /> : <span className="w-2 shrink-0 text-center text-[#9a9288]">·</span>}
                                    <span className={marker ? "font-semibold" : ""}>
                                      {ing.name}
                                      {showQty && (ing.quantity != null || ing.unit) && <span className="font-normal text-[#6b645a]"> {formatQty(ing.quantity, ing.unit)}</span>}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {showMarkers && data.shared.length > 0 && (
            <section className="mt-3 [break-inside:avoid]">
              <h2 className="mb-1 text-[9pt] font-bold tracking-wide uppercase">Ingrédients utilisés plusieurs fois</h2>
              <ul className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-[8pt] leading-snug">
                {data.shared.map((s) => (
                  <li key={s.key} className="flex items-start gap-1.5">
                    <MarkerBadge marker={s.marker} size={9} />
                    <span>
                      <b>{s.name}</b>
                      {showQty && s.total && <span> · {formatQty(s.total.quantity, s.total.unit)} au total</span>}
                      <span className="text-[#6b645a]"> — {s.uses.map((u) => `${formatDayShort(u.date)} ${MEAL_LABEL[u.meal].toLowerCase()}`).join(", ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(plan.data ?? []).length === 0 && <p className="mt-6 text-center text-[11pt] text-[#6b645a]">Aucun repas planifié cette semaine.</p>}
        </article>
      </div>
    </div>
  );
}
