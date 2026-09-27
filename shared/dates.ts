// Dates « calendrier » au format YYYY-MM-DD, sans fuseau : un repas du lundi
// reste le lundi quel que soit l'appareil. Calculs faits en UTC pour éviter
// les décalages des changements d'heure.

export const MEALS = ["breakfast", "lunch", "snack", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: "Petit-déjeuner",
  lunch: "Déjeuner",
  snack: "Goûter",
  dinner: "Dîner",
};
export const DEFAULT_MEALS: Meal[] = ["lunch", "dinner"];

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Date locale de l'appareil (pas UTC) au format YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jours de la semaine, dans la numérotation de getUTCDay (0 = dimanche). */
export const WEEKDAY_LABEL = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
export const DEFAULT_WEEK_START = 1;

/** Premier jour de la semaine contenant `iso` ; `firstDay` : 0 = dimanche, 1 = lundi … 6 = samedi. */
export function weekStart(iso: string, firstDay = DEFAULT_WEEK_START): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((day - firstDay + 7) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const dmFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const formatDayLong = (iso: string) => dayFmt.format(asDate(iso));
export const formatDayShort = (iso: string) => shortFmt.format(asDate(iso));
export const formatDayMonth = (iso: string) => dmFmt.format(asDate(iso));

export function relativeDayLabel(iso: string, today = todayIso()): string | null {
  if (iso === today) return "Aujourd'hui";
  if (iso === addDays(today, 1)) return "Demain";
  if (iso === addDays(today, -1)) return "Hier";
  return null;
}
