import type { CarbEntry, GlucoseReading } from '@/data/sources/types';
import { loadTargetRange } from '@/data/loopTherapyStore';

// What the meal actually needed, read backwards from what happened.
//
// "I gave 2.4 U and went low; 2.0 would have been right" is a question the data
// can answer, because the size of the undershoot is itself a measurement. If
// glucose bottomed out 18 mg/dL below the line you never want to cross, and one
// unit moves you 45 mg/dL, then 0.4 U of what was delivered had nowhere to go.
//
//   excess (U) = (low bound − nadir) / ISF
//   needed (U) = given − excess
//
// Two things this is careful about.
//
// FIRST — WHEN matters more than HOW MUCH. A low ninety minutes after eating
// and a low four hours after are different failures with different fixes. The
// early one is a SPLIT problem: the upfront portion peaked before the food
// arrived, and the same total delivered later would have been fine. The late
// one is a DOSE problem: there was more insulin than the meal ever needed.
// Reporting a single "you gave too much" would hide that distinction and point
// at the wrong lever — which matters, because trimming the total to fix an
// early low buys the low back as a high later in the evening.
//
// SECOND — this is a measurement of the past, not an instruction for the
// future. It says what a past serving turned out to need; it never says what to
// take. The pattern across repeats is the point, and one serving is an
// anecdote: a walk, a stubborn site, or a rescue juice can each produce the
// same trace, which is why confounders are detected and reported rather than
// silently folded into the number.

export type LowTiming = 'early' | 'late' | 'none';

/**
 * Minutes after the meal that separate a split problem from a dose problem.
 *
 * The upfront portion of a bolus peaks around 60–90 minutes in. A low inside
 * this window is that peak landing before the carbs did; past it, the meal's
 * carbs have largely arrived and a low means the total was simply too big.
 */
export const EARLY_LOW_CUTOFF_MIN = 150;

/** How long after a meal to look for its consequences. */
export const MEAL_OUTCOME_WINDOW_HOURS = 5;

/** Readings before the meal used to establish where it started. */
const BASELINE_LOOKBACK_MIN = 30;

/**
 * Carbs this size or smaller inside the window, after glucose has started
 * falling, read as a rescue rather than as part of the meal.
 */
export const RESCUE_CARB_MAX_G = 25;

export type MealInsulinOutcome = {
  mealIso: string;
  carbsG: number;
  /** Insulin attributed to this meal — what was actually delivered. */
  givenU: number;
  /** What would have kept the trace at or above the low bound. */
  neededU: number;
  /** given − needed. Zero when the meal never went below the bound. */
  excessU: number;
  baselineMgdl: number;
  nadirMgdl: number;
  minutesToNadir: number;
  wentLow: boolean;
  /** Where the low sits relative to the split/dose boundary. */
  timing: LowTiming;
  /** Things that could have produced this trace other than the dose. */
  confounders: {
    /** Carbs eaten mid-window that look like treating, not eating. */
    rescueCarbsG: number;
    /** No pre-meal readings, so the start point is unknown. */
    missingBaseline: boolean;
    /** The window ran past the end of available data. */
    truncated: boolean;
  };
  /**
   * False when a confounder means the number understates the excess — a rescue
   * carb lifts the nadir, so the real overshoot was larger than measured.
   */
  clean: boolean;
};

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Read one serving's insulin requirement back out of its glucose trace.
 *
 * Returns null when the meal cannot be judged at all — no readings, no
 * baseline, or no ISF. A null is not "this meal was fine"; it is "this meal is
 * not evidence", and the caller must not average it in as a zero.
 */
