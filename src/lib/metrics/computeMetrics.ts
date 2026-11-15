import type {
  GlucoseMetrics,
  MetricDelta,
  MetricsRange,
  TimeInRangeBands,
} from '@/data/types';
import type { GlucoseReading } from '@/data/sources/types';

// Pure metrics aggregator. Turns raw glucose readings + per-day therapy and
// lifestyle buckets into the GlucoseMetrics the Trends dashboard renders, for
// every selectable range. No I/O, no HealthKit — deterministic and unit-tested
// so the on-device path can be trusted without a device in hand.

/** Per-day therapy/lifestyle values the HealthKit source aggregates natively. */
export type DailyInsulin = { dayIso: string; basal: number; bolus: number };
export type DailyValue = { dayIso: string; value: number };

export type MetricsInputs = {
  glucose: GlucoseReading[];      // raw readings, any order
  insulinByDay: DailyInsulin[];   // summed IU per day, split by reason
  carbsByDay: DailyValue[];       // summed grams per day
  stepsByDay: DailyValue[];       // summed steps per day
  exerciseByDay: DailyValue[];    // summed exercise minutes per day
  sleepByDay: DailyValue[];       // sleep hours per day
  /** In-range boundaries from Profile → Targets. Omitted = consensus 70–180. */
  targetRange?: TargetRange;
  /**
   * Total U/day from the Loop basal schedule. Used only when the source
   * reports no delivered basal (Nightscout is bolus-only), so the insulin
   * split reflects the background insulin actually running rather than
   * reading as 100% bolus. Surfaced to the UI via `basalIsScheduled`.
   */
  scheduledDailyBasal?: number;
};

const RANGE_DAYS: Record<MetricsRange, number> = {
  today: 1,
  '3d': 3,
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
  '180d': 180,
};

// Every range the selector can produce MUST be computed here. '180d' was in
// MetricsRange and in TimeRangeSelector's ORDER but missing from this list, so
// metricsResult.data['180d'] was undefined, TrendsHome's `if (!metrics)` guard
// fired, and tapping 180d replaced the whole dashboard with "No glucose history
// yet" — a false explanation, on a screen that no longer rendered the selector
// that caused it. A range the UI can select and this module cannot compute is
// always that bug, so the two lists are now derived from one source.
// '3d' is computed for the clinic report's glance; the home selector does not
// offer it (TimeRangeSelector keeps its own ORDER).
export const ALL_RANGES: MetricsRange[] = ['today', '3d', '7d', '14d', '30d', '90d', '180d'];

// GMI (estimated A1c) from mean glucose — the CGM consensus formula
// (Bergenstal 2018): GMI(%) = 3.31 + 0.02392 × mean mg/dL.
function gmiFromMean(mean: number): number {
  return round1(3.31 + 0.02392 * mean);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// AGP consensus puts urgent-low at 54 and severe-high at 250. The high end
// stays fixed; the urgent-low line is configurable because where a person
// starts treating a low differently is genuinely personal, and a band that
// does not match how you actually react is a band you will not trust.
// Note the trade-off: moving off 54 makes these percentages no longer directly
// comparable with a standard AGP report from a clinic.
const CONSENSUS_URGENT_LOW_MGDL = 54;
const SEVERE_HIGH_MGDL = 250;

/** Boundaries the five-band distribution is scored against. */
export type TargetRange = {
  lowMgdl: number;
  highMgdl: number;
  /** Below this is urgent low. Defaults to the AGP consensus 54. */
  urgentLowMgdl?: number;
};

export const CONSENSUS_TARGET_RANGE: TargetRange = {
  lowMgdl: 70,
  highMgdl: 180,
  urgentLowMgdl: CONSENSUS_URGENT_LOW_MGDL,
};

function bandsFor(readings: number[], target: TargetRange): TimeInRangeBands {
  const empty = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 };
  if (readings.length === 0) return empty;

  // Bands must never invert: an urgent-low set at or above target-low would
  // give the "low" band negative width, and a target high of 300 would put
  // "high" above "very high".
  const urgentLow = target.urgentLowMgdl ?? CONSENSUS_URGENT_LOW_MGDL;
  const lowBound = Math.max(urgentLow, target.lowMgdl);
  const highBound = Math.max(lowBound, target.highMgdl);
  const severeHigh = Math.max(SEVERE_HIGH_MGDL, highBound);

  const c = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 };
  for (const g of readings) {
    if (g < urgentLow) c.veryLow++;
    else if (g < lowBound) c.low++;
    else if (g <= highBound) c.inRange++;
    else if (g <= severeHigh) c.high++;
    else c.veryHigh++;
  }
  const n = readings.length;
  // Percentages rounded to whole numbers, with the largest band absorbing the
  // rounding remainder so the five always sum to exactly 100.
  const raw = {
    veryLow: (c.veryLow / n) * 100,
    low: (c.low / n) * 100,
    inRange: (c.inRange / n) * 100,
    high: (c.high / n) * 100,
    veryHigh: (c.veryHigh / n) * 100,
  };
  const rounded: TimeInRangeBands = {
    veryLow: Math.round(raw.veryLow),
    low: Math.round(raw.low),
    inRange: Math.round(raw.inRange),
    high: Math.round(raw.high),
    veryHigh: Math.round(raw.veryHigh),
  };
  const keys: (keyof TimeInRangeBands)[] = ['veryLow', 'low', 'inRange', 'high', 'veryHigh'];
  const sum = keys.reduce((a, k) => a + rounded[k], 0);
  if (sum !== 100 && n > 0) {
    // Add the remainder to whichever band is largest — usually in-range.
    const largest = keys.reduce((a, k) => (rounded[k] > rounded[a] ? k : a), keys[0]);
    rounded[largest] += 100 - sum;
  }
  return rounded;
}

