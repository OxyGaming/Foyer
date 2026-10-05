import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChefHat, ChevronLeft, ChevronRight, GripVertical, LayoutGrid, List, Plus, Printer, ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { addDays, formatDayLong, formatDayMonth, formatDayShort, isIsoDate, MEAL_LABEL, type Meal, relativeDayLabel, todayIso, weekDays, weekStart } from "../../shared/dates";
import { AddMealSheet, MealSheet, type Slot, useMealSlots } from "@/components/MealSheets";
import { PageHeader, PageLoader, Thumb } from "@/components/ui";
import { usePlan, useUpdateMeal } from "@/lib/planQueries";
import { useSwipe } from "@/lib/swipe";
import { useRecipes, useWeekStartDay } from "@/lib/queries";
import type { MealPlanItem, RecipeSummary } from "@/lib/types";

const slotId = (date: string, meal: string) => `slot|${date}|${meal}`;

type CardProps = { item: MealPlanItem; recipe?: RecipeSummary; compact?: boolean };

/**
 * Ordinateur ou téléphone tourné : la semaine comme sur le PDF, jours en
 * colonnes. Téléphone en portrait : jours en lignes, repas en colonnes.
 */
const WIDE = "(min-width: 768px), (orientation: landscape) and (min-width: 600px)";
type View = "week" | "days" | "list";

const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible */
  }
};
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

function MealCardBody({ item, recipe, compact }: CardProps) {
  const name = recipe?.name || item.title || "Repas";
  if (compact) {
    return (
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 text-xs leading-snug font-semibold ${item.cookedAt ? "text-ink-2 line-through decoration-ok/60" : ""}`}>
          {!item.recipeId && "📝 "}
          {name}
        </span>
        {(item.cookedAt || item.servings != null) && (
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
            {item.cookedAt && <ChefHat className="size-3 text-ok" aria-label="cuisiné" />}
            {item.servings != null && <span>👥 {item.servings}</span>}
          </span>
        )}
      </span>
    );
  }
  return (
    <>
      {item.recipeId ? (
        <Thumb photoId={recipe?.photoId} fallback="🍽️" className="size-11 shrink-0 rounded-lg" />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-lg">📝</span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] font-semibold ${item.cookedAt ? "text-ink-2 line-through decoration-ok/60" : ""}`}>{name}</span>
        <span className="flex items-center gap-2 text-xs text-ink-3">
          {item.cookedAt && (
            <span className="inline-flex items-center gap-1 font-semibold text-ok">
              <ChefHat className="size-3" /> cuisiné
            </span>
          )}
          {item.servings != null && <span>👥 {item.servings}</span>}
          {item.note && <span className="truncate">{item.note}</span>}
        </span>
      </span>
    </>
  );
}

/** Aperçu flottant pendant le glisser (sans hooks dnd : l'original reste enregistré). */
function MealCardOverlay(props: CardProps) {
  return (
    <div className={`flex rotate-1 items-center gap-2.5 rounded-xl border border-brand bg-surface shadow-xl ${props.compact ? "w-28 p-1.5" : "p-1.5 pr-3"}`}>
      <MealCardBody {...props} />
    </div>
  );
}

function MealCard({ item, recipe, compact, onOpen }: CardProps & { onOpen: () => void }) {
  const drag = useDraggable({ id: item.id, data: { item } });
  const drop = useDroppable({ id: `item|${item.id}`, data: { item } });
  const name = recipe?.name || item.title || "Repas";
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={`flex items-center gap-2 border border-line bg-surface transition ${compact ? "rounded-lg p-1.5" : "rounded-xl p-1.5 pr-1"} ${drag.isDragging ? "opacity-30" : ""} ${drop.isOver && !drag.isDragging ? "border-brand ring-2 ring-brand/30" : ""}`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={onOpen}
        {...drag.listeners}
        {...drag.attributes}
        aria-roledescription="repas déplaçable"
        aria-label={`${name}. Appui long pour déplacer, ou toucher pour les options.`}
      >
        <MealCardBody item={item} recipe={recipe} compact={compact} />
      </button>
      {!compact && (
        <span className="touch-none p-1 text-ink-3" {...drag.listeners} aria-hidden>
          <GripVertical className="size-4" />
        </span>
      )}
    </div>
  );
}

