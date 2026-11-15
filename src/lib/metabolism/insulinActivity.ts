import type { InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import { valueAt } from '@/data/loopTherapy';

// Insulin activity over time — the foundation every deviation-based insight
// stands on.
//
// To ask "did glucose move the way the insulin on board says it should have",
// you need the *rate* at which insulin is acting at each moment, not just how
// much is left. That is what `activity` is: the fraction of a dose taking
// effect per minute. Multiply it by ISF and you get the mg/dL of drop the
// insulin alone accounts for over an interval — oref0 calls this BGI, and every
// deviation in Autosens and Autotune is measured against it.
//
// The curve is the exponential model Loop and oref0 both use, parameterised by
// duration and time-to-peak. It replaced the older triangular Walsh curves
// because those understate early activity and overstate the tail.
//
// Nothing here writes anywhere or recommends anything — it is arithmetic over
// history that has already happened.

/** Minutes to peak activity. 75 is the rapid-acting default Loop ships with
 *  (Humalog / Novolog); Fiasp and other ultra-rapid insulins peak nearer 55. */
export const DEFAULT_PEAK_MINUTES = 75;

/** Below this the exponential model degenerates — peak must sit before the
 *  midpoint of the duration or `tau` goes negative and the curve inverts. */
const MAX_PEAK_FRACTION = 0.5;

export type InsulinModel = {
  /** Duration of insulin action, in minutes. */
  durationMinutes: number;
  /** Time to peak activity, in minutes. */
  peakMinutes: number;
};

export function modelFromTherapy(
  therapy: LoopTherapy,
  peakMinutes = DEFAULT_PEAK_MINUTES,
): InsulinModel {
  const durationMinutes = therapy.insulinDurationHours * 60;
  // Guard the degenerate case rather than trusting a hand-entered duration:
  // a 2 h duration with a 75 min peak would put the peak past the midpoint.
  const maxPeak = durationMinutes * MAX_PEAK_FRACTION - 1;
  return { durationMinutes, peakMinutes: Math.min(peakMinutes, maxPeak) };
}

type Coefficients = { tau: number; a: number; S: number; td: number };

function coefficients({ durationMinutes: td, peakMinutes: tp }: InsulinModel): Coefficients {
  const tau = (tp * (1 - tp / td)) / (1 - (2 * tp) / td);
  const a = (2 * tau) / td;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-td / tau));
  return { tau, a, S, td };
}

/**
 * Fraction of one unit taking effect per minute, `minutesAgo` after delivery.
 *
 * Integrating this from 0 to the duration gives 1 — the whole dose eventually
 * acts. That property is what makes BGI comparable across doses of any size.
 */
export function activityFraction(minutesAgo: number, model: InsulinModel): number {
  const { tau, S, td } = coefficients(model);
  if (minutesAgo <= 0 || minutesAgo >= td) return 0;
  return (S / (tau * tau)) * minutesAgo * (1 - minutesAgo / td) * Math.exp(-minutesAgo / tau);
}

/** Fraction of one unit still to act, `minutesAgo` after delivery. */
export function iobFraction(minutesAgo: number, model: InsulinModel): number {
  const { tau, a, S, td } = coefficients(model);
  if (minutesAgo <= 0) return 1;
  if (minutesAgo >= td) return 0;
  return (
    1 -
    S *
      (1 - a) *
      (((minutesAgo * minutesAgo) / (tau * td * (1 - a)) - minutesAgo / tau - 1) *
        Math.exp(-minutesAgo / tau) +
        1)
  );
}

/** A discrete quantity of insulin treated as delivered at one instant. */
export type InsulinImpulse = {
  ms: number;
  /** Signed: negative for a temp basal running below schedule. */
  units: number;
};

/** Minutes per slice when a temp basal is chopped into impulses. Five matches
 *  CGM cadence, so no sub-interval detail is lost downstream anyway. */
const BASAL_SLICE_MINUTES = 5;

