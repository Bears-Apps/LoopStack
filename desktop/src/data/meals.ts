// Meal response: what glucose and insulin did after each carb entry. For each
// meal: the glucose at entry, the peak and when it came, the rise, the 2-hour
// value, the absorption time Loop was given (entered) against how long glucose
// took to come back near where it started (observed), and active insulin at
// entry and at its peak. Grouped by the meal's name so repeats line up.
// Observations only (SAFE-1): it says what happened, never what to enter.

export interface MealResponse {
  id: string;
  /** ms */
  at: number;
  /** "Tue Nov 10, 12:15pm" */
  when: string;
  /** Loop's food type / favorite name, else "Carbs". */
  name: string;
  carbsG: number;
  /** Insulin the person bolused within 15 minutes of the entry, U. */
  bolusU: number;
  /** Absorption time entered with the carbs, minutes; null if none. */
  enteredMin: number | null;
  /** Minutes until glucose came back within 20 mg/dL of the start; null if it didn't within 6 hours, or another meal came first. */
  observedMin: number | null;
  startMgdl: number;
  peakMgdl: number;
  peakAfterMin: number;
  riseMgdl: number;
  at2hMgdl: number | null;
  iobAtEntryU: number | null;
  iobPeakU: number | null;
  /** Lowest and highest glucose from entry to 6 hours or the next meal (the same window as observed). */
  lowMgdl: number;
  highMgdl: number;
  /** How it went over that window: below 70 at any point, else above 180 at any point, else stayed 70-180. */
  outcome: MealOutcome;
  /** Glucose every 10 minutes for up to 6 hours from entry, stopping at the next meal: [minutes, mg/dL]. */
  curve: readonly (readonly [number, number])[];
}

export type MealOutcome = 'low' | 'high' | 'in';
export const outcomeOf = (low: number, high: number): MealOutcome => (low < 70 ? 'low' : high > 180 ? 'high' : 'in');

export interface MealGroup {
  name: string;
  n: number;
  medianCarbsG: number;
  medianRiseMgdl: number;
  medianPeakAfterMin: number;
  medianEnteredMin: number | null;
  medianObservedMin: number | null;
  /** Meals whose observed time came back. */
  observedN: number;
  /** How many went low, high, or stayed in range. */
  outcomes: Record<MealOutcome, number>;
}

export interface Meals {
  recent: MealResponse[];
  groups: MealGroup[];
  /** Days covered. */
  days: number;
}

export interface MealInputs {
  carbs: { at: number; grams: number; absorptionMin: number | null; name: string | null }[];
  boluses: { at: number; units: number }[];
  glucose: { at: number; mgdl: number }[];
  iob: { at: number; u: number }[];
}

const MIN = 60_000;
const median = (v: readonly number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const whenLabel = (ms: number) => {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};

/** Sorted-array lookup: the reading nearest `t`, within `within` ms. */
function nearest<T extends { at: number }>(xs: readonly T[], t: number, within: number): T | null {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid].at < t) lo = mid + 1; else hi = mid; }
  let best: T | null = null;
  for (const i of [lo - 1, lo, lo + 1]) {
    const x = xs[i];
    if (x && Math.abs(x.at - t) <= within && (!best || Math.abs(x.at - t) < Math.abs(best.at - t))) best = x;
  }
  return best;
}

