import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { TargetRange } from '@/data/loopTherapyStore';
import type { LoopTherapy } from '@/data/loopTherapy';
import { iobAt, modelFromTherapy, netInsulinImpulses } from '@/lib/metabolism/insulinActivity';
import { modelCumulativeFraction, modelKindForEntry, STEP_MINUTES } from '@/lib/metabolism/carbAbsorption';
import { MIN_READINGS_PER_CELL_WEEK, MIN_WEEKS_PER_CELL, PATTERN_SAMPLE_WEEKS, WEEKDAY_LABELS } from './dayHourGrid';

// The average weekday, hour by hour: glucose, insulin on board and carbs on
// board, laid out the way Loop's status screen lays out the last few hours.
//
// The day-hour grid answers "how often does this hour go out of range"; this
// answers "what does this hour usually look like", with the two things Loop is
// working against alongside it. A Tuesday 3pm low reads differently when
// Tuesdays at 1pm carry 3 U on board than when they carry none.
//
// Same evidence rule as the grid: THE WEEK IS THE UNIT. Each figure is the mean
// of each week's mean for that hour, so one Tuesday with a stuck sensor cannot
// outvote eleven ordinary ones. Glucose needs MIN_READINGS_PER_CELL_WEEK
// readings in a week's hour before that week counts.
//
// IOB and COB are reconstructed from the treatment history rather than read
// from Loop's devicestatus: devicestatus is only kept for a fortnight, and
// twelve weeks of it would be tens of megabytes. IOB is netted against the
// basal schedule the way Loop counts it, so it can sit below zero after a long
// low temp. COB follows each entry's own absorption time and curve.

export type HourAverage = {
  hour: number;
  /** Weeks whose glucose in this hour was dense enough to count. */
  weeks: number;
  reliable: boolean;
  glucoseMgdl: number | null;
  /** Spread of the weekly means: the middle half of the weeks. */
  glucoseP25: number | null;
  glucoseP75: number | null;
  lowPct: number | null;
  highPct: number | null;
  /** Mean insulin on board across the hour, units. Null without insulin history. */
  iobU: number | null;
  /** Mean carbs on board across the hour, grams. Null without treatment history. */
  cobG: number | null;
};

export type WeekdayAverage = {
  weekday: number;
  label: string;
  /** Instances of this weekday inside the sample that carried any glucose. */
  weeksObserved: number;
  hours: HourAverage[];
};

export type WeekdayHourly = {
  days: WeekdayAverage[];
  sampleWeeks: number;
  fromIso: string;
  toIso: string;
  /**
   * 'net': boluses and temp basals netted against the schedule, as Loop
   * counts IOB. 'bolus_only': the source has boluses and nothing else, so the
   * figure leaves out whatever Loop did with basal.
   */
  iobBasis: 'net' | 'bolus_only';
  targetLowMgdl: number;
  targetHighMgdl: number;
};

const HOUR_MS = 3600_000;

/** Monday-first week key, matching dayHourGrid.ts. */
function weekKey(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return `${copy.getFullYear()}-${copy.getMonth()}-${copy.getDate()}`;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null;
}

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

type Acc = { sum: number; n: number };
type GlucoseAcc = { sum: number; n: number; low: number; high: number };

/** [weekday][hour] -> week -> accumulator */
function grid<T>(): Map<string, T>[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Map<string, T>()));
}

function accFor<T>(cells: Map<string, T>[][], d: Date, make: () => T): T {
  const map = cells[d.getDay()][d.getHours()];
  const wk = weekKey(d);
  let a = map.get(wk);
  if (!a) { a = make(); map.set(wk, a); }
  return a;
}

/** Carbs still to absorb at `atMs`, grams. `carbs` sorted oldest first. */
function cobAt(atMs: number, carbs: { ms: number; grams: number; minutes: number; kind: ReturnType<typeof modelKindForEntry> }[], from: number): number {
  let total = 0;
  for (let i = from; i < carbs.length; i += 1) {
    const c = carbs[i];
    if (c.ms > atMs) break;
    const elapsed = (atMs - c.ms) / 60_000;
    if (elapsed >= c.minutes) continue;
    total += c.grams * (1 - modelCumulativeFraction(c.kind, elapsed / c.minutes));
  }
  return total;
}

