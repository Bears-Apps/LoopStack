import type { InsulinEvent } from '@/data/sources/types';
import { localDayKey } from '@/lib/metrics/hypoEvents';

// Time at max basal and zero temps, from Loop's temp-basal records.
//
// Two figures clinicians read off an AID download: how much of the day the
// algorithm sat at its ceiling (often a sign it is asking for more than the
// settings allow it to give) and how often it suspended to zero (often a sign
// the background insulin is more than needed). Both are observations about
// what Loop chose, not about what to change.
//
// Loop issues a fresh temp every five minutes, each nominally 30 minutes long,
// so a temp's real run ends at the next temp's start. Consecutive zero temps
// are one suspension, not dozens: they are merged into episodes.
//
// Only sources that carry temp basals (Nightscout) can answer. Without temps
// in the window the result says so instead of reporting zeros.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Back-to-back zero temps closer than this are one episode. */
const MERGE_GAP_MIN = 1;

export type TempBasalUse = {
  windowDays: number;
  /** Local days in the window with at least one temp basal. */
  daysWithTemps: number;
  maxBasalRate: number;
  /** Share of those days spent at the max basal rate, 0–100. */
  atMaxPct: number;
  atMaxMinutesPerDay: number;
  zeroEpisodesPerDay: number;
  zeroMinutesPerDay: number;
};

export function computeTempBasalUse(input: { insulin: InsulinEvent[]; maxBasalRate: number; now: Date; windowDays: number }): TempBasalUse | null {
  const end = input.now.getTime();
  const start = end - input.windowDays * DAY;
  const temps = input.insulin
    .filter((i) => i.kind === 'basal_temp' && i.rateUPerHr != null && i.durationMin != null)
    .map((i) => ({ t: Date.parse(i.iso), rate: i.rateUPerHr as number, dur: i.durationMin as number }))
    .filter((x) => Number.isFinite(x.t) && x.t >= start && x.t < end)
    .sort((a, b) => a.t - b.t);
  if (temps.length === 0) return null;

  let atMax = 0;
  let zeroMin = 0;
  let zeroEpisodes = 0;
  let lastZeroEnd = -Infinity;
  temps.forEach((x, i) => {
    const stop = Math.min(x.t + x.dur * MIN, temps[i + 1]?.t ?? Infinity, end);
    const mins = Math.max(0, stop - x.t) / MIN;
    // Rates are stored to a few decimals; a hair under the max is the max.
    if (input.maxBasalRate > 0 && x.rate >= input.maxBasalRate - 0.001) atMax += mins;
    if (x.rate === 0) {
      if (x.t - lastZeroEnd > MERGE_GAP_MIN * MIN) zeroEpisodes++;
      zeroMin += mins;
      lastZeroEnd = stop;
    }
  });
  const days = new Set(temps.map((x) => localDayKey(x.t))).size;
  return {
    windowDays: input.windowDays,
    daysWithTemps: days,
    maxBasalRate: input.maxBasalRate,
    atMaxPct: (atMax / (days * 24 * 60)) * 100,
    atMaxMinutesPerDay: atMax / days,
    zeroEpisodesPerDay: zeroEpisodes / days,
    zeroMinutesPerDay: zeroMin / days,
  };
}