export function mealResponses(input: MealInputs, from: number, to: number): Meals {
  const glucose = [...input.glucose].sort((a, b) => a.at - b.at);
  const iob = [...input.iob].sort((a, b) => a.at - b.at);
  const carbs = input.carbs.filter((c) => c.grams >= 5).sort((a, b) => a.at - b.at);
  const recent: MealResponse[] = [];
  carbs.forEach((c, i) => {
    if (c.at < from || c.at >= to) return;
    const start = nearest(glucose, c.at, 10 * MIN);
    if (!start) return;
    // The window ends at the next meal of 15 g or more, or after 4 hours.
    const next = carbs.slice(i + 1).find((n) => n.grams >= 15)?.at ?? Infinity;
    const end = Math.min(c.at + 4 * 60 * MIN, next);
    const win = glucose.filter((g) => g.at >= c.at && g.at <= end);
    if (win.length < 6) return;
    const peak = win.reduce((p, g) => (g.mgdl > p.mgdl ? g : p));
    // Observed: first time after the peak that glucose is back within 20 of the start (up to 6 h, before the next meal).
    const after = glucose.filter((g) => g.at > peak.at && g.at <= Math.min(c.at + 6 * 60 * MIN, next));
    const back = peak.mgdl - start.mgdl < 20 ? peak : after.find((g) => g.mgdl <= start.mgdl + 20);
    const curve: [number, number][] = [];
    for (let m = 0; m <= 360; m += 10) {
      const g = nearest(glucose, c.at + m * MIN, 6 * MIN);
      if (g && c.at + m * MIN <= Math.min(next, c.at + 360 * MIN)) curve.push([m, g.mgdl]);
    }
    const iobWin = iob.filter((x) => x.at >= c.at && x.at <= end);
    const owin = glucose.filter((g) => g.at >= c.at && g.at <= Math.min(c.at + 6 * 60 * MIN, next));
    const lowMgdl = Math.min(...owin.map((g) => g.mgdl));
    const highMgdl = Math.max(...owin.map((g) => g.mgdl));
    recent.push({
      id: `${c.at}`,
      at: c.at,
      when: whenLabel(c.at),
      name: c.name?.trim() || 'Carbs',
      carbsG: Math.round(c.grams),
      bolusU: Math.round(input.boluses.filter((b) => Math.abs(b.at - c.at) <= 15 * MIN).reduce((t, b) => t + b.units, 0) * 100) / 100,
      enteredMin: c.absorptionMin,
      observedMin: back ? Math.round((back.at - c.at) / MIN) : null,
      startMgdl: start.mgdl,
      peakMgdl: peak.mgdl,
      peakAfterMin: Math.round((peak.at - c.at) / MIN),
      riseMgdl: peak.mgdl - start.mgdl,
      at2hMgdl: nearest(glucose, c.at + 120 * MIN, 10 * MIN)?.mgdl ?? null,
      iobAtEntryU: nearest(iob, c.at, 10 * MIN)?.u ?? null,
      iobPeakU: iobWin.length ? Math.max(...iobWin.map((x) => x.u)) : null,
      lowMgdl,
      highMgdl,
      outcome: outcomeOf(lowMgdl, highMgdl),
      curve,
    });
  });
  const byName = new Map<string, MealResponse[]>();
  for (const m of recent) byName.set(m.name, [...(byName.get(m.name) ?? []), m]);
  const groups: MealGroup[] = [...byName].map(([name, ms]) => {
    const obs = ms.map((m) => m.observedMin).filter((v): v is number => v != null);
    const ent = ms.map((m) => m.enteredMin).filter((v): v is number => v != null);
    return {
      name,
      n: ms.length,
      medianCarbsG: Math.round(median(ms.map((m) => m.carbsG)) ?? 0),
      medianRiseMgdl: Math.round(median(ms.map((m) => m.riseMgdl)) ?? 0),
      medianPeakAfterMin: Math.round(median(ms.map((m) => m.peakAfterMin)) ?? 0),
      medianEnteredMin: ent.length ? Math.round(median(ent)!) : null,
      medianObservedMin: obs.length ? Math.round(median(obs)!) : null,
      observedN: obs.length,
      outcomes: {
        in: ms.filter((m) => m.outcome === 'in').length,
        high: ms.filter((m) => m.outcome === 'high').length,
        low: ms.filter((m) => m.outcome === 'low').length,
      },
    };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { recent: recent.reverse(), groups, days: Math.round((to - from) / (24 * 60 * MIN)) };
}

/** "3h" / "2h 30m" / "45m" */
export const dur = (min: number | null) => (min == null ? '—' : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`);

export interface CurveBand { t: number; p25: number; p50: number; p75: number; n: number }

/**
 * One food's glucose after it, summarized every 10 minutes: the median and the
 * middle half (25th–75th) of every time it was eaten. A point needs at least
 * `minN` meals still reading at that minute (a curve stops at the next meal),
 * so the line ends where the evidence thins out.
 */
export function curveBands(meals: readonly Pick<MealResponse, 'curve'>[], minN = 2): CurveBand[] {
  const at = new Map<number, number[]>();
  for (const m of meals) for (const [t, g] of m.curve) (at.get(t) ?? at.set(t, []).get(t)!).push(g);
  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return Math.round(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo));
  };
  const out: CurveBand[] = [];
  for (const t of [...at.keys()].sort((a, b) => a - b)) {
    const xs = at.get(t)!;
    if (xs.length < minN) break;
    out.push({ t, p25: q(xs, 0.25), p50: q(xs, 0.5), p75: q(xs, 0.75), n: xs.length });
  }
  return out;
}

/** How deep a food's lows went. Yellow: under 70 but not under 60. Light red: under 60 but not under 55. Red: under 55. */
export type LowDepth = 'none' | 'watch' | 'low' | 'severe';
export const LOW_WATCH = 70;
export const LOW_LOW = 60;
export const LOW_SEVERE = 55;

export function depthOf(g: number): LowDepth {
  return g < LOW_SEVERE ? 'severe' : g < LOW_LOW ? 'low' : g < LOW_WATCH ? 'watch' : 'none';
}

const DEPTH_RANK: Record<LowDepth, number> = { none: 0, watch: 1, low: 2, severe: 3 };

/**
 * How low glucose went after a food, over each entry's window (to 6 hours or the
 * next meal). `level` is the deepest any time reached; `times` is how many of the
 * `of` times reached that depth; `lowest` is the lowest reading seen.
 */
export function lowDepth(meals: readonly Pick<MealResponse, 'curve'>[]): { level: LowDepth; lowest: number | null; times: number; of: number } {
  let level: LowDepth = 'none';
  let lowest: number | null = null;
  const per = meals.map((m) => {
    let d: LowDepth = 'none';
    for (const [, g] of m.curve) {
      if (lowest === null || g < lowest) lowest = g;
      if (DEPTH_RANK[depthOf(g)] > DEPTH_RANK[d]) d = depthOf(g);
    }
    if (DEPTH_RANK[d] > DEPTH_RANK[level]) level = d;
    return d;
  });
  return { level, lowest, times: per.filter((d) => d === level).length, of: meals.length };
}