export function computeWeekdayHourly(input: {
  glucose: GlucoseReading[];
  /** Boluses, plus temp basals where the source has them. */
  insulin: InsulinEvent[];
  carbs: CarbEntry[];
  therapy: LoopTherapy;
  target: TargetRange;
  now: Date;
  weeks?: number;
}): WeekdayHourly {
  const { target, now, therapy } = input;
  const sampleWeeks = input.weeks ?? PATTERN_SAMPLE_WEEKS;
  const nowMs = now.getTime();
  const fromMs = nowMs - sampleWeeks * 7 * 24 * HOUR_MS;

  // ── glucose ──
  const glucoseCells = grid<GlucoseAcc>();
  const weeksPerDay: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
  for (const r of input.glucose) {
    const t = new Date(r.iso).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(r.mgdl) || t < fromMs || t > nowMs) continue;
    const d = new Date(t);
    weeksPerDay[d.getDay()].add(weekKey(d));
    const a = accFor(glucoseCells, d, () => ({ sum: 0, n: 0, low: 0, high: 0 }));
    a.sum += r.mgdl;
    a.n += 1;
    if (r.mgdl < target.lowMgdl) a.low += 1;
    else if (r.mgdl > target.highMgdl) a.high += 1;
  }

  // ── insulin and carbs on board, sampled every 5 minutes ──
  // Sampling starts once a full insulin duration of history sits behind it;
  // before that, IOB would read low for want of the doses that preceded it.
  const model = modelFromTherapy(therapy);
  const impulses = netInsulinImpulses(input.insulin, therapy);
  const carbs = input.carbs
    .map((c) => ({
      ms: new Date(c.iso).getTime(),
      grams: c.grams,
      minutes: Math.max(STEP_MINUTES, c.absorptionHours * 60),
      kind: modelKindForEntry(c),
    }))
    .filter((c) => Number.isFinite(c.ms) && c.grams > 0)
    .sort((a, b) => a.ms - b.ms);
  const longestCarbMs = carbs.reduce((m, c) => Math.max(m, c.minutes * 60_000), 0);

  const firstTreatmentMs = Math.min(impulses[0]?.ms ?? Infinity, carbs[0]?.ms ?? Infinity);
  const hasTreatments = Number.isFinite(firstTreatmentMs);
  const iobCells = grid<Acc>();
  const cobCells = grid<Acc>();
  if (hasTreatments) {
    const step = STEP_MINUTES * 60_000;
    const startMs = Math.max(fromMs, firstTreatmentMs + model.durationMinutes * 60_000);
    // Align to the clock so every hour gets the same twelve samples.
    let t = Math.ceil(startMs / step) * step;
    let carbFrom = 0;
    for (; t <= nowMs; t += step) {
      while (carbFrom < carbs.length && carbs[carbFrom].ms + longestCarbMs < t) carbFrom += 1;
      const d = new Date(t);
      const iob = accFor(iobCells, d, () => ({ sum: 0, n: 0 }));
      iob.sum += iobAt(t, impulses, model);
      iob.n += 1;
      const cob = accFor(cobCells, d, () => ({ sum: 0, n: 0 }));
      cob.sum += cobAt(t, carbs, carbFrom);
      cob.n += 1;
    }
  }

  // ── reduce across weeks ──
  const days: WeekdayAverage[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const hours: HourAverage[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const voting = [...glucoseCells[weekday][hour].values()].filter((a) => a.n >= MIN_READINGS_PER_CELL_WEEK);
      const weekMeans = voting.map((a) => a.sum / a.n);
      const readings = voting.reduce((s, a) => s + a.n, 0);
      const reliable = voting.length >= MIN_WEEKS_PER_CELL;
      const g = mean(weekMeans);
      const p25 = quantile(weekMeans, 0.25);
      const p75 = quantile(weekMeans, 0.75);
      const iobWeeks = [...iobCells[weekday][hour].values()].map((a) => a.sum / a.n);
      const cobWeeks = [...cobCells[weekday][hour].values()].map((a) => a.sum / a.n);
      const iob = mean(iobWeeks);
      const cob = mean(cobWeeks);
      hours.push({
        hour,
        weeks: voting.length,
        reliable,
        glucoseMgdl: g == null ? null : Math.round(g),
        glucoseP25: p25 == null ? null : Math.round(p25),
        glucoseP75: p75 == null ? null : Math.round(p75),
        lowPct: readings ? Math.round((voting.reduce((s, a) => s + a.low, 0) / readings) * 100) : null,
        highPct: readings ? Math.round((voting.reduce((s, a) => s + a.high, 0) / readings) * 100) : null,
        iobU: iob == null ? null : +iob.toFixed(2),
        cobG: cob == null ? null : Math.round(cob),
      });
    }
    days.push({ weekday, label: WEEKDAY_LABELS[weekday], weeksObserved: weeksPerDay[weekday].size, hours });
  }

  return {
    days,
    sampleWeeks,
    fromIso: new Date(fromMs).toISOString(),
    toIso: now.toISOString(),
    iobBasis: input.insulin.some((e) => e.kind !== 'bolus') ? 'net' : 'bolus_only',
    targetLowMgdl: target.lowMgdl,
    targetHighMgdl: target.highMgdl,
  };
}

/**
 * Where a notification or inbox row about a weekday opens. `from`/`to` mark
 * the stretch the alert was about; the screen opens with it highlighted.
 */
export function weekdayPatternPath(input: { weekday: number; startHour?: number; endHour?: number }): string {
  const p = new URLSearchParams({ day: String(input.weekday) });
  if (input.startHour != null) p.set('from', String(input.startHour));
  if (input.endHour != null) p.set('to', String(input.endHour));
  return `/app/weekday?${p.toString()}`;
}