export function analyzeMealInsulin(input: {
  mealIso: string;
  carbsG: number;
  givenU: number;
  isf: number;
  glucose: GlucoseReading[];
  /** Every carb entry, so mid-window rescues can be spotted. */
  carbs?: CarbEntry[];
  lowBoundMgdl?: number;
}): MealInsulinOutcome | null {
  const { mealIso, carbsG, givenU, isf } = input;
  const start = toMs(mealIso);
  if (!Number.isFinite(start)) return null;
  // Without a real sensitivity figure the conversion from mg/dL to units is
  // meaningless, and a fabricated one here would produce a confident wrong
  // number on a screen about dosing.
  if (!Number.isFinite(isf) || isf <= 0) return null;

  const lowBound = input.lowBoundMgdl ?? loadTargetRange().lowMgdl;
  const end = start + MEAL_OUTCOME_WINDOW_HOURS * 3_600_000;

  const points = input.glucose
    .map((r) => ({ ms: toMs(r.iso), mgdl: r.mgdl }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms);

  const window = points.filter((r) => r.ms >= start && r.ms <= end);
  if (window.length < 3) return null;

  const pre = points.filter(
    (r) => r.ms <= start && r.ms >= start - BASELINE_LOOKBACK_MIN * 60_000,
  );
  const missingBaseline = pre.length === 0;
  const baselineMgdl = missingBaseline
    ? window[0].mgdl
    : pre.reduce((a, r) => a + r.mgdl, 0) / pre.length;

  // The nadir is the lowest point after the meal — the moment the dose came
  // closest to being too much.
  let nadir = window[0];
  for (const r of window) if (r.mgdl < nadir.mgdl) nadir = r;

  const minutesToNadir = Math.round((nadir.ms - start) / 60_000);
  const wentLow = nadir.mgdl < lowBound;

  // The counterfactual. Only a trace that actually crossed the bound carries
  // evidence of excess: a meal that bottomed out at 90 with a bound of 65 tells
  // you the dose was survivable, not that it was 0.5 U too small.
  const shortfallMgdl = wentLow ? lowBound - nadir.mgdl : 0;
  const excessU = wentLow ? round2(shortfallMgdl / isf) : 0;
  const neededU = round2(Math.max(0, givenU - excessU));

  // Rescue carbs: a small entry logged after glucose has already turned down.
  // These lift the nadir, so the measured excess is a floor on the real one.
  const mealCarbWindowMs = 20 * 60_000;
  const rescueCarbsG = (input.carbs ?? [])
    .map((c) => ({ ms: toMs(c.iso), grams: c.grams }))
    .filter(
      (c) =>
        Number.isFinite(c.ms) &&
        c.ms > start + mealCarbWindowMs &&
        c.ms <= end &&
        c.grams <= RESCUE_CARB_MAX_G &&
        // Only count entries made while glucose was heading down or already
        // under the bound — a mid-afternoon snack is not a rescue.
        (() => {
          const at = window.find((r) => r.ms >= c.ms);
          return at ? at.mgdl < baselineMgdl || at.mgdl < lowBound + 20 : false;
        })(),
    )
    .reduce((a, c) => a + c.grams, 0);

  const lastMs = points.length > 0 ? points[points.length - 1].ms : start;
  const truncated = lastMs < end;

  const timing: LowTiming = !wentLow
    ? 'none'
    : minutesToNadir <= EARLY_LOW_CUTOFF_MIN
      ? 'early'
      : 'late';

  return {
    mealIso,
    carbsG: Math.round(carbsG),
    givenU: round2(givenU),
    neededU,
    excessU,
    baselineMgdl: Math.round(baselineMgdl),
    nadirMgdl: Math.round(nadir.mgdl),
    minutesToNadir,
    wentLow,
    timing,
    confounders: { rescueCarbsG: Math.round(rescueCarbsG), missingBaseline, truncated },
    clean: rescueCarbsG === 0 && !missingBaseline && !truncated,
  };
}

export type InsulinNeedPattern = {
  /** Servings that could be judged at all. */
  occurrences: number;
  /** How many of those went below the bound. */
  lowCount: number;
  /** lowCount / occurrences. */
  lowRate: number;
  /** Median excess across the servings that went low, in units. */
  medianExcessU: number;
  /** Median of what those servings turned out to need. */
  medianGivenU: number;
  medianNeededU: number;
  earlyLows: number;
  lateLows: number;
  /** Which lever the pattern points at, when it points anywhere. */
  lever: 'split' | 'dose' | 'mixed' | 'none';
  /** True when enough clean servings agree to be worth showing. */
  actionable: boolean;
  /** Servings whose numbers were affected by a rescue or missing data. */
  confoundedCount: number;
};

/** Servings needed before a pattern is worth reporting. */
export const MIN_OCCURRENCES = 3;
/** Lows needed before a pattern is worth acting on. */
export const MIN_LOWS_TO_ACT = 2;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Pool one meal's servings into a pattern.
 *
 * The median rather than the mean: one bad night with a rescue juice and a long
 * walk should not drag a recommendation, and with a handful of servings a mean
 * is mostly whichever serving was weirdest.
 *
 * `lever` is the useful output. Early lows and late lows want opposite
 * responses, so a pattern that is both is reported as 'mixed' rather than
 * averaged into a single misleading direction.
 */
export function summariseInsulinNeed(
  outcomes: (MealInsulinOutcome | null)[],
): InsulinNeedPattern {
  const judged = outcomes.filter((o): o is MealInsulinOutcome => o != null);
  const lows = judged.filter((o) => o.wentLow);
  const early = lows.filter((o) => o.timing === 'early').length;
  const late = lows.filter((o) => o.timing === 'late').length;

  const lever: InsulinNeedPattern['lever'] =
    lows.length < MIN_LOWS_TO_ACT
      ? 'none'
      : early > 0 && late > 0
        ? 'mixed'
        : early > 0
          ? 'split'
          : 'dose';

  return {
    occurrences: judged.length,
    lowCount: lows.length,
    lowRate: judged.length > 0 ? +(lows.length / judged.length).toFixed(2) : 0,
    medianExcessU: round2(median(lows.map((o) => o.excessU))),
    medianGivenU: round2(median(lows.map((o) => o.givenU))),
    medianNeededU: round2(median(lows.map((o) => o.neededU))),
    earlyLows: early,
    lateLows: late,
    lever,
    actionable:
      judged.length >= MIN_OCCURRENCES &&
      lows.length >= MIN_LOWS_TO_ACT &&
      lever !== 'none',
    confoundedCount: judged.filter((o) => !o.clean).length,
  };
}

/**
 * One plain sentence describing the pattern, with no instruction in it.
 *
 * Names what repeated and which lever it points at. Deliberately stops short of
 * "so take 2.0 U next time": the number is on the card, and what to do with it
 * is the user's call with their care team.
 */
export function describeInsulinNeed(p: InsulinNeedPattern): string {
  if (p.occurrences === 0) return 'No servings with enough data to read yet.';
  if (!p.actionable) {
    if (p.lowCount === 0) {
      return `${p.occurrences} servings, none of them below your low line.`;
    }
    return `${p.lowCount} of ${p.occurrences} servings went low — not enough yet to call it a pattern.`;
  }

  const share = `${p.lowCount} of ${p.occurrences} servings`;
  const gap = `${p.medianGivenU.toFixed(1)}U given, ${p.medianNeededU.toFixed(1)}U would have held the line`;

  if (p.lever === 'split') {
    // Rendered from the constant so the copy cannot drift from the rule, and
    // formatted rather than rounded: Math.round(150/60) printed "3h" for a
    // 2½-hour cutoff, overstating the window the claim actually covers.
    const hours = EARLY_LOW_CUTOFF_MIN / 60;
    const cutoff = Number.isInteger(hours) ? `${hours}h` : `${Math.floor(hours)}\u00BD h`;
    return `${share} went low within ${cutoff} of eating — ${gap}. Early lows track the upfront portion arriving before the food does, not the size of the whole dose.`;
  }
  if (p.lever === 'dose') {
    return `${share} went low well after eating — ${gap}. Late lows track the total, not the split.`;
  }
  return `${share} went low, some early and some late — ${gap}. Mixed timing usually means the split and the total are both in play, and they pull in opposite directions.`;
}
