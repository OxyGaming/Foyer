import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** « ‹ 3 / 25 › » : position dans une suite parcourue au balayage, avec boutons pour la souris. */
export function Pager({ index, count, onPrev, onNext, label }: { index: number; count: number; onPrev: (() => void) | null; onNext: (() => void) | null; label?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <button className="icon-btn bg-surface-2 disabled:opacity-30" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Précédent">
        <ChevronLeft className="size-5" />
      </button>
      <div className="min-w-0 flex-1 text-center">
        {label && <p className="truncate text-sm font-semibold">{label}</p>}
        <p className="text-xs text-ink-3 tabular-nums">
          {count ? index + 1 : 0} / {count}
          <span className="lg:hidden"> · balayez ← →</span>
        </p>
      </div>
      <button className="icon-btn bg-surface-2 disabled:opacity-30" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Suivant">
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}
