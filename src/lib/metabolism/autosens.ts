import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import { computeDeviations, flatIsf, percentile, STEP_MINUTES } from './deviations';

// Autosens: are you running more or less insulin-sensitive than usual right now?
//
// The measurement is deliberately narrow. Take every five-minute step where no
// food was in play, ask how far glucose moved from what the insulin on board
// predicted, and read the median of those deviations. Persistently negative
// deviations mean insulin is doing more than the settings expect — you are
// sensitive. Persistently positive means the opposite.
//
// What this number is NOT is a therapy recommendation. OpenAPS' own guidance is
// explicit that Autosens must not be used to change basals or ISF: its window
// is short, and it cannot separate a basal effect from an ISF effect. It is a
// "what kind of day is this" signal — one that a closed loop consumes for a
// single dosing cycle and then discards. LoopStack surfaces it the same way:
// as an observation about the last stretch, not as a lever.
//
// It also cannot say anything about carb ratio, structurally: every step with
// carbs on board is excluded before the median is taken, and Autosens is itself
// distorted by carb-ratio error rather than able to detect it. Carb ratio is
// Autotune's job.

/** Clamps from oref0's defaults. Beyond these the ratio stops being credible
 *  and starts reflecting missing data. */
export const AUTOSENS_MAX = 1.2;
export const AUTOSENS_MIN = 0.7;

/** Hours of history below which no ratio is reported at all. */
export const MIN_HOURS = 24;
/** Clean five-minute steps needed before the median means anything. */
export const MIN_CLEAN_STEPS = 60;

export type AutosensVerdict = 'sensitive' | 'resistant' | 'as_expected' | 'building';

export type Autosens = {
  /** Ratio in [0.7, 1.2]. Below 1 = more sensitive than settings expect. */
  ratio: number;
  /** True when the raw ratio hit a clamp — the reading is a floor/ceiling, not
   *  a measurement, and should be presented that way. */
  clamped: boolean;
  /** The ratio before clamping, for honesty about how far out it ran. */
  rawRatio: number;
  verdict: AutosensVerdict;
  /** Median deviation, mg/dL per 5 min. */
  medianDeviation: number;
  /** Share of clean deviations that were negative (0–100). */
  negativeSharePct: number;
  /** Steps that survived every exclusion. */
  cleanStepCount: number;
  /** Steps excluded because food was in play. */
  excludedStepCount: number;
  hoursAnalysed: number;
  /** ISF the ratio is relative to. */
  baselineIsf: number;
  /** Plain-language reading. Never a dose or a rate. */
  note: string;
};

export function computeAutosens(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  /** Hours of history to read. oref0 runs 8 h and 24 h; 24 is the steadier. */
  windowHours?: number;
  now: Date;
}): Autosens {
  const windowHours = input.windowHours ?? MIN_HOURS;
  const startMs = input.now.getTime() - windowHours * 3600_000;
  const since = <T extends { iso: string }>(xs: T[]) =>
    xs.filter((x) => new Date(x.iso).getTime() >= startMs);

  const baselineIsf = flatIsf(input.therapy);

  // Insulin is NOT windowed: a bolus from before the window is still acting
  // inside it, and dropping it would credit its drop to sensitivity.
  const { steps, cleanSteps } = computeDeviations({
    glucose: since(input.glucose),
    carbs: input.carbs,
    insulin: input.insulin,
    therapy: input.therapy,
  });

  const excludedStepCount = steps.length - cleanSteps.length;
  const hoursAnalysed = steps.length > 0
    ? +(((steps[steps.length - 1].ms - steps[0].ms) / 3600_000)).toFixed(1)
    : 0;

  const building = (note: string): Autosens => ({
    ratio: 1,
    clamped: false,
    rawRatio: 1,
    verdict: 'building',
    medianDeviation: 0,
    negativeSharePct: 0,
    cleanStepCount: cleanSteps.length,
    excludedStepCount,
    hoursAnalysed,
    baselineIsf,
    note,
  });

  if (baselineIsf <= 0) {
    return building('No insulin sensitivity on file yet — add it under Profile → Therapy settings.');
  }
  if (cleanSteps.length < MIN_CLEAN_STEPS) {
    return building(
      `${cleanSteps.length} of ${MIN_CLEAN_STEPS} food-free readings needed before sensitivity can be read. Meals and the 45 minutes after them are excluded on purpose.`,
    );
  }

  const deviations = cleanSteps.map((s) => s.deviation);
  const medianDeviation = percentile(deviations, 0.5);
  const negatives = deviations.filter((d) => d < 0).length;
  const negativeSharePct = Math.round((negatives / deviations.length) * 100);

  // The conversion oref0 uses, in two steps.
  //
  // First express the median deviation as the basal rate that would have
  // produced it: mg/dL per 5 min scaled to the hour, divided by ISF, gives
  // U/hr. A persistent −0.5 mg/dL per 5 min against a 40 mg/dL ISF is −0.15
  // U/hr — that much basal is doing work the settings do not account for.
  //
  // Then scale that offset by the largest rate in the schedule, so the same
  // absolute drift means more on a 0.4 U/hr profile than on a 2 U/hr one.
  // Dividing by ISF alone (the obvious-looking shortcut) collapses every real
  // shift into a rounding error.
  const maxScheduledBasal = Math.max(
    0.05,
    ...input.therapy.basalSchedule.map((e) => e.value),
  );
  const basalOffset = (medianDeviation * (60 / STEP_MINUTES)) / baselineIsf;
  const rawRatio = 1 + basalOffset / maxScheduledBasal;
  const ratio = +Math.min(AUTOSENS_MAX, Math.max(AUTOSENS_MIN, rawRatio)).toFixed(2);
  const clamped = rawRatio > AUTOSENS_MAX || rawRatio < AUTOSENS_MIN;

  // A band around 1.0 where the difference is not worth naming.
  const NEUTRAL = 0.05;
  let verdict: AutosensVerdict = 'as_expected';
  if (ratio <= 1 - NEUTRAL) verdict = 'sensitive';
  else if (ratio >= 1 + NEUTRAL) verdict = 'resistant';

  const pct = Math.abs(Math.round((ratio - 1) * 100));
  let note: string;
  if (verdict === 'sensitive') {
    note = `Over the last ${Math.round(hoursAnalysed)} h, insulin has been doing about ${pct}% more than your settings expect — ${negativeSharePct}% of food-free readings fell further than predicted. Loop already accounts for this on its own; it is worth knowing as context, not as a settings change.`;
  } else if (verdict === 'resistant') {
    note = `Over the last ${Math.round(hoursAnalysed)} h, insulin has been doing about ${pct}% less than your settings expect — only ${negativeSharePct}% of food-free readings fell as far as predicted. A short stretch like this is usually illness, stress, or a site that is past its best.`;
  } else {
    note = `Over the last ${Math.round(hoursAnalysed)} h, glucose has moved close to what your settings predict during food-free stretches. Nothing here points at a sensitivity shift.`;
  }
  if (clamped) {
    note += ` The underlying figure ran past the ${rawRatio > 1 ? 'upper' : 'lower'} limit of what this measurement can credibly report, so it is shown at the limit.`;
  }

  return {
    ratio,
    clamped,
    rawRatio: +rawRatio.toFixed(3),
    verdict,
    medianDeviation: +medianDeviation.toFixed(2),
    negativeSharePct,
    cleanStepCount: cleanSteps.length,
    excludedStepCount,
    hoursAnalysed,
    baselineIsf,
    note,
  };
}