function SlotRow({ date, meal, items, recipes, onAdd, onOpen }: { date: string; meal: Meal; items: MealPlanItem[]; recipes: Map<string, RecipeSummary>; onAdd: () => void; onOpen: (i: MealPlanItem) => void }) {
  const drop = useDroppable({ id: slotId(date, meal), data: { date, meal } });
  return (
    <div ref={drop.setNodeRef} className={`rounded-xl px-2 py-1.5 transition ${drop.isOver ? "bg-brand-soft" : ""}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-bold tracking-wide text-ink-3 uppercase">{MEAL_LABEL[meal]}</span>
        <button className="flex size-8 items-center justify-center rounded-full text-brand active:bg-brand-soft" onClick={onAdd} aria-label={`Ajouter au ${MEAL_LABEL[meal].toLowerCase()}`}>
          <Plus className="size-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {items.map((i) => (
          <MealCard key={i.id} item={i} recipe={i.recipeId ? recipes.get(i.recipeId) : undefined} onOpen={() => onOpen(i)} />
        ))}
        {items.length === 0 && (
          <button className="w-full rounded-xl border border-dashed border-line py-2.5 text-sm text-ink-3" onClick={onAdd}>
            Rien de prévu
          </button>
        )}
      </div>
    </div>
  );
}

/** En-tête d'un jour dans la grille (« Lun. 5 oct. »), aujourd'hui mis en avant. */
function DayLabel({ date, today, vertical }: { date: string; today: string; vertical?: boolean }) {
  const [weekday, ...rest] = formatDayShort(date).split(" ");
  return (
    <div
      className={`rounded-lg px-1 py-1 text-xs font-bold ${vertical ? "flex flex-col justify-center text-center leading-tight" : "text-center"} ${date === today ? "bg-brand text-brand-ink" : "text-ink-2"} ${date < today ? "opacity-75" : ""}`}
    >
      <span className="first-letter:uppercase">{weekday}</span>
      {vertical ? <span className="font-medium">{rest.join(" ")}</span> : ` ${rest.join(" ")}`}
    </div>
  );
}

/** Case de la grille (un repas d'un jour) : dépôt, cartes compactes, ajout. */
function GridCell({
  date,
  meal,
  items,
  recipes,
  past,
  onAdd,
  onOpen,
}: {
  date: string;
  meal: Meal;
  items: MealPlanItem[];
  recipes: Map<string, RecipeSummary>;
  past: boolean;
  onAdd: () => void;
  onOpen: (i: MealPlanItem) => void;
}) {
  const drop = useDroppable({ id: slotId(date, meal), data: { date, meal } });
  return (
    <div ref={drop.setNodeRef} className={`flex min-h-16 flex-col gap-1 rounded-lg border p-1 transition ${drop.isOver ? "border-brand bg-brand-soft" : "border-line bg-surface-2/60"} ${past ? "opacity-75" : ""}`}>
      {items.map((i) => (
        <MealCard key={i.id} item={i} recipe={i.recipeId ? recipes.get(i.recipeId) : undefined} compact onOpen={() => onOpen(i)} />
      ))}
      <button
        className={`flex items-center justify-center rounded-md text-brand active:bg-brand-soft ${items.length ? "min-h-7" : "min-h-12 flex-1"}`}
        onClick={onAdd}
        aria-label={`Ajouter au ${MEAL_LABEL[meal].toLowerCase()} du ${formatDayShort(date)}`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function PlanningPage() {
  const today = todayIso();
  const firstDay = useWeekStartDay();
  const [params, setParams] = useSearchParams();
  const requested = params.get("semaine");
  const weekFrom = weekStart(requested && isIsoDate(requested) ? requested : today, firstDay);
  const weekTo = addDays(weekFrom, 6);
  const plan = usePlan(weekFrom, weekTo);
  const recipes = useRecipes();
  const meals = useMealSlots();
  const update = useUpdateMeal();
  const [adding, setAdding] = useState<Slot | null>(null);
  const [open, setOpen] = useState<MealPlanItem | null>(null);
  const [dragging, setDragging] = useState<MealPlanItem | null>(null);
  // Grille par défaut (orientée selon l'écran) ; la vue liste reste au choix et est mémorisée.
  const wide = useMediaQuery(WIDE);
  const [asList, setAsList] = useState(() => safeGet("planning-view") === "list");
  const view: View = asList ? "list" : wide ? "week" : "days";
  const grid = view !== "list";
  const toggleView = () => {
    setAsList(!asList);
    safeSet("planning-view", asList ? null : "list");
  };

  const recipeMap = useMemo(() => new Map((recipes.data ?? []).map((r) => [r.id, r])), [recipes.data]);
  const bySlot = useMemo(() => {
    const m = new Map<string, MealPlanItem[]>();
    for (const i of plan.data ?? []) {
      const k = slotId(i.date, i.meal);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [plan.data]);

  // Appui long au doigt (le défilement reste possible), petit déplacement à la souris.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Semaine en cours : on amène directement sur aujourd'hui.
  const scrolled = useRef(false);
  useEffect(() => {
    if (grid || scrolled.current || plan.isPending || weekFrom !== weekStart(today, firstDay) || today === weekFrom) return;
    scrolled.current = true;
    document.getElementById(`day-${today}`)?.scrollIntoView({ block: "start" });
  }, [grid, plan.isPending, weekFrom, today, firstDay]);

  const goWeek = (delta: number) => setParams({ semaine: addDays(weekFrom, delta * 7) }, { replace: true });
  // Mobile : balayer d'une semaine à l'autre (pas pendant le déplacement d'un repas).
  const swipe = useSwipe({
    onPrev: () => {
      goWeek(-1);
      window.scrollTo(0, 0);
    },
    onNext: () => {
      goWeek(1);
      window.scrollTo(0, 0);
    },
    // Grille large : le glissement horizontal fait défiler les jours.
    enabled: !dragging && view !== "week",
  });

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as { item: MealPlanItem }).item);
    navigator.vibrate?.(15);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const item = (e.active.data.current as { item: MealPlanItem } | undefined)?.item;
    const over = e.over?.data.current as { item?: MealPlanItem; date?: string; meal?: Meal } | undefined;
    if (!item || !over) return;
    let date: string;
    let meal: Meal;
    let position: number | undefined;
    if (over.item) {
      if (over.item.id === item.id) return;
      date = over.item.date;
      meal = over.item.meal;
      // Déposé sur un repas : prend sa place (celui-ci glisse d'un cran).
      const slot = (bySlot.get(slotId(date, meal)) ?? []).filter((i) => i.id !== item.id);
      position = slot.findIndex((i) => i.id === over.item!.id);
    } else {
      date = over.date!;
      meal = over.meal!;
      if (date === item.date && meal === item.meal) return;
    }
    update.mutate({ id: item.id, patch: { date, meal, ...(position !== undefined ? { position } : {}) } });
  }

  const planned = (plan.data ?? []).length;
  // Grille : les repas affichés, plus ceux d'un créneau masqué qui ont quand même des repas cette semaine.
  const gridMeals = (["breakfast", "lunch", "snack", "dinner"] as Meal[]).filter((m) => meals.includes(m) || (plan.data ?? []).some((i) => i.meal === m));
  const weekLabel = `${formatDayMonth(weekFrom)} – ${formatDayMonth(weekTo)}`;
  const isCurrent = weekFrom === weekStart(today, firstDay);

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle={`${weekLabel} · ${planned} repas`}
        actions={
          <>
            <button className="icon-btn" onClick={toggleView} aria-label={grid ? "Afficher en liste" : "Afficher en grille"} title={grid ? "Vue liste" : "Vue grille (jours en colonnes)"}>
              {grid ? <List className="size-5" /> : <LayoutGrid className="size-5" />}
            </button>
            <Link to={`/planning/imprimer?semaine=${weekFrom}`} className="icon-btn" aria-label="Imprimer la semaine">
              <Printer className="size-5" />
            </Link>
            <Link to="/courses" className="icon-btn" aria-label="Liste de courses">
              <ShoppingCart className="size-5" />
            </Link>
          </>
        }
      />
      {/* Le rognage sert à l'animation du balayage ; la grille large, elle, déborde de la colonne. */}
      <div className={view === "week" ? "" : "overflow-x-clip"}>
      <div ref={swipe} className="px-4">
        <div className="mb-3 flex items-center gap-2">
          <button className="icon-btn bg-surface-2" onClick={() => goWeek(-1)} aria-label="Semaine précédente">
            <ChevronLeft className="size-5" />
          </button>
          <button className={`btn-soft min-h-10 flex-1 text-sm ${isCurrent ? "" : "text-brand"}`} onClick={() => setParams({}, { replace: true })} disabled={isCurrent}>
            {isCurrent ? "Cette semaine" : "Revenir à cette semaine"}
          </button>
          <button className="icon-btn bg-surface-2" onClick={() => goWeek(1)} aria-label="Semaine suivante">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-3 short-landscape:hidden">
          Appui long sur un repas pour le glisser vers un autre jour, ou touchez-le pour « Déplacer vers… ».
          {view === "week" ? (
            <span className="md:hidden"> Faites défiler la grille pour voir toute la semaine.</span>
          ) : (
            <span className="lg:hidden"> Balayez vers la gauche ou la droite pour changer de semaine, ou tournez le téléphone pour voir les jours en colonnes.</span>
          )}
        </p>

        {plan.isPending ? (
          <PageLoader />
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            {view === "week" ? (
              // Sur ordinateur, la grille déborde la colonne centrale pour profiter de la largeur de l'écran.
              <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-[calc(50%-min(48vw,40rem))]">
                <div className="grid min-w-[44rem] gap-1" style={{ gridTemplateColumns: "4rem repeat(7, minmax(0, 1fr))" }}>
                  <div />
                  {weekDays(weekFrom).map((d) => (
                    <DayLabel key={d} date={d} today={today} />
                  ))}
                  {gridMeals.map((m) => (
                    <div key={m} className="contents">
                      <div className="pt-1.5 text-[11px] font-bold tracking-wide break-words text-ink-3 uppercase">{MEAL_LABEL[m]}</div>
                      {weekDays(weekFrom).map((d) => (
                        <GridCell
                          key={d}
                          date={d}
                          meal={m}
                          items={bySlot.get(slotId(d, m)) ?? []}
                          recipes={recipeMap}
                          past={d < today}
                          onAdd={() => setAdding({ date: d, meal: m })}
                          onOpen={setOpen}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : view === "days" ? (
              // Téléphone en portrait : un jour par ligne, un repas par colonne.
              <div className="-mx-4 overflow-x-auto px-4 pb-2">
                <div className="grid gap-1" style={{ gridTemplateColumns: `3.5rem repeat(${gridMeals.length}, minmax(5.5rem, 1fr))` }}>
                  <div />
                  {gridMeals.map((m) => (
                    <div key={m} className="px-1 pb-0.5 text-center text-[11px] font-bold tracking-wide text-ink-3 uppercase">
                      {MEAL_LABEL[m]}
                    </div>
                  ))}
                  {weekDays(weekFrom).map((d) => (
                    <div key={d} className="contents">
                      <DayLabel date={d} today={today} vertical />
                      {gridMeals.map((m) => (
                        <GridCell
                          key={m}
                          date={d}
                          meal={m}
                          items={bySlot.get(slotId(d, m)) ?? []}
                          recipes={recipeMap}
                          past={d < today}
                          onAdd={() => setAdding({ date: d, meal: m })}
                          onOpen={setOpen}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
            <div className="space-y-3">
              {weekDays(weekFrom).map((d) => {
                const rel = relativeDayLabel(d, today);
                return (
                  <section key={d} id={`day-${d}`} className={`card scroll-mt-20 overflow-hidden p-2 ${d === today ? "border-brand/50 ring-1 ring-brand/30" : ""} ${d < today ? "opacity-75" : ""}`}>
                    <h2 className="flex items-baseline gap-2 px-2 pt-1 pb-1">
                      <span className="text-base font-bold first-letter:uppercase">{formatDayLong(d)}</span>
                      {rel && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${d === today ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-2"}`}>{rel}</span>}
                    </h2>
                    <div className="space-y-1">
                      {meals.map((m) => (
                        <SlotRow
                          key={m}
                          date={d}
                          meal={m}
                          items={bySlot.get(slotId(d, m)) ?? []}
                          recipes={recipeMap}
                          onAdd={() => setAdding({ date: d, meal: m })}
                          onOpen={setOpen}
                        />
                      ))}
                      {/* Repas présents sur un créneau masqué dans les réglages : on les montre quand même. */}
                      {(["breakfast", "lunch", "snack", "dinner"] as Meal[])
                        .filter((m) => !meals.includes(m) && (bySlot.get(slotId(d, m))?.length ?? 0) > 0)
                        .map((m) => (
                          <SlotRow key={m} date={d} meal={m} items={bySlot.get(slotId(d, m))!} recipes={recipeMap} onAdd={() => setAdding({ date: d, meal: m })} onOpen={setOpen} />
                        ))}
                    </div>
                  </section>
                );
              })}
            </div>
            )}
            <DragOverlay dropAnimation={null}>
              {dragging && <MealCardOverlay item={dragging} recipe={dragging.recipeId ? recipeMap.get(dragging.recipeId) : undefined} compact={grid} />}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      </div>
      <AddMealSheet slot={adding} onClose={() => setAdding(null)} />
      <MealSheet item={open} onClose={() => setOpen(null)} />
    </>
  );
}
