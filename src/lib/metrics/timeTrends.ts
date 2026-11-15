import type { GlucoseReading } from '@/data/sources/types';
import type { MetricsRange } from '@/data/types';
import type { TargetRange } from './computeMetrics';
import { CONSENSUS_TARGET_RANGE } from './computeMetrics';

// When-based glucose trends: same readings the dashboard already has, sliced by
// day of week and by hour of day instead of by recency.
//
// WHY: an aggregate "82% in range" hides that Sunday evenings run high and 3am
// runs low. These are the two cuts that most reliably surface a schedule
// problem — a basal or ratio band that is wrong at one time — which is exactly
// what Ryan can act on, since his settings ARE schedule-based.
//
// Every bucket carries its own sample count. A day with two readings is not a
// trend, and the UI needs the count to say so rather than drawing a confident
// bar over noise.

export type TrendBucket = {
  /** 0–6 (Sun–Sat) for day-of-week, 0–23 for hour-of-day. */
  key: number;
  label: string;
  /** Mean glucose in the bucket, or null when empty. */
  avgMgdl: number | null;
  /** Percent of readings within the target range. */
  inRangePct: number;
  /** Percent below the target low (time low is the safety-relevant tail). */
  lowPct: number;
  /** Percent above the target high. */
  highPct: number;
  readingCount: number;
};

/** One calendar day of the current week — the home-screen rhythm strip. Unlike
 *  a day-of-week bucket (all Mondays averaged), this is a specific dated day. */
export type DayRhythm = {
  /** 0–6, Monday-first, for display order. */
  index: number;
  /** Single letter: M T W T F S S. */
  label: string;
  /** Start-of-day ISO for this calendar day. */
  dateIso: string;
  /** Time in range for this day, or null when no readings yet. */
  tirPct: number | null;
  readingCount: number;
  isToday: boolean;
  /** True for days that haven't happened — drawn as empty, not zero. */
  isFuture: boolean;
  /** Days this segment covers. 1 for a single day; >1 for bucketed windows. */
  spanDays?: number;
};

