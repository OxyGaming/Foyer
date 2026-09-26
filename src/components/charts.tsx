// Petits graphiques SVG à série unique (couleur --chart, validée clair/sombre).
// Règles suivies : marques fines, bout arrondi 4 px côté donnée, grille en
// filet recessif, pas de double axe, texte en couleurs d'encre (jamais la
// couleur de la série), info-bulle au survol comme au toucher.
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Pas « rond » (1, 2, 5 × 10ⁿ) pour ~3 graduations. */
function niceStep(max: number, ticks = 3) {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Colonne avec bout arrondi (4 px) en haut, base carrée sur la ligne de base. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Reste dans le cadre : ancré à gauche/droite près des bords.
  const left = Math.max(4, Math.min(x, width - 4));
  const shift = x < 80 ? "0%" : x > width - 80 ? "-100%" : "-50%";
  return (
    <div className="pointer-events-none absolute z-10 rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-bg shadow-lg" style={{ left, top: y, transform: `translate(${shift}, calc(-100% - 8px))` }}>
      {children}
    </div>
  );
}

// ─── Liste de barres horizontales (répartition) ──────────────────────────────

export type BarItem = { key: string; label: ReactNode; valueCents: number; hint?: string };

/** Classement avec barres : valeur lisible sur chaque ligne (c'est aussi la vue tableau). */
export function BarList({ items, total }: { items: BarItem[]; total: number }) {
  const max = Math.max(...items.map((i) => i.valueCents), 1);
  return (
    <ul className="space-y-3">
      {items.map((i) => {
        const share = total > 0 ? Math.round((i.valueCents / total) * 100) : 0;
        return (
          <li key={i.key} title={`${i.hint ?? ""}${formatCents(i.valueCents)} · ${share} %`}>
            <div className="mb-1 flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{i.label}</span>
              <span className="font-semibold tabular-nums">{formatCents(i.valueCents)}</span>
              <span className="w-10 text-right text-xs text-ink-3 tabular-nums">{share} %</span>
            </div>
            <div className="h-2.5 w-full">
              <div className="h-full rounded-r-[4px] bg-chart" style={{ width: `${Math.max(2, (i.valueCents / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Colonnes (dépenses par période) ─────────────────────────────────────────

export type Column = { key: string; label: string; tooltip: string; valueCents: number };

export function ColumnChart({ data, height = 170, ariaLabel }: { data: Column[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const padL = 44;
  const padB = 22;
  const padT = 10;
  const plotW = Math.max(0, width - padL);
  const plotH = height - padB - padT;
  const maxV = Math.max(...data.map((d) => d.valueCents), 0);
  const step = niceStep(maxV || 100);
  const top = Math.max(step, Math.ceil(maxV / step) * step);
  const band = data.length ? plotW / data.length : 0;
  const colW = Math.min(24, band * 0.62);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 34)));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div ref={ref} className="relative w-full select-none" onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular-nums">
                {formatCents(t, true).replace(/\s?€/, " €")}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * band + (band - colW) / 2;
            const h = Math.max(0, plotH - (y(d.valueCents) - padT));
            return (
              <g key={d.key}>
                {d.valueCents > 0 && <path d={columnPath(x, y(d.valueCents), colW, h)} fill="var(--chart)" opacity={active == null || active === i ? 1 : 0.45} />}
                {i % labelEvery === 0 && (
                  <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[10px]">
                    {d.label}
                  </text>
                )}
                {/* Zone de survol/toucher : toute la bande, plus large que la colonne. */}
                <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {active != null && data[active] && (
        <Tooltip x={padL + active * band + band / 2} y={y(data[active].valueCents)} width={width}>
          <span className="block text-bg/70">{data[active].tooltip}</span>
          <b>{formatCents(data[active].valueCents)}</b>
        </Tooltip>
      )}
    </div>
  );
}

// ─── Historique d'un prix unitaire ───────────────────────────────────────────

export type PricePointView = { id: string; date: string; unitCents: number; isPromo: boolean; store: string | null };

const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function PriceChart({ points, avgCents, unitLabel, height = 150 }: { points: PricePointView[]; avgCents: number; unitLabel: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const padL = 44;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const times = points.map((p) => new Date(p.date).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const vals = points.map((p) => p.unitCents).concat(avgCents);
  const step = niceStep(Math.max(...vals) - Math.min(...vals) || Math.max(...vals) || 100);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - step / 2) / step) * step);
  const hi = Math.ceil((Math.max(...vals) + step / 2) / step) * step;
  const x = (t: number) => padL + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(p.unitCents).toFixed(1)}`).join("");

  function nearest(clientX: number, el: SVGSVGElement) {
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
    setActive(best);
  }

  return (
    <div ref={ref} className="relative w-full select-none">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Évolution du prix unitaire, moyenne ${formatCents(avgCents)} par ${unitLabel}`}
          onMouseMove={(e) => nearest(e.clientX, e.currentTarget)}
          onMouseLeave={() => setActive(null)}
          onClick={(e) => nearest(e.clientX, e.currentTarget)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[10px] tabular-nums">
                {formatCents(t)}
              </text>
            </g>
          ))}
          {/* Référence : coût moyen (filet d'encre, libellé direct). */}
          <line x1={padL} x2={width - padR} y1={y(avgCents)} y2={y(avgCents)} stroke="var(--ink-3)" strokeWidth={1} />
          {/* À gauche : les points récents (à droite) ne le recouvrent pas. */}
          <text x={padL + 4} y={y(avgCents) - 4} className="fill-ink-2 text-[10px] font-semibold">
            moyenne
          </text>
          <path d={line} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle
              key={p.id}
              cx={x(times[i])}
              cy={y(p.unitCents)}
              r={active === i ? 5.5 : 4}
              // Promo : point creux (identité portée par la forme, pas par une autre couleur).
              fill={p.isPromo ? "var(--surface)" : "var(--chart)"}
              stroke={p.isPromo ? "var(--chart)" : "var(--surface)"}
              strokeWidth={2}
            />
          ))}
          <text x={padL} y={height - 6} className="fill-ink-3 text-[10px]">
            {shortDate.format(t0)}
          </text>
          {t1 !== t0 && (
            <text x={width - padR} y={height - 6} textAnchor="end" className="fill-ink-3 text-[10px]">
              {shortDate.format(t1)}
            </text>
          )}
        </svg>
      )}
      {active != null && points[active] && (
        <Tooltip x={x(times[active])} y={y(points[active].unitCents)} width={width}>
          <span className="block text-bg/70">
            {shortDate.format(times[active])}
            {points[active].store ? ` · ${points[active].store}` : ""}
            {points[active].isPromo ? " · promo" : ""}
          </span>
          <b>
            {formatCents(points[active].unitCents)}/{unitLabel}
          </b>
        </Tooltip>
      )}
      {points.some((p) => p.isPromo) && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
          <span className="inline-block size-2.5 rounded-full border-2 border-chart" /> achat en promotion
        </p>
      )}
    </div>
  );
}