/**
 * Flatten insulin history into signed impulses relative to the basal schedule.
 *
 * The netting is the part that matters. Scheduled basal is the baseline that
 * holds glucose flat, so it contributes nothing to deviation by definition —
 * only the *difference* between what ran and what was scheduled does. A temp
 * basal above schedule is extra insulin; one below schedule is negative
 * insulin, and dropping the sign there would make every low-temp stretch look
 * like an unexplained rise.
 *
 * Events already expressed as plain `units` (any bolus, or a basal record with
 * no rate) are taken at face value at their timestamp.
 */
export function netInsulinImpulses(
  insulin: InsulinEvent[],
  therapy: LoopTherapy,
): InsulinImpulse[] {
  const out: InsulinImpulse[] = [];

  for (const e of insulin) {
    const startMs = new Date(e.iso).getTime();
    if (!Number.isFinite(startMs)) continue;

    if (e.kind === 'bolus') {
      if (e.units > 0) out.push({ ms: startMs, units: e.units });
      continue;
    }

    // A scheduled-basal record *is* the schedule, so it nets to zero by
    // definition. Dropped before the rate check on purpose: if its rate
    // disagrees with our stored schedule, that means the mirror is stale, and
    // turning a stale mirror into phantom insulin would corrupt every
    // deviation downstream. Better to contribute nothing.
    if (e.kind === 'basal_scheduled') continue;

    // A temp-basal record with a rate and a duration is netted against the
    // schedule.
    if (e.rateUPerHr != null && e.durationMin != null && e.durationMin > 0) {
      const slices = Math.max(1, Math.round(e.durationMin / BASAL_SLICE_MINUTES));
      const sliceMinutes = e.durationMin / slices;
      for (let i = 0; i < slices; i += 1) {
        const sliceMs = startMs + i * sliceMinutes * 60_000;
        const d = new Date(sliceMs);
        const scheduled = valueAt(therapy.basalSchedule, d.getHours() * 60 + d.getMinutes());
        const netUnits = ((e.rateUPerHr - scheduled) * sliceMinutes) / 60;
        if (netUnits !== 0) out.push({ ms: sliceMs, units: netUnits });
      }
      continue;
    }

    // A temp-basal record with units but no rate: the units are all we know,
    // and we cannot net what we cannot compare, so take them as delivered.
    if (e.units !== 0) out.push({ ms: startMs, units: e.units });
  }

  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * Index of the first impulse still acting at `atMs`, by binary search over the
 * time-sorted impulses. Everything before it is past the insulin duration and
 * was skipped one by one before; starting here sums the same impulses in the
 * same order, so totals are unchanged. Without it, every 5-minute step of a
 * deviation run walked months of temp basals from the beginning.
 */
function firstActive(atMs: number, impulses: InsulinImpulse[], model: InsulinModel): number {
  let lo = 0;
  let hi = impulses.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((atMs - impulses[mid].ms) / 60_000 >= model.durationMinutes) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Insulin acting per minute, in units, at `atMs`. */
export function activityAt(
  atMs: number,
  impulses: InsulinImpulse[],
  model: InsulinModel,
): number {
  let total = 0;
  for (let i = firstActive(atMs, impulses, model); i < impulses.length; i += 1) {
    const imp = impulses[i];
    if (imp.ms > atMs) break;
    const minutesAgo = (atMs - imp.ms) / 60_000;
    if (minutesAgo >= model.durationMinutes) continue;
    total += imp.units * activityFraction(minutesAgo, model);
  }
  return total;
}

/** Units still to act at `atMs`. Can go negative after a long low temp basal. */
export function iobAt(
  atMs: number,
  impulses: InsulinImpulse[],
  model: InsulinModel,
): number {
  let total = 0;
  for (let i = firstActive(atMs, impulses, model); i < impulses.length; i += 1) {
    const imp = impulses[i];
    if (imp.ms > atMs) break;
    const minutesAgo = (atMs - imp.ms) / 60_000;
    if (minutesAgo >= model.durationMinutes) continue;
    total += imp.units * iobFraction(minutesAgo, model);
  }
  return total;
}
