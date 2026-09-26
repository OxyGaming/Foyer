import { ChevronLeft, Loader2, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { STOCK_STATUS_LABEL, type StockStatus } from "../../shared/stock";
import { photoUrl } from "@/lib/api";
import { numToInput, parseNum } from "@/lib/format";

// ─── En-tête de page ─────────────────────────────────────────────────────────

export function PageHeader({ title, back, actions, subtitle }: { title: ReactNode; back?: boolean | string; actions?: ReactNode; subtitle?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="pt-safe sticky top-0 z-20 bg-bg/90 backdrop-blur-md">
      <div className="flex min-h-14 items-center gap-1 px-2">
        {back ? (
          <button
            className="icon-btn"
            aria-label="Retour"
            onClick={() => (typeof back === "string" ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate("/"))}
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : (
          <div className="w-2" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-ink-2">{subtitle}</p>}
        </div>
        <div className="flex items-center">{actions}</div>
      </div>
    </header>
  );
}

// ─── Panneau bas (bottom sheet) ──────────────────────────────────────────────

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="pb-safe relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface px-5 pt-3 pb-2">
          <div className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" />
          <h2 className="mt-2 flex-1 text-lg font-bold">{title}</h2>
          <button className="icon-btn -mr-2 mt-1" onClick={onClose} aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation d'une action destructive, sans window.confirm (bloquant et laid sur mobile). */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; message?: string; confirm: string; resolve: (ok: boolean) => void } | null>(null);
  const ask = (title: string, opts: { message?: string; confirm?: string } = {}) =>
    new Promise<boolean>((resolve) => setState({ title, message: opts.message, confirm: opts.confirm ?? "Supprimer", resolve }));
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = (
    <Sheet open={!!state} onClose={() => close(false)} title={state?.title}>
      {state?.message && <p className="mb-5 text-ink-2">{state.message}</p>}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-soft" onClick={() => close(false)}>
          Annuler
        </button>
        <button className="btn bg-danger text-white" onClick={() => close(true)}>
          {state?.confirm}
        </button>
      </div>
    </Sheet>
  );
  return { ask, dialog };
}

// ─── Divers ──────────────────────────────────────────────────────────────────

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`size-5 animate-spin text-ink-3 ${className}`} />;
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="size-7" />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 text-ink-2">{children}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<StockStatus, string> = {
  ok: "bg-ok-soft text-ok",
  watch: "bg-watch-soft text-watch",
  low: "bg-low-soft text-low",
  out: "bg-out-soft text-out",
  none: "",
};
const STATUS_DOT: Record<StockStatus, string> = { ok: "bg-ok", watch: "bg-watch", low: "bg-low", out: "bg-out", none: "" };

export function StatusBadge({ status, compact }: { status: StockStatus; compact?: boolean }) {
  if (status === "none") return null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {!compact && STOCK_STATUS_LABEL[status]}
    </span>
  );
}

/** Vignette photo, avec emoji de repli quand il n'y a pas de photo. */
export function Thumb({ photoId, fallback, className = "", variant = "thumb", alt = "" }: { photoId: string | null | undefined; fallback: ReactNode; className?: string; variant?: "thumb" | "full"; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (photoId && !failed) {
    return <img src={photoUrl(photoId, variant)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
  }
  return <div className={`flex items-center justify-center bg-surface-2 text-ink-3 ${className}`}>{fallback}</div>;
}

// ─── Champs de formulaire ────────────────────────────────────────────────────

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

/**
 * Saisie numérique tolérante (virgule ou point, vide autorisé).
 * Garde le texte tapé tel quel pendant la frappe pour ne pas gêner « 2, » → « 2,5 ».
 */
export function NumberInput({ value, onChange, id, placeholder, integer, className = "input" }: { value: number | null; onChange: (v: number | null) => void; id?: string; placeholder?: string; integer?: boolean; className?: string }) {
  const [text, setText] = useState(numToInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(numToInput(value));
      last.current = value;
    }
  }, [value]);
  return (
    <input
      id={id}
      className={className}
      inputMode={integer ? "numeric" : "decimal"}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.,]/g, "");
        setText(t);
        let n = parseNum(t);
        if (integer && n != null) n = Math.round(n);
        last.current = n;
        onChange(n);
      }}
    />
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
      {options.map((o) => (
        <button key={o.value} className={`chip ${value === o.value ? "chip-on" : ""}`} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
