import { useCallback, useRef } from "react";

type Options = {
  /** Glisser vers la droite. null : rien avant (effet élastique). */
  onPrev?: (() => void) | null;
  /** Glisser vers la gauche. null : rien après. */
  onNext?: (() => void) | null;
  /** false : geste ignoré (ex. pendant un glisser-déposer). */
  enabled?: boolean;
};

// Zones où le doigt fait déjà autre chose : saisie, défilement horizontal…
const IGNORE = "input, textarea, select, [contenteditable], [data-no-swipe], .overflow-x-auto";
// Bords de l'écran : réservés aux gestes « retour » du téléphone.
const EDGE = 20;

/**
 * Balayage horizontal (mobile) pour passer à l'élément précédent ou suivant.
 * Le contenu suit le doigt, puis sort et revient de l'autre côté.
 * Renvoie une ref callback à poser sur un conteneur qui reste monté.
 */
export function useSwipe<T extends HTMLElement = HTMLDivElement>(options: Options) {
  const opts = useRef(options);
  opts.current = options;

  return useCallback((el: T | null) => {
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    let horizontal: boolean | null = null;
    let dx = 0;
    let busy = false;
    const enabled = () => opts.current.enabled ?? true;
    const move = (x: number, animate: boolean) => {
      el.style.transition = animate ? "transform 160ms ease-out" : "none";
      el.style.transform = x ? `translateX(${x}px)` : "";
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      if (busy || !enabled() || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
      if ((e.target as Element | null)?.closest(IGNORE)) return;
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      horizontal = null;
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (!enabled() || e.touches.length !== 1) {
        start = null;
        move(0, true);
        return;
      }
      const t = e.touches[0];
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (horizontal === null) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        horizontal = Math.abs(mx) > Math.abs(my) * 1.3;
      }
      if (!horizontal) return;
      const target = mx > 0 ? opts.current.onPrev : opts.current.onNext;
      dx = target ? mx : mx * 0.25;
      move(dx, false);
    };

    const onEnd = (e: TouchEvent) => {
      if (!start || !horizontal) {
        start = null;
        return;
      }
      const quick = Math.abs(dx) > 40 && e.timeStamp - start.t < 250;
      const go = dx > 0 ? opts.current.onPrev : opts.current.onNext;
      start = null;
      if (!go || !(quick || Math.abs(dx) > Math.min(100, el.offsetWidth * 0.25))) {
        move(0, true);
        return;
      }
      const dir = dx > 0 ? 1 : -1;
      busy = true;
      move(dir * el.offsetWidth, true);
      setTimeout(() => {
        go();
        // Le nouvel élément arrive du côté opposé.
        move(-dir * el.offsetWidth * 0.35, false);
        void el.offsetWidth; // applique cette position avant d'animer le retour
        move(0, true);
        busy = false;
      }, 140);
    };

    const onCancel = () => {
      start = null;
      move(0, true);
    };

    // Le navigateur garde le défilement vertical et le zoom ; l'horizontal nous revient.
    el.style.touchAction = "pan-y pinch-zoom";
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      el.style.touchAction = "";
      el.style.transform = "";
    };
  }, []);
}
