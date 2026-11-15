import type { GlucoseReading } from '@/data/sources/types';
import { GLUCOSE_WINDOWS, localDayKey, windowed, type GlucoseWindow } from '@/lib/metrics/hypoEvents';

// Ambulatory glucose profile and CGM wear.
//
// The AGP is the standard one-page picture: every day of the period stacked on
// one 24-hour axis, summarised as the 5th/25th/50th/75th/95th percentile at
// each time of day. The median line says where glucose usually sits; the
// 25–75 band how consistent the day is; the 5–95 band the excursions.
//
// Readings are binned into 30-minute slots and each slot reads the readings
// within ±30 minutes of its centre (a 1-hour moving window), which is how
// AGP software smooths the curve without inventing data. A slot with fewer
// than MIN_PER_BIN readings is left empty rather than drawn from a handful.
//
// CGM wear is the share of the period's 5-minute slots that hold a reading —
// the "% time CGM active" line at the top of a standard AGP report. Consensus
// asks for 70% or more over 14 days before the other figures are trusted.

const MIN = 60_000;
const SLOT = 5 * MIN;
const BIN_MINUTES = 30;
const SMOOTH_MINUTES = 30;
const MIN_PER_BIN = 10;

export type AgpBin = {
  /** Minutes after midnight at the bin's centre. */
  minute: number;
  readings: number;
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
};

export type AgpProfile = {
  windowDays: number;
  daysCovered: number;
  /** Share of the window's 5-minute slots holding a reading, 0–100. */
  wearPct: number;
  readings: number;
  /** 48 half-hour bins, 00:15 to 23:45. */
  bins: AgpBin[];
};

/** Linear-interpolated percentile of a sorted array (p in 0–100). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function computeAgp(input: { glucose: GlucoseReading[]; now: Date; windowDays: number }): AgpProfile {
  const readings = windowed(input.glucose, input.now, input.windowDays);
  const end = input.now.getTime();
  const start = end - input.windowDays * 24 * 60 * MIN;
  // Wear: distinct 5-minute slots with a reading. A 1-minute CGM (or two
  // sources writing the same sensor) fills a slot once, not five times.
  const slots = new Set(readings.map((r) => Math.floor((r.t - start) / SLOT)));
  const totalSlots = Math.max(1, Math.round((end - start) / SLOT));

  const byMinute: number[][] = Array.from({ length: 24 * 60 }, () => []);
  for (const r of readings) {
    const d = new Date(r.t);
    byMinute[d.getHours() * 60 + d.getMinutes()].push(r.mgdl);
  }
  const bins: AgpBin[] = [];
  for (let b = 0; b < (24 * 60) / BIN_MINUTES; b++) {
    const centre = b * BIN_MINUTES + BIN_MINUTES / 2;
    const values: number[] = [];
    for (let m = centre - SMOOTH_MINUTES; m < centre + SMOOTH_MINUTES; m++) {
      values.push(...byMinute[(m + 24 * 60) % (24 * 60)]);
    }
    values.sort((a, c) => a - c);
    const ok = values.length >= MIN_PER_BIN;
    const p = (q: number) => (ok ? Math.round(percentile(values, q)) : null);
    bins.push({ minute: centre, readings: values.length, p5: p(5), p25: p(25), p50: p(50), p75: p(75), p95: p(95) });
  }

  return {
    windowDays: input.windowDays,
    // Capped: a mid-day rolling window touches windowDays + 1 calendar dates.
    daysCovered: Math.min(input.windowDays, new Set(readings.map((r) => localDayKey(r.t))).size),
    wearPct: Math.min(100, (slots.size / totalSlots) * 100),
    readings: readings.length,
    bins,
  };
}

/** One profile per clinic-report period. */
export function computeAgpProfiles(input: { glucose: GlucoseReading[]; now: Date }): Record<GlucoseWindow, AgpProfile> {
  return Object.fromEntries(
    GLUCOSE_WINDOWS.map((w) => [w.id, computeAgp({ ...input, windowDays: w.days })]),
  ) as Record<GlucoseWindow, AgpProfile>;
}
