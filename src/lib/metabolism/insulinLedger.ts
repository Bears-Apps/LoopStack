import type { InsulinEvent } from '@/data/sources/types';

// Daily insulin accounting, Gluroo-style.
//
// Loop delivers insulin as a stream of small automatic doses — a temp basal
// every ~5 minutes plus the occasional automatic bolus. Individually they are
// noise ("0.15u", "0.25u"); accumulated by hour they show WHEN the day's
// insulin actually went in, and totalled they let us back out an OBSERVED carb
// ratio from what really happened rather than what was scheduled.
//
// THREE DERIVED FIGURES (all observation, never a dose):
//   • Hourly accumulation — every micro-dose summed into its hour, basal vs
//     bolus kept apart.
//   • Xtra insulin — total delivered minus the scheduled daily basal. The
//     insulin the day needed BEYOND baseline, i.e. what covered food and
//     corrections.
//   • Observed carb ratio — carbs ÷ xtra insulin. Grams of carb each unit of
//     non-basal insulin actually accompanied.
//
// SAFETY STANCE: this is a rear-view mirror. It never suggests a dose or a
// setting; it reports what was delivered. The observed ratio in particular
// lumps meal boluses and correction boluses together, so it reads a little
// stronger (more g/U) than a pure meal ratio — noted wherever it is shown.

export type HourlyInsulin = {
  /** 0–23, local. */
  hour: number;
  basalU: number;
  bolusU: number;
};

export type InsulinLedger = {
  /** 24 entries, today, local time. */
  hourly: HourlyInsulin[];
  /** False when the source can't measure delivered basal (Nightscout) — the
   *  xtra-insulin and observed-ratio figures need real basal to be meaningful. */
  hasBasal: boolean;
  /** Scheduled daily basal total (U/day) from the user's Loop settings. */
  scheduledBasalU: number;
};

function isBasal(kind: InsulinEvent['kind']): boolean {
  return kind === 'basal_temp' || kind === 'basal_scheduled';
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Sum today's insulin events into 24 hourly buckets, basal and bolus apart.
 * Only events falling on the local calendar day of `now` are counted.
 */
export function bucketInsulinByHour(
  events: InsulinEvent[],
  now: Date = new Date(),
): HourlyInsulin[] {
  const hourly: HourlyInsulin[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    basalU: 0,
    bolusU: 0,
  }));
  const dayStart = startOfDay(now).getTime();
  const dayEnd = dayStart + 24 * 3600_000;

  for (const ev of events) {
    const t = new Date(ev.iso).getTime();
    if (!Number.isFinite(t) || t < dayStart || t >= dayEnd) continue;
    const bucket = hourly[new Date(t).getHours()];
    if (isBasal(ev.kind)) bucket.basalU += ev.units;
    else bucket.bolusU += ev.units;
  }

  for (const b of hourly) {
    b.basalU = +b.basalU.toFixed(2);
    b.bolusU = +b.bolusU.toFixed(2);
  }
  return hourly;
}

export type ObservedRatio = {
  /** Insulin delivered beyond the scheduled baseline basal, U (per day). */
  xtraU: number;
  /** Grams of carb per unit of that xtra insulin, or null when there wasn't
   *  enough xtra insulin to divide by meaningfully. */
  ratio: number | null;
};

/**
 * Back out the observed carb ratio from delivered totals.
 *
 * All three inputs are per-day figures (a single day, or a range's per-day
 * average — the arithmetic is identical). Returns a null ratio when xtra
 * insulin is not positive: a day that ran on less than baseline basal has no
 * meal-insulin denominator to speak of.
 */
export function observedRatio(inputs: {
  carbsPerDay: number;
  totalInsulinPerDay: number;
  scheduledBasalPerDay: number;
}): ObservedRatio {
  const xtraU = +(inputs.totalInsulinPerDay - inputs.scheduledBasalPerDay).toFixed(1);
  // Need a real amount of non-basal insulin AND some carbs before the ratio
  // means anything. Under ~1U of xtra it is division noise.
  if (xtraU < 1 || inputs.carbsPerDay <= 0) return { xtraU, ratio: null };
  return { xtraU, ratio: Math.round(inputs.carbsPerDay / xtraU) };
}

/** Peak hourly total (basal+bolus) — the chart's y-scale. Min 0.5U so a quiet
 *  day doesn't blow small doses up to full height. */
export function peakHourlyUnits(hourly: HourlyInsulin[]): number {
  return Math.max(0.5, ...hourly.map((h) => h.basalU + h.bolusU));
}