type WindowStats = {
  avgGlucose: number;
  gmi: number;
  cv: number;
  sd: number;
  tir: TimeInRangeBands;
  hasGlucose: boolean;
  /** Timestamp of the earliest reading inside the window, for coverage. */
  firstMs: number;
};

function statsForWindow(
  glucose: GlucoseReading[],
  startMs: number,
  endMs: number,
  target: TargetRange,
): WindowStats {
  const inWindow = glucose
    .map((r) => ({ ms: new Date(r.iso).getTime(), mgdl: r.mgdl }))
    .filter((r) => r.ms >= startMs && r.ms < endMs);
  const values = inWindow.map((r) => r.mgdl);

  if (values.length === 0) {
    return {
      avgGlucose: 0,
      gmi: 0,
      cv: 0,
      sd: 0,
      tir: { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 },
      hasGlucose: false,
      firstMs: endMs,
    };
  }
  const mu = mean(values);
  const sd = stddev(values, mu);
  return {
    avgGlucose: Math.round(mu),
    gmi: gmiFromMean(mu),
    cv: mu > 0 ? Math.round((sd / mu) * 100) : 0,
    sd: Math.round(sd),
    tir: bandsFor(values, target),
    hasGlucose: true,
    // The readings arrive sorted ascending from every source, but a min() is
    // cheap insurance against a source that ever stops guaranteeing it.
    firstMs: inWindow.reduce((m, r) => Math.min(m, r.ms), Infinity),
  };
}

function sumByDayInWindow(
  daily: DailyValue[],
  startMs: number,
  endMs: number,
): { total: number; days: number } {
  let total = 0;
  let days = 0;
  for (const d of daily) {
    const t = new Date(d.dayIso).getTime();
    if (t >= startMs && t < endMs) {
      total += d.value;
      days++;
    }
  }
  return { total, days };
}

function perDay(total: number, days: number): number {
  return days > 0 ? total / days : 0;
}

function delta(
  current: number,
  prior: number,
  betterWhen: 'lower' | 'higher' | 'neutral',
  round: (n: number) => number = Math.round,
): MetricDelta {
  const value = round(current - prior);
  let direction: MetricDelta['direction'] = 'neutral';
  if (betterWhen !== 'neutral' && value !== 0) {
    const improved = betterWhen === 'lower' ? value < 0 : value > 0;
    direction = improved ? 'good' : 'bad';
  }
  return { value, direction };
}

