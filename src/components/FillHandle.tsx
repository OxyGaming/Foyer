import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

type Box = { top: number; left: number; width: number; height: number };
type Cell = { r: number; c: number };

const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * Poignée de recopie façon tableur, pour les grilles dont les champs portent
 * `data-r` (ligne) et `data-c` (colonne) : un petit carré au coin de la cellule
 * active, à tirer vers le haut ou le bas pour copier sa valeur sur les lignes
 * survolées. Double-clic : jusqu'à la dernière ligne. Ctrl+D : recopie la
 * cellule du dessus. À placer dans `container`, qui doit être en position relative.
 */
export function FillHandle({
  container,
  scroller,
  onFill,
}: {
  container: RefObject<HTMLElement | null>;
  /** Zone qui défile : elle avance quand on tire près de ses bords. */
  scroller?: RefObject<HTMLElement | null>;
  /** Copie la valeur de la ligne `from` (colonne `c`) sur les lignes `to`. */
  onFill: (c: number, from: number, to: number[]) => void;
}) {
  const [active, setActive] = useState<Cell | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [range, setRange] = useState<Box | null>(null);
  const [, relayout] = useState(0);
  const fill = useRef(onFill);
  fill.current = onFill;

  const rowBox = (r: number): Box | null => {
    const root = container.current;
    const tr = root?.querySelector(`[data-r="${r}"]`)?.closest("tr");
    if (!root || !tr) return null;
    const a = root.getBoundingClientRect();
    const b = tr.getBoundingClientRect();
    return { top: b.top - a.top, left: b.left - a.left, width: b.width, height: b.height };
  };
  const cellBox = (r: number, c: number): Box | null => {
    const root = container.current;
    const td = root?.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.closest("td");
    if (!root || !td) return null;
    const a = root.getBoundingClientRect();
    const b = td.getBoundingClientRect();
    return { top: b.top - a.top, left: b.left - a.left, width: b.width, height: b.height };
  };
  const lastRow = () => Math.max(-1, ...[...(container.current?.querySelectorAll<HTMLElement>("[data-r]") ?? [])].map((e) => Number(e.dataset.r)));
  const between = (a: number, b: number) => Array.from({ length: Math.abs(b - a) }, (_, i) => (b > a ? a + 1 + i : a - 1 - i));

  // Cellule active = dernier champ de la grille qui a reçu le focus.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r][data-c]");
      if (el) setActive({ r: Number(el.dataset.r), c: Number(el.dataset.c) });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "d") return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r][data-c]");
      if (!el || Number(el.dataset.r) === 0) return;
      e.preventDefault();
      const r = Number(el.dataset.r);
      fill.current(Number(el.dataset.c), r - 1, [r]);
    };
    const onResize = () => relayout((n) => n + 1);
    root.addEventListener("focusin", onFocus);
    root.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [container]);

  // Position recalculée après chaque rendu (lignes filtrées, triées, saisie…).
  useLayoutEffect(() => {
    const b = active ? cellBox(active.r, active.c) : null;
    setBox((prev) => (sameBox(prev, b) ? prev : b));
    let rg: Box | null = null;
    if (b && active && target != null && target !== active.r) {
      const t = rowBox(target);
      if (t) {
        const top = Math.min(b.top, t.top);
        const bottom = Math.max(b.top + b.height, t.top + t.height);
        rg = { top, left: b.left, width: b.width, height: bottom - top };
      }
    }
    setRange((prev) => (sameBox(prev, rg) ? prev : rg));
  });

  function start(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!active) return;
    const src = active;
    let to = src.r;
    setTarget(src.r);
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "crosshair";
    const move = (ev: PointerEvent) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("tr")?.querySelector<HTMLElement>("[data-r]");
      if (row && container.current?.contains(row)) {
        to = Number(row.dataset.r);
        setTarget(to);
      }
      const sc = scroller?.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (ev.clientY > r.bottom - 32) sc.scrollTop += 24;
        else if (ev.clientY < r.top + 48) sc.scrollTop -= 24;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = "";
      setTarget(null);
      if (to !== src.r) fill.current(src.c, src.r, between(src.r, to));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!box || !active) return null;
  return (
    <>
      {range && <div className="pointer-events-none absolute z-[5] rounded-sm border-2 border-dashed border-brand bg-brand/10" style={range} />}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Recopier la valeur : tirer vers le haut ou le bas, double-clic pour aller jusqu'en bas"
        title="Tirer pour recopier · double-clic : jusqu'en bas · Ctrl+D : recopier la cellule du dessus"
        className="absolute z-[6] size-2.5 cursor-crosshair rounded-[2px] border border-surface bg-brand shadow"
        style={{ top: box.top + box.height - 6, left: box.left + box.width - 6 }}
        onPointerDown={start}
        onDoubleClick={(e) => {
          e.preventDefault();
          const end = lastRow();
          if (end > active.r) fill.current(active.c, active.r, between(active.r, end));
        }}
      />
    </>
  );
}
