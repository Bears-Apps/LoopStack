import type { LoopTherapy } from '@/data/loopTherapy';
import { valueAt } from '@/data/loopTherapy';

// What basal was actually delivered, per day.
//
// A pump running a closed loop delivers basal continuously: the scheduled rate
// whenever nothing overrides it, and the temp rate whenever Loop has one
// running. Nightscout records only the temps — the schedule is the assumed
// floor between them — so "how much basal did I get yesterday" is not a sum of
// records, it is an integral over the day with the temps painted on top.
//
// Before this existed, the Nightscout path reported `basal: 0` for every day
// with a comment saying temp-basal integration "isn't implemented". It was: the
// same refresh already parses every Temp Basal record with its rate and
// duration for the deviation math. Only the metrics were never given them, so
// the dashboard showed a day's insulin as pure bolus and the Bolus share tile
// read 100% — the "is standard basal not factored in?" report.
//
// The distinction this preserves: a day reconstructed this way is MEASURED
// (temps are real records), unlike the flat scheduled-total fallback, which is
// an assumption. Callers can tell them apart, because presenting an assumption
// as a measurement is the failure the fallback was introduced to avoid in the
// first place.

/** A temp-basal record: a rate held for a duration, starting at an instant. */
export type TempBasalRecord = {
  iso: string;
  rateUPerHr: number;
  durationMin: number;
};

export type DailyBasal = {
  dayIso: string;
  /** Units delivered that day: temps where they ran, schedule elsewhere. */
  units: number;
  /** Minutes of the day covered by an explicit temp record. */
  tempMinutes: number;
};

const STEP_MIN = 5;

function dayKey(ms: number): string {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

/**
 * Integrate delivered basal over [startMs, endMs) in 5-minute steps.
 *
 * Five minutes because that is the resolution everything else in this codebase
 * reasons at (the deviation stream, the insulin-activity model), and because a
 * temp basal shorter than one step contributes less than 0.1 U at any plausible
 * rate — below the precision the UI renders anyway.
 *
 * Overlapping temps resolve to the LAST one that started, matching the pump:
 * issuing a new temp cancels the running one rather than stacking with it.
 */
export function deliveredBasalByDay(
  temps: TempBasalRecord[],
  therapy: LoopTherapy,
  startMs: number,
  endMs: number,
): DailyBasal[] {
  if (endMs <= startMs) return [];

  // Sort once; for each step take the newest temp that started at or before it
  // and has not yet expired.
  const sorted = [...temps]
    .map((t) => {
      const s = new Date(t.iso).getTime();
      return { startMs: s, endMs: s + t.durationMin * 60_000, rate: t.rateUPerHr };
    })
    .filter((t) => Number.isFinite(t.startMs) && t.endMs > t.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const byDay = new Map<string, { units: number; tempMinutes: number }>();
  const stepMs = STEP_MIN * 60_000;
  const stepHours = STEP_MIN / 60;

  let cursor = 0;
  const active: { startMs: number; endMs: number; rate: number }[] = [];

  for (let ms = startMs; ms < endMs; ms += stepMs) {
    // Admit any temps that have started by this step.
    while (cursor < sorted.length && sorted[cursor].startMs <= ms) {
      active.push(sorted[cursor]);
      cursor++;
    }
    // Newest still-running temp wins; a new temp supersedes an older one.
    let rate: number | null = null;
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMs > ms) {
        rate = active[i].rate;
        break;
      }
    }
    // Drop long-expired entries so `active` cannot grow without bound over a
    // 180-day window.
    if (active.length > 64) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].endMs <= ms) active.splice(i, 1);
      }
    }

    const minutesIntoDay = new Date(ms).getHours() * 60 + new Date(ms).getMinutes();
    const scheduled = valueAt(therapy.basalSchedule, minutesIntoDay);
    const effective = rate ?? scheduled;

    const key = dayKey(ms);
    const bucket = byDay.get(key) ?? { units: 0, tempMinutes: 0 };
    bucket.units += effective * stepHours;
    if (rate != null) bucket.tempMinutes += STEP_MIN;
    byDay.set(key, bucket);
  }

  return [...byDay.entries()]
    .map(([dayIso, v]) => ({
      dayIso,
      units: +v.units.toFixed(2),
      tempMinutes: v.tempMinutes,
    }))
    .sort((a, b) => a.dayIso.localeCompare(b.dayIso));
}

/**
 * Whether a reconstruction is trustworthy enough to call "measured".
 *
 * A day with no temp records at all is not evidence that basal ran at schedule
 * — it is far more likely the mirror never carried temps for that stretch. Such
 * a day integrates to exactly the scheduled total, which would then be
 * presented as a measurement of something nothing observed. Requiring real temp
 * coverage keeps the measured/assumed line honest.
 */
export const MIN_TEMP_COVERAGE_MINUTES_PER_DAY = 60;

export function hasMeasuredBasal(days: DailyBasal[]): boolean {
  if (days.length === 0) return false;
  const covered = days.filter(
    (d) => d.tempMinutes >= MIN_TEMP_COVERAGE_MINUTES_PER_DAY,
  ).length;
  // Most of the window, not just one good day.
  return covered >= Math.ceil(days.length * 0.5);
}

/** Days that lack real temp coverage, so callers can exclude them. */
export function measuredDays(days: DailyBasal[]): DailyBasal[] {
  return days.filter((d) => d.tempMinutes >= MIN_TEMP_COVERAGE_MINUTES_PER_DAY);
}