export type TimeTrends = {
  byDayOfWeek: TrendBucket[];
  byHourOfDay: TrendBucket[];
  /** The current calendar week, Monday-first. */
  weekRhythm: DayRhythm[];
  /**
   * One rhythm strip per selected range. Wide windows are bucketed into
   * multi-day segments so the strip stays readable — 90 daily rings is not a
   * chart anyone can read. Each entry reports the days it covers.
   */
  rhythmByRange: Record<MetricsRange, DayRhythm[]>;
  totalReadings: number;
  /** The boundaries these buckets were scored against. */
  targetLowMgdl: number;
  targetHighMgdl: number;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Monday-first single letters for the rhythm strip.
const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function hourLabel(h: number): string {
  const period = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

type Accum = { sum: number; count: number; inRange: number; low: number; high: number };

function emptyAccum(): Accum {
  return { sum: 0, count: 0, inRange: 0, low: 0, high: 0 };
}

function finalize(acc: Accum, key: number, label: string): TrendBucket {
  if (acc.count === 0) {
    return { key, label, avgMgdl: null, inRangePct: 0, lowPct: 0, highPct: 0, readingCount: 0 };
  }
  return {
    key,
    label,
    avgMgdl: Math.round(acc.sum / acc.count),
    inRangePct: Math.round((acc.inRange / acc.count) * 100),
    lowPct: Math.round((acc.low / acc.count) * 100),
    highPct: Math.round((acc.high / acc.count) * 100),
    readingCount: acc.count,
  };
}

/**
 * Bucket readings by day of week and hour of day.
 *
 * Uses the same target boundaries as the dashboard, so "in range" means the
 * same thing everywhere. Local time on purpose — a 6pm spike is about when
 * Ryan ate dinner, not UTC.
 */
// How a window is cut into segments. Single days stay single days while the
// window is short enough to read; wider windows collapse into equal multi-day
// buckets so the strip never exceeds seven marks.
const RHYTHM_SHAPE: Record<MetricsRange, { buckets: number; days: number }> = {
  today: { buckets: 1, days: 1 },
  '3d': { buckets: 3, days: 1 },
  '7d': { buckets: 7, days: 1 },
  '14d': { buckets: 7, days: 2 },
  '30d': { buckets: 6, days: 5 },
  '90d': { buckets: 6, days: 15 },
  '180d': { buckets: 6, days: 30 },
};

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' });

/**
 * A rhythm strip for a trailing window ending today. Segments run oldest to
 * newest so the strip reads left-to-right like the rest of the app's time
 * series. Segments with no readings stay null rather than scoring zero.
 */
export function computeRangeRhythm(
  glucose: GlucoseReading[],
  range: MetricsRange,
  target: TargetRange = CONSENSUS_TARGET_RANGE,
  now: Date = new Date(),
): DayRhythm[] {
  const shape = RHYTHM_SHAPE[range];
  const todayStart = startOfDay(now);
  const acc = Array.from({ length: shape.buckets }, emptyAccum);

  // The window ends at the end of today and runs back buckets*days.
  const windowEndMs = todayStart.getTime() + DAY_MS;
  const spanMs = shape.days * DAY_MS;
  const windowStartMs = windowEndMs - shape.buckets * spanMs;

  for (const r of glucose) {
    const ms = new Date(r.iso).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms < windowStartMs || ms >= windowEndMs) continue;

    const idx = Math.floor((ms - windowStartMs) / spanMs);
    if (idx < 0 || idx >= shape.buckets) continue;

    const a = acc[idx];
    a.sum += r.mgdl;
    a.count += 1;
    if (r.mgdl < target.lowMgdl) a.low += 1;
    else if (r.mgdl > target.highMgdl) a.high += 1;
    else a.inRange += 1;
  }

  return acc.map((a, i) => {
    const startMs = windowStartMs + i * spanMs;
    const start = new Date(startMs);
    // Single-day buckets keep the weekday letter; wider ones show their start
    // date, which is the only label that stays honest once a mark spans weeks.
    const label =
      shape.days === 1 ? WEEK_LETTERS[(start.getDay() + 6) % 7] : SHORT_DATE.format(start);
    return {
      index: i,
      label,
      dateIso: start.toISOString(),
      tirPct: a.count > 0 ? Math.round((a.inRange / a.count) * 100) : null,
      readingCount: a.count,
      isToday: shape.days === 1 && startMs === todayStart.getTime(),
      isFuture: startMs > todayStart.getTime(),
      spanDays: shape.days,
    };
  });
}

export function computeTimeTrends(
  glucose: GlucoseReading[],
  target: TargetRange = CONSENSUS_TARGET_RANGE,
  now: Date = new Date(),
): TimeTrends {
  const days = Array.from({ length: 7 }, emptyAccum);
  const hours = Array.from({ length: 24 }, emptyAccum);
  // Current calendar week, Monday-first, one accumulator per day.
  const weekStart = startOfIsoWeek(now);
  const weekAcc = Array.from({ length: 7 }, emptyAccum);

  for (const r of glucose) {
    const t = new Date(r.iso);
    const ms = t.getTime();
    if (!Number.isFinite(ms)) continue;

    const band =
      r.mgdl < target.lowMgdl ? 'low' : r.mgdl > target.highMgdl ? 'high' : 'inRange';

    const targets = [days[t.getDay()], hours[t.getHours()]];
    // Assign to the week strip only when the reading falls in the current week.
    const weekIdx = Math.floor((ms - weekStart.getTime()) / DAY_MS);
    if (weekIdx >= 0 && weekIdx < 7) targets.push(weekAcc[weekIdx]);

    for (const acc of targets) {
      acc.sum += r.mgdl;
      acc.count += 1;
      if (band === 'inRange') acc.inRange += 1;
      else if (band === 'low') acc.low += 1;
      else acc.high += 1;
    }
  }

  const todayStartMs = startOfDay(now).getTime();
  const weekRhythm: DayRhythm[] = weekAcc.map((acc, i) => {
    const dayStart = new Date(weekStart.getTime() + i * DAY_MS);
    return {
      index: i,
      label: WEEK_LETTERS[i],
      dateIso: dayStart.toISOString(),
      tirPct: acc.count > 0 ? Math.round((acc.inRange / acc.count) * 100) : null,
      readingCount: acc.count,
      isToday: dayStart.getTime() === todayStartMs,
      isFuture: dayStart.getTime() > todayStartMs,
    };
  });

  return {
    byDayOfWeek: days.map((acc, i) => finalize(acc, i, DAY_LABELS[i])),
    byHourOfDay: hours.map((acc, i) => finalize(acc, i, hourLabel(i))),
    weekRhythm,
    rhythmByRange: {
      today: computeRangeRhythm(glucose, 'today', target, now),
      '3d': computeRangeRhythm(glucose, '3d', target, now),
      '7d': computeRangeRhythm(glucose, '7d', target, now),
      '14d': computeRangeRhythm(glucose, '14d', target, now),
      '30d': computeRangeRhythm(glucose, '30d', target, now),
      '90d': computeRangeRhythm(glucose, '90d', target, now),
      '180d': computeRangeRhythm(glucose, '180d', target, now),
    },
    totalReadings: glucose.length,
    targetLowMgdl: target.lowMgdl,
    targetHighMgdl: target.highMgdl,
  };
}

const DAY_MS = 24 * 3600_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday 00:00 of the week containing `d`, in local time. */
function startOfIsoWeek(d: Date): Date {
  const x = startOfDay(d);
  // getDay(): 0=Sun … 6=Sat. Days since Monday: Sun→6, Mon→0, … Sat→5.
  const sinceMonday = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - sinceMonday);
  return x;
}

/** The bucket most worth attention: lowest in-range with enough data to trust.
 *  Returns null when nothing clears the sample floor. */
/** How far below the best bucket a bucket must sit before it is worth naming.
 *  Without this the "worst" day is always reported even when every day is
 *  within a point or two of the others — noise dressed as a finding, which is
 *  exactly what the confidence principle exists to prevent. */
export const MIN_BUCKET_SPREAD_PCT = 8;

export function worstBucket(
  buckets: TrendBucket[],
  minReadings = 12,
  minSpreadPct = MIN_BUCKET_SPREAD_PCT,
): TrendBucket | null {
  const eligible = buckets.filter((b) => b.readingCount >= minReadings);
  if (eligible.length < 2) return null;
  const worst = eligible.reduce((w, b) => (b.inRangePct < w.inRangePct ? b : w));
  const best = eligible.reduce((bst, b) => (b.inRangePct > bst.inRangePct ? b : bst));
  // A spread this small says the days behave alike, which is a finding in
  // itself — just not one that should point at a setting.
  if (best.inRangePct - worst.inRangePct < minSpreadPct) return null;
  return worst;
}