function computeOne(
  inputs: MetricsInputs,
  range: MetricsRange,
  now: Date,
): GlucoseMetrics {
  const days = RANGE_DAYS[range];
  const dayMs = 24 * 3600_000;
  const endMs = now.getTime();
  const startMs = endMs - days * dayMs;
  const priorStartMs = startMs - days * dayMs;

  const target = inputs.targetRange ?? CONSENSUS_TARGET_RANGE;
  const cur = statsForWindow(inputs.glucose, startMs, endMs, target);
  const prev = statsForWindow(inputs.glucose, priorStartMs, startMs, target);

  // Therapy + lifestyle: sum per-day buckets in-window, express as per-day avg
  // (for "today", days === 1 so per-day == the day's total).
  const insWindow = inputs.insulinByDay.filter((d) => {
    const t = new Date(d.dayIso).getTime();
    return t >= startMs && t < endMs;
  });
  const insDays = insWindow.length;
  const deliveredBasal = perDay(insWindow.reduce((a, d) => a + d.basal, 0), insDays);
  const bolus = perDay(insWindow.reduce((a, d) => a + d.bolus, 0), insDays);
  // Sources differ: HealthKit/Loop report delivered basal, Nightscout is
  // bolus-only. When nothing was reported, fall back to the scheduled daily
  // basal so the split isn't a misleading 100% bolus. The substitution is
  // flagged so the UI can label it as scheduled rather than delivered.
  const basalIsScheduled =
    deliveredBasal === 0 && (inputs.scheduledDailyBasal ?? 0) > 0;
  const basal = basalIsScheduled ? (inputs.scheduledDailyBasal as number) : deliveredBasal;
  const totalInsulin = basal + bolus;

  const priorIns = inputs.insulinByDay.filter((d) => {
    const t = new Date(d.dayIso).getTime();
    return t >= priorStartMs && t < startMs;
  });
  // Compare like with like. `totalInsulin` above may substitute the SCHEDULED
  // daily basal when the source reported none (the Nightscout path is
  // bolus-only), but this prior-window total summed raw basal + bolus — so a
  // basal-inclusive current window was being differenced against a bolus-only
  // prior one, and the Insulin tile showed a spurious "up ~15U" that was
  // entirely the substitution. Apply the same substitution on both sides.
  const priorDeliveredBasal = perDay(
    priorIns.reduce((a, d) => a + d.basal, 0),
    priorIns.length,
  );
  const priorBolus = perDay(priorIns.reduce((a, d) => a + d.bolus, 0), priorIns.length);
  const priorBasal =
    priorDeliveredBasal === 0 && basalIsScheduled
      ? (inputs.scheduledDailyBasal as number)
      : priorDeliveredBasal;
  const priorInsTotal = priorBasal + priorBolus;

  const carbs = (() => {
    const w = sumByDayInWindow(inputs.carbsByDay, startMs, endMs);
    return perDay(w.total, w.days);
  })();
  const steps = (() => {
    const w = sumByDayInWindow(inputs.stepsByDay, startMs, endMs);
    return perDay(w.total, w.days);
  })();
  const exercise = (() => {
    const w = sumByDayInWindow(inputs.exerciseByDay, startMs, endMs);
    return perDay(w.total, w.days);
  })();
  const sleep = (() => {
    const w = sumByDayInWindow(inputs.sleepByDay, startMs, endMs);
    return perDay(w.total, w.days);
  })();

  // Deltas are only meaningful when the prior window actually has data —
  // comparing against an empty window would report the raw value as a "change"
  // (e.g. avgGlucose −142 marked "good"). Neutral zero instead.
  const neutral: MetricDelta = { value: 0, direction: 'neutral' };
  const glucoseDeltas = prev.hasGlucose
    ? {
        avgGlucose: delta(cur.avgGlucose, prev.avgGlucose, 'lower'),
        inRange: delta(cur.tir.inRange, prev.tir.inRange, 'higher'),
        gmi: delta(cur.gmi, prev.gmi, 'lower', round1),
        cv: delta(cur.cv, prev.cv, 'lower'),
      }
    : { avgGlucose: neutral, inRange: neutral, gmi: neutral, cv: neutral };

  // What the window actually contains, not what it asked for. A 180-day
  // selection over 90 days of fetched history is 90 days of data wearing a
  // 180-day label unless the difference is reported.
  const coveredMs = cur.hasGlucose ? endMs - Math.max(startMs, cur.firstMs) : 0;
  const daysCovered = Math.max(0, Math.round(coveredMs / dayMs));

  return {
    range,
    daysInWindow: days,
    daysCovered,
    // Whether the PRIOR window had readings to compare against. Deltas resolve
    // to neutral both when nothing changed and when there was nothing to
    // compare with, and the UI cannot tell those apart from the delta alone —
    // so it claimed "holding steady vs the prior 90 days" for a comparison
    // that was never computed, under a "Measured" badge.
    hasPriorWindow: prev.hasGlucose,
    // Reported alongside the bands so the UI labels the actual boundaries the
    // percentages were scored against, never a hardcoded "70–180".
    targetLowMgdl: target.lowMgdl,
    targetHighMgdl: target.highMgdl,
    urgentLowMgdl: target.urgentLowMgdl ?? CONSENSUS_URGENT_LOW_MGDL,
    avgGlucose: cur.avgGlucose,
    gmi: cur.gmi,
    cv: cur.cv,
    sd: cur.sd,
    tir: cur.tir,
    totalInsulin: Math.round(totalInsulin),
    basalInsulin: Math.round(basal),
    basalIsScheduled,
    bolusInsulin: Math.round(bolus),
    carbs: Math.round(carbs),
    steps: Math.round(steps),
    exerciseMinutes: Math.round(exercise),
    sleepHours: round1(sleep),
    deltas: {
      ...glucoseDeltas,
      totalInsulin:
        priorIns.length > 0
          ? delta(Math.round(totalInsulin), Math.round(priorInsTotal), 'neutral')
          : neutral,
    },
  };
}

/** Compute metrics for every range at once (so range switching stays instant). */
export function computeAllMetrics(
  inputs: MetricsInputs,
  now: Date,
): Record<MetricsRange, GlucoseMetrics> {
  const out = {} as Record<MetricsRange, GlucoseMetrics>;
  for (const r of ALL_RANGES) out[r] = computeOne(inputs, r, now);
  return out;
}

/** True when there's enough glucose data to show computed metrics at all. */
export function hasMetricsData(inputs: MetricsInputs): boolean {
  return inputs.glucose.length > 0;
}
