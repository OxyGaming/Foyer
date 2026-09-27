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
import { ChefHat, ChevronLeft, ChevronRight, GripVertical, Plus, Printer, ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addDays, formatDayLong, formatDayMonth, isIsoDate, MEAL_LABEL, type Meal, relativeDayLabel, todayIso, weekDays, weekStart } from "../../shared/dates";
import { AddMealSheet, MealSheet, type Slot, useMealSlots } from "@/components/MealSheets";
import { PageHeader, PageLoader, Thumb } from "@/components/ui";
import { usePlan, useUpdateMeal } from "@/lib/planQueries";
import { useRecipes } from "@/lib/queries";
import type { MealPlanItem, RecipeSummary } from "@/lib/types";

const slotId = (date: string, meal: string) => `slot|${date}|${meal}`;

type CardProps = { item: MealPlanItem; recipe?: RecipeSummary };

function MealCardBody({ item, recipe }: CardProps) {
  const name = recipe?.name || item.title || "Repas";
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
    <div className="flex rotate-1 items-center gap-2.5 rounded-xl border border-brand bg-surface p-1.5 pr-3 shadow-xl">
      <MealCardBody {...props} />
    </div>
  );
}

function MealCard({ item, recipe, onOpen }: CardProps & { onOpen: () => void }) {
  const drag = useDraggable({ id: item.id, data: { item } });
  const drop = useDroppable({ id: `item|${item.id}`, data: { item } });
  const name = recipe?.name || item.title || "Repas";
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={`flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pr-1 transition ${drag.isDragging ? "opacity-30" : ""} ${drop.isOver && !drag.isDragging ? "border-brand ring-2 ring-brand/30" : ""}`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={onOpen}
        {...drag.listeners}
        {...drag.attributes}
        aria-roledescription="repas déplaçable"
        aria-label={`${name}. Appui long pour déplacer, ou toucher pour les options.`}
      >
        <MealCardBody item={item} recipe={recipe} />
      </button>
      <span className="touch-none p-1 text-ink-3" {...drag.listeners} aria-hidden>
        <GripVertical className="size-4" />
      </span>
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

export function PlanningPage() {
  const today = todayIso();
  const [params, setParams] = useSearchParams();
  const requested = params.get("semaine");
  const monday = weekStart(requested && isIsoDate(requested) ? requested : today);
  const sunday = addDays(monday, 6);
  const plan = usePlan(monday, sunday);
  const recipes = useRecipes();
  const meals = useMealSlots();
  const update = useUpdateMeal();
  const [adding, setAdding] = useState<Slot | null>(null);
  const [open, setOpen] = useState<MealPlanItem | null>(null);
  const [dragging, setDragging] = useState<MealPlanItem | null>(null);

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
    if (scrolled.current || plan.isPending || monday !== weekStart(today) || today === monday) return;
    scrolled.current = true;
    document.getElementById(`day-${today}`)?.scrollIntoView({ block: "start" });
  }, [plan.isPending, monday, today]);

  const goWeek = (delta: number) => setParams({ semaine: addDays(monday, delta * 7) }, { replace: true });

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
  const weekLabel = `${formatDayMonth(monday)} – ${formatDayMonth(sunday)}`;
  const isCurrent = monday === weekStart(today);

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle={`${weekLabel} · ${planned} repas`}
        actions={
          <>
            <Link to={`/planning/imprimer?semaine=${monday}`} className="icon-btn" aria-label="Imprimer la semaine">
              <Printer className="size-5" />
            </Link>
            <Link to="/courses" className="icon-btn" aria-label="Liste de courses">
              <ShoppingCart className="size-5" />
            </Link>
          </>
        }
      />
      <div className="px-4">
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
        <p className="mb-3 text-xs text-ink-3">Appui long sur un repas pour le glisser vers un autre jour, ou touchez-le pour « Déplacer vers… ».</p>

        {plan.isPending ? (
          <PageLoader />
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="space-y-3">
              {weekDays(monday).map((d) => {
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
            <DragOverlay dropAnimation={null}>{dragging && <MealCardOverlay item={dragging} recipe={dragging.recipeId ? recipeMap.get(dragging.recipeId) : undefined} />}</DragOverlay>
          </DndContext>
        )}
      </div>
      <AddMealSheet slot={adding} onClose={() => setAdding(null)} />
      <MealSheet item={open} onClose={() => setOpen(null)} />
    </>
  );
}
