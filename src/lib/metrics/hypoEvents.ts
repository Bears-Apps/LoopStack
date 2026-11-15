import type { GlucoseReading } from '@/data/sources/types';
import type { TargetRange } from '@/lib/metrics/computeMetrics';

// Hypoglycaemia events and overnight time below range.
//
// Percent time low says how much; events say how often and how long, which is
// what a clinician asks first ("how many lows a week, are they at night?").
// The definition is the International Consensus one (Battelino 2019, Danne
// 2017): an event starts after 15 consecutive minutes below the threshold and
// ends after 15 consecutive minutes back at or above it. A brief bounce above
// the line therefore does not split one low into two.
//
// Thresholds are the user's own (Profile → Targets, the home screen's bands),
// so "low" here is the same line the time-in-range tiles use. Overnight is
// 00:00–06:00 local, the consensus night window.

/** The report periods these are computed for. */
export type GlucoseWindow = '14d' | '30d' | '90d';
export const GLUCOSE_WINDOWS: { id: GlucoseWindow; days: number }[] = [
  { id: '14d', days: 14 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 },
];

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Consecutive minutes below (or back above) that start (or end) an event. */
export const EVENT_MINUTES = 15;
/** A CGM reading stands for this many minutes. */
const SAMPLE_MINUTES = 5;
/** A gap longer than this closes any open event: we cannot see through it. */
const MAX_GAP_MINUTES = 30;
const OVERNIGHT_END_HOUR = 6;

export type HypoEvent = {
  startIso: string;
  endIso: string;
  durationMin: number;
  nadirMgdl: number;
  /** Started 00:00–06:00 local. */
  overnight: boolean;
};

export type HypoStat = {
  count: number;
  perWeek: number;
  /** Null when there were no events. */
  medianDurationMin: number | null;
  lowestMgdl: number | null;
};

export type HypoBand = {
  thresholdMgdl: number;
  all: HypoStat;
  day: HypoStat;
  overnight: HypoStat;
};

export type HypoReport = {
  windowDays: number;
  /** Local days in the window with at least one reading. */
  daysCovered: number;
  low: HypoBand;
  urgentLow: HypoBand;
  /** Time below range for 00:00–06:00 readings only. */
  overnight: { readings: number; lowPct: number; urgentLowPct: number };
};

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Readings in [now − days, now], sorted, with parsed times. */
export function windowed(glucose: GlucoseReading[], now: Date, days: number): { t: number; mgdl: number }[] {
  const end = now.getTime();
  const start = end - days * DAY;
  return glucose
    .map((g) => ({ t: Date.parse(g.iso), mgdl: g.mgdl }))
    .filter((g) => Number.isFinite(g.t) && g.t >= start && g.t <= end)
    .sort((a, b) => a.t - b.t);
}

export function localDayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const isOvernight = (t: number) => new Date(t).getHours() < OVERNIGHT_END_HOUR;

/** Every event below `thresholdMgdl` in a sorted reading series. */
export function detectHypoEvents(readings: { t: number; mgdl: number }[], thresholdMgdl: number): HypoEvent[] {
  const events: HypoEvent[] = [];
  let runStart: number | null = null; // first reading of the current below-run
  let lastBelow = 0;
  let nadir = Infinity;
  let open = false;
  let aboveSince: number | null = null; // first reading back above, while open
  let prevT: number | null = null;

  const close = (end: number) => {
    events.push({
      startIso: new Date(runStart!).toISOString(),
      endIso: new Date(end).toISOString(),
      durationMin: Math.round((end - runStart!) / MIN),
      nadirMgdl: nadir,
      overnight: isOvernight(runStart!),
    });
    open = false;
    runStart = null;
    aboveSince = null;
    nadir = Infinity;
  };
  const reset = () => {
    runStart = null;
    aboveSince = null;
    nadir = Infinity;
  };

  for (const r of readings) {
    if (prevT != null && r.t - prevT > MAX_GAP_MINUTES * MIN) {
      if (open) close(aboveSince ?? lastBelow + SAMPLE_MINUTES * MIN);
      else reset();
    }
    prevT = r.t;
    if (r.mgdl < thresholdMgdl) {
      if (runStart == null) runStart = r.t;
      lastBelow = r.t;
      aboveSince = null;
      nadir = Math.min(nadir, r.mgdl);
      if (!open && r.t - runStart + SAMPLE_MINUTES * MIN >= EVENT_MINUTES * MIN) open = true;
    } else if (open) {
      if (aboveSince == null) aboveSince = r.t;
      if (r.t - aboveSince + SAMPLE_MINUTES * MIN >= EVENT_MINUTES * MIN) close(aboveSince);
    } else {
      reset();
    }
  }
  if (open) close(aboveSince ?? lastBelow + SAMPLE_MINUTES * MIN);
  return events;
}

function stat(events: HypoEvent[], weeks: number): HypoStat {
  return {
    count: events.length,
    perWeek: weeks > 0 ? events.length / weeks : 0,
    medianDurationMin: median(events.map((e) => e.durationMin)),
    lowestMgdl: events.length ? Math.min(...events.map((e) => e.nadirMgdl)) : null,
  };
}

function band(readings: { t: number; mgdl: number }[], threshold: number, weeks: number): HypoBand {
  const events = detectHypoEvents(readings, threshold);
  return {
    thresholdMgdl: threshold,
    all: stat(events, weeks),
    day: stat(events.filter((e) => !e.overnight), weeks),
    overnight: stat(events.filter((e) => e.overnight), weeks),
  };
}

export function computeHypoReport(input: { glucose: GlucoseReading[]; target: TargetRange; now: Date; windowDays: number }): HypoReport {
  const readings = windowed(input.glucose, input.now, input.windowDays);
  // A rolling window that starts mid-day touches one more calendar date than
  // it has days (30 days from 2pm spans 31 dates), so a date count is capped
  // at the window — "31 of 30 days" is not a thing a clinician should read.
  const daysCovered = Math.min(input.windowDays, new Set(readings.map((r) => localDayKey(r.t))).size);
  // Rates are per week of data actually held, not per calendar week of the
  // window: a fortnight of sensor gaps must not dilute the rate.
  const weeks = daysCovered / 7;
  const urgent = input.target.urgentLowMgdl ?? 54;
  const low = Math.max(urgent, input.target.lowMgdl);
  const night = readings.filter((r) => isOvernight(r.t));
  const share = (f: (mgdl: number) => boolean) => (night.length ? (night.filter((r) => f(r.mgdl)).length / night.length) * 100 : 0);
  return {
    windowDays: input.windowDays,
    daysCovered,
    low: band(readings, low, weeks),
    urgentLow: band(readings, urgent, weeks),
    overnight: { readings: night.length, lowPct: share((g) => g < low), urgentLowPct: share((g) => g < urgent) },
  };
}

/** One report per clinic-report period. */
export function computeHypoReports(input: { glucose: GlucoseReading[]; target: TargetRange; now: Date }): Record<GlucoseWindow, HypoReport> {
  return Object.fromEntries(
    GLUCOSE_WINDOWS.map((w) => [w.id, computeHypoReport({ ...input, windowDays: w.days })]),
  ) as Record<GlucoseWindow, HypoReport>;
}
