import { BookOpen, Check, ChefHat, Copy, Heart, MoveRight, Search, Trash2, Undo2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { addDays, formatDayShort, MEAL_LABEL, type Meal, relativeDayLabel, todayIso, weekDays, weekStart } from "../../shared/dates";
import { consumptionFor } from "../../shared/needs";
import { matches } from "../../shared/text";
import { formatQty } from "@/lib/format";
import { useCookable } from "@/lib/cookable";
import { clientId, useAddMeal, useCookMeal, usePlan, useRemoveMeal, useUpdateMeal } from "@/lib/planQueries";
import { suggestRecipes } from "@/lib/suggestions";
import { useMe, useProducts, useRecipe, useRecipes, useWeekStartDay } from "@/lib/queries";
import type { MealPlanItem, RecipeSummary } from "@/lib/types";
import { NumberInput, Sheet, Spinner, Thumb } from "./ui";

export function useMealSlots(): Meal[] {
  const me = useMe();
  const slots = me.data?.household.mealSlots;
  return slots?.length ? slots : ["lunch", "dinner"];
}

// ─── Choix d'un créneau (jour + repas) ───────────────────────────────────────

export type Slot = { date: string; meal: Meal };

export function SlotPicker({ value, onChange, fromWeekStart }: { value: Slot; onChange: (s: Slot) => void; fromWeekStart?: string }) {
  const meals = useMealSlots();
  const firstDay = useWeekStartDay();
  const today = todayIso();
  const start = fromWeekStart ?? weekStart(today, firstDay);
  const days = [...weekDays(start), ...weekDays(addDays(start, 7))];
  const row = useRef<HTMLDivElement>(null);
  // Montre le jour sélectionné à l'ouverture (il peut être hors de l'écran).
  useEffect(() => {
    row.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <div className="space-y-3">
      <div ref={row} className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {days.map((d) => (
          <button
            type="button"
            key={d}
            onClick={() => onChange({ ...value, date: d })}
            aria-pressed={value.date === d}
            className={`flex min-w-14 shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-sm ${value.date === d ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface"} ${d < today ? "opacity-50" : ""}`}
          >
            <span className="text-[11px] font-medium uppercase">{formatDayShort(d).split(" ")[0]}</span>
            <span className="text-lg leading-tight font-bold">{Number(d.slice(8))}</span>
            {d === today && <span className="text-[10px] font-semibold">auj.</span>}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {meals.map((m) => (
          <button type="button" key={m} className={`chip justify-center ${value.meal === m ? "chip-on" : ""}`} onClick={() => onChange({ ...value, meal: m })}>
            {MEAL_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Ajouter un repas à un créneau ───────────────────────────────────────────

export function AddMealSheet({ slot, onClose }: { slot: Slot | null; onClose: () => void }) {
  const recipes = useRecipes();
  const add = useAddMeal();
  const [q, setQ] = useState("");
  const [free, setFree] = useState("");

  const list = useMemo(() => {
    const all = [...(recipes.data ?? [])].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "fr"));
    return q.trim() ? all.filter((r) => matches(r.name, q) || r.tags.some((t) => matches(t, q))) : all;
  }, [recipes.data, q]);

  // Suggestions : historique récent du planning + ce qui est réalisable avec le stock.
  const date = slot?.date ?? todayIso();
  const history = usePlan(addDays(date, -60), addDays(date, 14));
  const cookable = useCookable();
  const suggestions = useMemo(
    () => suggestRecipes(recipes.data ?? [], cookable.data?.byId, history.data ?? [], date),
    [recipes.data, cookable.data, history.data, date],
  );
  const showSuggestions = !q.trim() && (suggestions.ready.length > 0 || suggestions.forgotten.length > 0);

  const close = () => {
    setQ("");
    setFree("");
    onClose();
  };
  const pick = (r: RecipeSummary) => {
    if (!slot) return;
    add.mutate({ id: clientId(), ...slot, recipeId: r.id });
    close();
  };
  const addFree = (e: FormEvent) => {
    e.preventDefault();
    if (!slot || !free.trim()) return;
    add.mutate({ id: clientId(), ...slot, title: free.trim() });
    close();
  };

  return (
    <Sheet open={!!slot} onClose={close} title={slot ? `${MEAL_LABEL[slot.meal]} · ${relativeDayLabel(slot.date) ?? formatDayShort(slot.date)}` : ""}>
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" />
        <input className="input pl-10" type="search" placeholder="Chercher une recette…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {showSuggestions && (
        <div className="mb-3 space-y-3">
          {(
            [
              ["✓ Avec votre stock", suggestions.ready],
              ["❤️ Pas au menu depuis un moment", suggestions.forgotten],
            ] as const
          ).map(([title, items]) =>
            items.length ? (
              <div key={title}>
                <p className="mb-1.5 text-xs font-bold tracking-wide text-ink-2 uppercase">{title}</p>
                <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                  {items.map((r) => (
                    <button key={r.id} className="w-24 shrink-0 text-left active:scale-[0.98]" onClick={() => pick(r)}>
                      <Thumb photoId={r.photoId} fallback="🍽️" className="aspect-square w-full rounded-xl" />
                      <span className="mt-1 line-clamp-2 block text-xs leading-tight font-medium">{r.name || "Sans nom"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
          <p className="text-xs font-bold tracking-wide text-ink-2 uppercase">Toutes les recettes</p>
        </div>
      )}
      <div className={`-mx-1 space-y-1 overflow-y-auto px-1 ${showSuggestions ? "max-h-[30dvh]" : "max-h-[45dvh]"}`}>
        {list.map((r) => (
          <button key={r.id} className="flex w-full items-center gap-3 rounded-xl p-2 text-left active:bg-surface-2" onClick={() => pick(r)}>
            <Thumb photoId={r.photoId} fallback="🍽️" className="size-12 shrink-0 rounded-lg" />
            <span className="flex-1 font-medium">{r.name || "Sans nom"}</span>
            {r.favorite && <Heart className="size-4 fill-current text-rose-400" />}
          </button>
        ))}
        {recipes.data?.length === 0 && <p className="p-3 text-sm text-ink-2">Aucune recette pour l'instant : ajoutez un repas libre ci-dessous.</p>}
        {recipes.data && recipes.data.length > 0 && list.length === 0 && <p className="p-3 text-sm text-ink-2">Aucune recette ne correspond.</p>}
      </div>
      <form onSubmit={addFree} className="mt-4 border-t border-line pt-4">
        <label className="label">Ou un repas libre</label>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Restes, resto, pizza…" value={free} onChange={(e) => setFree(e.target.value)} />
          <button className="btn-primary" disabled={!free.trim()}>
            Ajouter
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Ajout d'une recette au planning depuis sa fiche : on choisit le créneau. */
export function PlanRecipeSheet({ recipeId, open, onClose }: { recipeId: string; open: boolean; onClose: () => void }) {
  const meals = useMealSlots();
  const [slot, setSlot] = useState<Slot>(() => ({ date: todayIso(), meal: meals.includes("dinner") ? "dinner" : meals[0] }));
  const add = useAddMeal();
  return (
    <Sheet open={open} onClose={onClose} title="Ajouter au planning">
      <SlotPicker value={slot} onChange={setSlot} />
      <button
        className="btn-primary mt-4 w-full"
        onClick={() => {
          add.mutate({ id: clientId(), ...slot, recipeId });
          onClose();
        }}
      >
        Planifier pour {relativeDayLabel(slot.date)?.toLowerCase() ?? formatDayShort(slot.date)} · {MEAL_LABEL[slot.meal].toLowerCase()}
      </button>
    </Sheet>
  );
}

// ─── Actions sur un repas planifié ───────────────────────────────────────────

type Mode = "menu" | "move" | "copy" | "cook";

export function MealSheet({ item, onClose }: { item: MealPlanItem | null; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("menu");
  const close = () => {
    setMode("menu");
    onClose();
  };
  return (
    <Sheet open={!!item} onClose={close} title={item ? <MealTitle item={item} /> : ""}>
      {item && mode === "menu" && <MealMenu item={item} setMode={setMode} onClose={close} />}
      {item && (mode === "move" || mode === "copy") && <MoveForm item={item} copy={mode === "copy"} onDone={close} />}
      {item && mode === "cook" && <CookForm item={item} onDone={close} />}
    </Sheet>
  );
}

function MealTitle({ item }: { item: MealPlanItem }) {
  const recipes = useRecipes();
  const r = recipes.data?.find((x) => x.id === item.recipeId);
  return <>{r?.name || item.title || "Repas"}</>;
}

function MealMenu({ item, setMode, onClose }: { item: MealPlanItem; setMode: (m: Mode) => void; onClose: () => void }) {
  const update = useUpdateMeal();
  const remove = useRemoveMeal();
  const recipes = useRecipes();
  const recipe = recipes.data?.find((x) => x.id === item.recipeId);
  const [servings, setServings] = useState<number | null>(item.servings);
  const [note, setNote] = useState(item.note ?? "");
  const dirty = servings !== item.servings || (note || null) !== item.note;
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left font-medium active:bg-surface-2";

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        {MEAL_LABEL[item.meal]} · {relativeDayLabel(item.date) ?? formatDayShort(item.date)}
        {item.cookedAt && <span className="ml-2 font-semibold text-ok">✓ cuisiné</span>}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Portions</label>
          <NumberInput value={servings} onChange={setServings} placeholder={recipe?.servings != null ? `${recipe.servings} (recette)` : "—"} />
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Invités…" />
        </div>
      </div>
      {dirty && (
        <button className="btn-soft w-full" onClick={() => { update.mutate({ id: item.id, patch: { servings, note: note || null } }); onClose(); }}>
          Enregistrer portions et note
        </button>
      )}
      <div className="-mx-2">
        {recipe && (
          <Link to={`/recettes/${recipe.id}`} className={row}>
            <BookOpen className="size-5 text-ink-2" /> Voir la recette
          </Link>
        )}
        <button className={row} onClick={() => setMode("move")}>
          <MoveRight className="size-5 text-ink-2" /> Déplacer vers…
        </button>
        <button className={row} onClick={() => setMode("copy")}>
          <Copy className="size-5 text-ink-2" /> Dupliquer vers…
        </button>
        {item.cookedAt ? (
          <button className={row} onClick={() => { update.mutate({ id: item.id, patch: { cooked: false } }); onClose(); }}>
            <Undo2 className="size-5 text-ink-2" /> Annuler « cuisiné »
            <span className="ml-auto text-xs font-normal text-ink-3">le stock n'est pas remis</span>
          </button>
        ) : (
          <button className={row} onClick={() => { if (item.recipeId) setMode("cook"); else { update.mutate({ id: item.id, patch: { cooked: true } }); onClose(); } }}>
            <ChefHat className="size-5 text-ink-2" /> C'est cuisiné
          </button>
        )}
        <button className={`${row} text-danger`} onClick={() => { remove.mutate(item.id); onClose(); }}>
          <Trash2 className="size-5" /> Retirer du planning
        </button>
      </div>
    </div>
  );
}

function MoveForm({ item, copy, onDone }: { item: MealPlanItem; copy: boolean; onDone: () => void }) {
  const firstDay = useWeekStartDay();
  const [slot, setSlot] = useState<Slot>({ date: item.date, meal: item.meal });
  const update = useUpdateMeal();
  const add = useAddMeal();
  const same = slot.date === item.date && slot.meal === item.meal;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">{copy ? "Ajouter aussi ce repas à :" : "Nouveau créneau :"}</p>
      <SlotPicker value={slot} onChange={setSlot} fromWeekStart={weekStart(item.date < todayIso() ? todayIso() : item.date, firstDay)} />
      <button
        className="btn-primary mt-4 w-full"
        disabled={!copy && same}
        onClick={() => {
          if (copy) add.mutate({ id: clientId(), ...slot, recipeId: item.recipeId, title: item.title, servings: item.servings });
          else update.mutate({ id: item.id, patch: slot });
          onDone();
        }}
      >
        {copy ? "Dupliquer" : "Déplacer"} vers {relativeDayLabel(slot.date)?.toLowerCase() ?? formatDayShort(slot.date)} · {MEAL_LABEL[slot.meal].toLowerCase()}
      </button>
    </div>
  );
}

/** Confirme ce qui sort du stock quand le plat est cuisiné (quantités modifiables). */
function CookForm({ item, onDone }: { item: MealPlanItem; onDone: () => void }) {
  const recipe = useRecipe(item.recipeId ?? "");
  const products = useProducts();
  const cook = useCookMeal();
  const productMap = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const initial = useMemo(
    () => (recipe.data ? consumptionFor(recipe.data, item.servings, productMap) : []),
    [recipe.data, item.servings, productMap],
  );
  const [rows, setRows] = useState<Record<string, { on: boolean; qty: number | null }>>({});
  if (recipe.isPending || products.isPending) return <Spinner />;

  const lines = initial.map((c) => {
    const p = productMap.get(c.productId);
    const state = rows[c.productId] ?? { on: p?.quantity != null && p.quantity > 0, qty: c.quantity };
    return { ...c, stock: p?.quantity ?? null, state };
  });
  const skipped = (recipe.data?.ingredients ?? []).filter((i) => i.productId && !initial.some((c) => c.productId === i.productId));
  const set = (id: string, s: { on: boolean; qty: number | null }) => setRows((r) => ({ ...r, [id]: s }));

  const submit = (withStock: boolean) => {
    const consume = withStock ? lines.filter((l) => l.state.on && l.state.qty && l.state.qty > 0).map((l) => ({ productId: l.productId, quantity: l.state.qty! })) : [];
    cook.mutate({ id: item.id, consume }, { onSuccess: onDone });
  };

  return (
    <div className="space-y-4">
      {lines.length > 0 ? (
        <>
          <p className="text-sm text-ink-2">Retirer du stock :</p>
          <ul className="card divide-y divide-line">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={l.state.on} onChange={(e) => set(l.productId, { ...l.state, on: e.target.checked })} aria-label={`Retirer ${l.name}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.name}</span>
                  <span className="text-xs text-ink-3">{l.stock != null ? `en stock : ${formatQty(l.stock, l.unit)}` : "stock non renseigné"}</span>
                </span>
                <NumberInput className="input w-20 py-2 text-right" value={l.state.qty} onChange={(v) => set(l.productId, { ...l.state, qty: v })} />
                <span className="w-8 text-sm text-ink-2">{l.unit ?? ""}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-2">Aucun ingrédient chiffré à retirer du stock pour cette recette.</p>
      )}
      {skipped.length > 0 && (
        <p className="text-xs text-ink-3">
          Non déduits (quantité absente ou unité différente du stock) : {skipped.map((i) => i.name).join(", ")}.
        </p>
      )}
      <div className="grid gap-2">
        {lines.length > 0 && (
          <button className="btn-primary" disabled={cook.isPending} onClick={() => submit(true)}>
            <Check className="size-4" /> Cuisiné, retirer du stock
          </button>
        )}
        <button className="btn-soft" disabled={cook.isPending} onClick={() => submit(false)}>
          Cuisiné, sans toucher au stock
        </button>
      </div>
    </div>
  );
}

