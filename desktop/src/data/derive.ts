// The maths behind "What Loop did": counts, verdicts, 3-hour blocks, stretches
// and the morning medians. Pure functions over the active dataset (current.ts).
import { DAYS, G6, LOOP, PERIOD, RATE, SCHED, STATE, USABLE, type Day, type HourState, type Pt } from './current';

export { USABLE, USABLE_N } from './current';

export type Mode = 'hours' | 'blocks';
export type Verdict = 'a' | 'l' | 'm' | 's';

/** How many usable days had this state at this hour. */
export function count(h: number, st: HourState): number {
  return USABLE.filter((d) => STATE[d][h] === st).length;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Relative difference of delivered against scheduled. */
export const diff = (loop: number, sched: number) => (loop - sched) / sched;

/** The verdict the hours table uses: suspended if any day suspended, else ±15% on the medians. */
export function hourVerdict(h: number): Verdict {
  if (count(h, 's') > 0) return 's';
  const d = diff(LOOP[h], SCHED[h]);
  if (Math.abs(d) > PERIOD.tolerance) return d < 0 ? 'l' : 'm';
  return 'a';
}

// ------------------------------------------------------------ labels

/** 6 → "6a", 12 → "12p" (grid and axis labels). */
export const hourTick = (h: number) => `${h % 12 || 12}${h % 24 < 12 ? 'a' : 'p'}`;
/** 6 → "6am" */
export const hourName = (h: number) => `${h % 12 || 12}${h % 24 < 12 ? 'am' : 'pm'}`;

/** [6, 8) → "6–8am", [11, 13) → "11am–1pm", [21, 24) → "9pm–12am". */
export function rangeLabel(start: number, end: number): string {
  const ap = (h: number) => (h % 24 < 12 ? 'am' : 'pm');
  const n = (h: number) => `${h % 12 || 12}`;
  if (ap(start) === ap(end) && end - start < 12 && end !== 24) return `${n(start)}–${n(end)}${ap(end)}`;
  return `${n(start)}${ap(start)}–${n(end)}${ap(end)}`;
}

/** The word for a day's stretch: "mornings", "evenings"... */
export function partOfDay(start: number): { one: string; many: string } {
  if (start >= 4 && start < 12) return { one: 'morning', many: 'mornings' };
  if (start >= 12 && start < 17) return { one: 'afternoon', many: 'afternoons' };
  if (start >= 17 && start < 22) return { one: 'evening', many: 'evenings' };
  return { one: 'night', many: 'nights' };
}

export const verdictWord: Record<Verdict, string> = { a: 'about as scheduled', l: 'less', m: 'more', s: 'suspended' };

/** "−40%" with a true minus sign. */
export const pct = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}%`;

// ------------------------------------------------------------ blocks

export interface Block {
  index: number;
  start: number;
  end: number;
  sched: number;
  /** Mean of the three hourly medians, U/h. */
  loop: number;
  states: Readonly<Record<Day, HourState>>;
  counts: Record<HourState, number>;
  verdict: Verdict;
}

/**
 * A day's state for a 3-hour block. No data if all three hours are missing;
 * otherwise the state at least two of the counted hours share, else about.
 */
export function blockDayState(hours: readonly HourState[]): HourState {
  const seen = hours.filter((s) => s !== 'x');
  if (seen.length === 0) return 'x';
  for (const st of ['s', 'l', 'm', 'a'] as const) {
    if (seen.filter((s) => s === st).length >= 2) return st;
  }
  return 'a';
}

export function blocks(): Block[] {
  return Array.from({ length: 8 }, (_, b) => {
    const start = b * 3;
    const hrs = [start, start + 1, start + 2];
    const states = Object.fromEntries(DAYS.map((d) => [d, blockDayState(hrs.map((h) => STATE[d][h]))])) as Record<Day, HourState>;
    const counts = { a: 0, l: 0, m: 0, s: 0, x: 0 } as Record<HourState, number>;
    for (const d of USABLE) counts[states[d]] += 1;
    const sched = round2(hrs.reduce((t, h) => t + SCHED[h], 0) / 3);
    const loop = round2(hrs.reduce((t, h) => t + LOOP[h], 0) / 3);
    const dd = diff(loop, sched);
    const verdict: Verdict = counts.s > 0 ? 's' : Math.abs(dd) > PERIOD.tolerance ? (dd < 0 ? 'l' : 'm') : 'a';
    return { index: b, start, end: start + 3, sched, loop, states, counts, verdict };
  });
}

// ------------------------------------------------------------ selection

/** A selected column: an hour in hours mode, a block in blocks mode. */
export interface Selection {
  start: number;
  end: number;
  sched: number;
  loop: number;
  verdict: Verdict;
  /** Days (of USABLE_N) that showed the verdict's state. */
  n: number;
  /** Usable days that didn't, for the sheet's sentence. */
  others: Day[];
}

export function select(mode: Mode, col: number): Selection {
  if (mode === 'blocks') {
    const b = blocks()[col];
    const st: HourState = b.verdict;
    return { start: b.start, end: b.end, sched: b.sched, loop: b.loop, verdict: b.verdict, n: b.counts[st], others: USABLE.filter((d) => b.states[d] !== st) };
  }
  const v = hourVerdict(col);
  return {
    start: col, end: col + 1, sched: SCHED[col], loop: LOOP[col], verdict: v,
    n: count(col, v), others: USABLE.filter((d) => STATE[d][col] !== v),
  };
}

/**
 * The stretch an hour belongs to: neighbouring hours with the same verdict.
 * An hour that ran about as scheduled is a stretch of one.
 */
export function stretchFor(h: number): [number, number] {
  const v = hourVerdict(h);
  if (v === 'a') return [h, h + 1];
  let a = h;
  let b = h + 1;
  while (a > 0 && hourVerdict(a - 1) === v) a -= 1;
  while (b < 24 && hourVerdict(b) === v) b += 1;
  return [a, b];
}

/** Hours [start, end) for the selected column, as the mornings view takes them. */
export const stretchOf = (mode: Mode, col: number): [number, number] => (mode === 'blocks' ? [col * 3, col * 3 + 3] : stretchFor(col));

// ------------------------------------------------------------ per-day samples

/** Per-day delivered rate for the hours-table dots (i: index in USABLE). Measured when the source has it; else the board formula. */
export function sparkValue(i: number, h: number): number {
  if (RATE) return RATE[USABLE[i]][h];
  const st = STATE[USABLE[i]][h];
  const s = SCHED[h];
  if (st === 'l') return s * (0.48 + (0.12 * ((i * 3 + h) % 4)) / 3);
  if (st === 'm') return s * (1.22 + (0.08 * ((i + h) % 3)) / 2);
  if (st === 's') return 0;
  return s * (0.96 + (0.08 * ((i * 7 + h) % 5)) / 4);
}

/** Per-day delivered rate for the morning bars (i: index in DAYS). Board formula. */
export function morningValue(i: number, h: number): number {
  if (RATE) return RATE[DAYS[i]][h];
  const st = STATE[DAYS[i]][h];
  const s = SCHED[h];
  if (st === 'l') return s * (0.5 + 0.03 * ((i * 5 + h) % 5));
  if (st === 'm') return s * 1.2;
  if (st === 's') return 0;
  return s * (0.97 + 0.02 * (i % 3));
}

// ------------------------------------------------------------ morning medians

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 6am glucose on mornings Loop delivered less at 6am, against those it ran as scheduled. */
export function morningGlucose(h = 6) {
  const g = (st: HourState) => USABLE.filter((d) => STATE[d][h] === st && G6[d]).map((d) => G6[d]!.mgdl);
  const less = g('l');
  const about = g('a').sort((a, b) => a - b);
  return { less, lessMedian: median(less), about, aboutMedian: median(about) };
}

/** Highest point of a glucose series. */
export function peak(series: readonly Pt[]): Pt {
  return series.reduce((p, c) => (c[1] > p[1] ? c : p));
}
