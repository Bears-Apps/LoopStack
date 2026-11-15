import type { LoopTherapy } from '@/data/loopTherapy';
import { valueAt } from '@/data/loopTherapy';
import {
  activityFraction,
  modelFromTherapy,
  type InsulinModel,
} from './insulinActivity';

// What a meal and its insulin do to glucose, minute by minute.
//
// This is a shape tool, not a dose tool. It answers "when does the food land,
// when does the insulin land, and do those two things line up" — the question
// timing actually turns on. It does not decide how much insulin to take: Loop
// owns that, it has the live IOB and the prediction, and a second opinion from
// a mirror app would be a worse answer offered with more confidence.
//
// The absorption curve is Loop's own piecewise-linear model: impact ramps up
// over the first 15% of the absorption time, holds flat to the halfway mark,
// then falls away to nothing at the end. Using anything else here would draw a
// meal that Loop is not modelling, which is worse than useless on a screen
// whose whole purpose is comparing the two.
//
// With one deliberate extension: the LoopKit fork swaps the curve per entry
// when the food label carries a marker — 🥜12h selects the delayed second-wave
// dessert curve (legacy 🌙12h still recognized), 🍲8h the long-tail
// heavy-meal curve. Each marked entry must
// be compared against ITS OWN curve, or the comparison stops meaning "does
// reality match what Loop expects". The knee tables below are copied from
// LoopKit/LoopKit/CarbKit/CarbMath.swift and must stay in lockstep with it.
//
// Since 2026-10-21 the fork also carries an explicit per-entry
// `absorptionPatternIdentifier`. `delayed-metabolic-v1` selects
// DelayedMetabolicResponseAbsorption (LoopKit/LoopKit/CarbKit/
// DelayedMetabolicResponseAbsorption.swift); `standard-v1` pins the global
// model even when the food text carries a legacy marker; an identifier this
// code does not know falls back to the global model. The identifier reaches
// Nightscout as a `[delayed-metabolic-v1]` marker in the carb treatment's
// notes (LoopWorkspace patches/09-nightscout-absorption-pattern.patch), which
// is what `absorptionPatternFromNotes` reads. The identifier wins over any
// text marker — the same order `CarbEntry.resolvedAbsorptionModel` uses.

/** Fraction of the absorption window spent ramping up. */
const PERCENT_END_OF_RISE = 0.15;
/** Fraction of the absorption window at which impact starts falling. */
const PERCENT_START_OF_FALL = 0.5;

export type AbsorptionModelKind = 'piecewise' | 'dessert' | 'heavy' | 'delayedMetabolicV1';

/** `MealAbsorptionPattern.delayedMetabolicV1` in the fork: the 🥜 delayed
 *  metabolic response pattern, graded against DelayedMetabolicResponseAbsorption. */
export const DELAYED_METABOLIC_PATTERN_ID = 'delayed-metabolic-v1';
/** `MealAbsorptionPattern.standard` in the fork: pins the global model. */
export const STANDARD_PATTERN_ID = 'standard-v1';

/** Marker FoodTypeRow writes for 🥜 entries; triggers the dessert curve in the fork. */
export const DESSERT_FOOD_TYPE_MARKER = '🥜12h';
/** Retired 🌙 form of the dessert marker — builds before the 🥜 rename wrote
 *  it, and 30 days of history can carry it. Still resolves to dessert. */
export const LEGACY_DESSERT_FOOD_TYPE_MARKER = '🌙12h';
/** Marker FoodTypeRow writes for 🍲 entries; triggers the heavy curve in the fork. */
export const HEAVY_FOOD_TYPE_MARKER = '🍲8h';

/** Which curve the fork applies to an entry, resolved from its food label.
 *  Dessert wins when both markers appear — the same precedence the fork's
 *  `resolvedAbsorptionModel` encodes (dessert is checked first).
 *
 *  This is the LEGACY path only: it is what Loop does for an entry with no
 *  absorption-pattern identifier. Prefer `modelKindForEntry`, which checks
 *  the identifier first. */
export function modelKindForLabel(label?: string | null): AbsorptionModelKind {
  if (label && label.includes(DESSERT_FOOD_TYPE_MARKER)) return 'dessert';
  if (label && label.includes(LEGACY_DESSERT_FOOD_TYPE_MARKER)) return 'dessert';
  if (label && label.includes(HEAVY_FOOD_TYPE_MARKER)) return 'heavy';
  return 'piecewise';
}

/** The `[<identifier>]` marker the Nightscout uploader patch appends to a
 *  carb treatment's notes. Identifiers are `<name>-v<N>` (MealAbsorptionPattern
 *  in the fork), so stray bracketed text in a note is not mistaken for one. */
const PATTERN_MARKER_RE = /\[([a-z0-9]+(?:-[a-z0-9]+)*-v\d+)\]/;

/** Loop's per-entry absorption-pattern identifier, read back from the carb
 *  treatment notes. `null` when the entry carries no marker — pre-pattern
 *  entries, Watch and remote entries, and any build without the patch. */
export function absorptionPatternFromNotes(notes?: string | null): string | null {
  if (!notes) return null;
  const m = PATTERN_MARKER_RE.exec(notes);
  return m ? m[1] : null;
}

/** Which curve the fork applied to an entry. Mirrors
 *  `CarbEntry.resolvedAbsorptionModel(default:)` exactly:
 *  an explicit identifier wins over any text marker — `delayed-metabolic-v1`
 *  selects the delayed-metabolic curve, `standard-v1` pins the global model
 *  even if the label carries 🥜12h, and an identifier this code does not know
 *  (written by a newer build) also falls back to the global model rather than
 *  guessing. Only a missing identifier reaches the legacy marker path. */
export function modelKindForEntry(entry: {
  label?: string | null;
  absorptionPattern?: string | null;
}): AbsorptionModelKind {
  const pattern = entry.absorptionPattern ?? null;
  if (pattern !== null) {
    return pattern === DELAYED_METABOLIC_PATTERN_ID ? 'delayedMetabolicV1' : 'piecewise';
  }
  return modelKindForLabel(entry.label);
}

/** Knees as [fraction of absorption time, cumulative fraction absorbed],
 *  mirrored from the fork's DelayedSecondWaveDessertAbsorption (12h design),
 *  LongTailHeavyMealAbsorption (8h design) and
 *  DelayedMetabolicResponseAbsorption. Percent-time based, so they
 *  scale with whatever duration the entry actually carries. */
export const MODEL_KNEES: Record<Exclude<AbsorptionModelKind, 'piecewise'>, readonly (readonly [number, number])[]> = {
  dessert: [
    [0, 0],
    [1 / 12, 0.04],
    [2 / 12, 0.09],
    [3 / 12, 0.15],
    [4 / 12, 0.24],
    [5 / 12, 0.34],
    [6 / 12, 0.43],
    [8 / 12, 0.65],
    [10 / 12, 0.92],
    [1, 1],
  ],
  heavy: [
    [0, 0],
    [1 / 8, 0.08],
    [2 / 8, 0.22],
    [3 / 8, 0.42],
    [4 / 8, 0.55],
    [5 / 8, 0.67],
    [6 / 8, 0.78],
    [7 / 8, 0.89],
    [1, 1],
  ],
  // DelayedMetabolicResponseAbsorption.knees, verbatim. Wave 0.36–0.64 bounds
  // the earliest/latest observed late-rise midpoints of six zoodle + 🥜
  // nights; the 0.43–0.57 peak-rate segment is centred on their 0.50 average.
  delayedMetabolicV1: [
    [0, 0],
    [0.125, 0.05],
    [0.25, 0.13],
    [0.36, 0.23],
    [0.43, 0.33],
    [0.57, 0.6],
    [0.64, 0.7],
    [0.8, 0.86],
    [1, 1],
  ],
};

/** Cumulative fraction absorbed at a fraction of the absorption time —
 *  `percentAbsorptionAtPercentTime` in the fork. Piecewise integrates Loop's
 *  rise / plateau / fall shape. */
export function modelCumulativeFraction(kind: AbsorptionModelKind, percentTime: number): number {
  if (percentTime <= 0) return 0;
  if (percentTime >= 1) return 1;
  if (kind === 'piecewise') {
    // Integrate the normalised piecewise shape over [0, t] with T = 1.
    const rise = PERCENT_END_OF_RISE;
    const fall = PERCENT_START_OF_FALL;
    const peak = 1 / (rise / 2 + (fall - rise) + (1 - fall) / 2);
    if (percentTime < rise) return (peak * percentTime * percentTime) / (2 * rise);
    const riseArea = (peak * rise) / 2;
    if (percentTime < fall) return riseArea + peak * (percentTime - rise);
    const plateauArea = peak * (fall - rise);
    const remaining = 1 - percentTime;
    const tailArea = (peak * remaining * remaining) / (2 * (1 - fall));
    return riseArea + plateauArea + (peak * (1 - fall)) / 2 - tailArea;
  }
  const knees = MODEL_KNEES[kind];
  for (let i = 1; i < knees.length; i += 1) {
    if (percentTime <= knees[i][0]) {
      const [t0, p0] = knees[i - 1];
      const [t1, p1] = knees[i];
      const span = t1 - t0;
      if (span <= 0) return p0;
      return p0 + ((percentTime - t0) / span) * (p1 - p0);
    }
  }
  return 1;
}

/** Fraction of the absorption time at which a cumulative fraction has been
 *  absorbed — `percentTimeAtPercentAbsorption` in the fork; the inverse of
 *  `modelCumulativeFraction` for the knee curves. */
export function modelPercentTimeAtFraction(kind: AbsorptionModelKind, percentAbsorption: number): number {
  if (percentAbsorption <= 0) return 0;
  if (percentAbsorption >= 1) return 1;
  if (kind === 'piecewise') {
    // Bisection on the monotone cumulative curve — exact enough at 1e-9.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (modelCumulativeFraction('piecewise', mid) < percentAbsorption) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const knees = MODEL_KNEES[kind];
  for (let i = 1; i < knees.length; i += 1) {
    if (percentAbsorption <= knees[i][1]) {
      const [t0, p0] = knees[i - 1];
      const [t1, p1] = knees[i];
      const span = p1 - p0;
      if (span <= 0) return t0;
      return t0 + ((percentAbsorption - p0) / span) * (t1 - t0);
    }
  }
  return 1;
}

/**
 * Share of a meal's total glucose impact occurring per minute under the given
 * model. Delegates to the piecewise curve unless the entry carries a marker
 * curve. Integrates to 1 across the absorption window for every kind.
 */
export function modelImpactFraction(
  kind: AbsorptionModelKind,
  minutesSince: number,
  absorptionMinutes: number,
): number {
  if (kind === 'piecewise') return carbImpactFraction(minutesSince, absorptionMinutes);
  const T = absorptionMinutes;
  if (T <= 0 || minutesSince <= 0 || minutesSince >= T) return 0;
  const t = minutesSince / T;
  const knees = MODEL_KNEES[kind];
  for (let i = 1; i < knees.length; i += 1) {
    if (t < knees[i][0]) {
      const dt = knees[i][0] - knees[i - 1][0];
      const dp = knees[i][1] - knees[i - 1][1];
      // Constant rate within a knee segment, expressed per minute.
      return dt > 0 ? dp / dt / T : 0;
    }
  }
  return 0;
}

/** The window the model expects peak impact in, as fractions of the
 *  absorption time: the max-rate stretch of the curve. Piecewise this is the
 *  plateau (15–50%); for knee curves it is the steepest segment. */
export function modelPeakWindowFractions(kind: AbsorptionModelKind): { start: number; end: number } {
  if (kind === 'piecewise') return { start: PERCENT_END_OF_RISE, end: PERCENT_START_OF_FALL };
  const knees = MODEL_KNEES[kind];
  let best = { start: PERCENT_END_OF_RISE, end: PERCENT_START_OF_FALL, rate: -Infinity };
  for (let i = 1; i < knees.length; i += 1) {
    const dt = knees[i][0] - knees[i - 1][0];
    if (dt <= 0) continue;
    const rate = (knees[i][1] - knees[i - 1][1]) / dt;
    if (rate > best.rate) best = { start: knees[i - 1][0], end: knees[i][0], rate };
  }
  return { start: best.start, end: best.end };
}

/** Short human name for the curve an entry is graded against. */
export function modelKindLabel(kind: AbsorptionModelKind): string {
  switch (kind) {
    case 'dessert':
      return '🥜 second-wave curve';
    case 'heavy':
      return '🍲 long-tail curve';
    case 'delayedMetabolicV1':
      return '🥜 delayed-metabolic curve';
    default:
      return 'Loop piecewise curve';
  }
}

/** Short tag for naming a preset by its curve — "12h 🥜" and "12h 🥜 delayed"
 *  are different presets and must never read as the same one. Empty for the
 *  plain piecewise curve. */
export function modelKindGlyph(kind: AbsorptionModelKind): string {
  switch (kind) {
    case 'dessert':
      return '🥜';
    case 'heavy':
      return '🍲';
    case 'delayedMetabolicV1':
      return '🥜 delayed';
    default:
      return '';
  }
}

/** Resolution of the modelled curve. Matches CGM cadence. */
export const STEP_MINUTES = 5;

/**
 * Share of a meal's total glucose impact occurring per minute, `minutesSince`
 * after eating. Integrates to 1 across the absorption window.
 */
export function carbImpactFraction(minutesSince: number, absorptionMinutes: number): number {
  const T = absorptionMinutes;
  if (T <= 0 || minutesSince <= 0 || minutesSince >= T) return 0;

  const rise = PERCENT_END_OF_RISE * T;
  const fall = PERCENT_START_OF_FALL * T;
  // Height that makes the three segments sum to a total area of 1.
  const peak =
    1 / (rise / 2 + (fall - rise) + (T - fall) / 2);

  if (minutesSince < rise) return peak * (minutesSince / rise);
  if (minutesSince < fall) return peak;
  return peak * ((T - minutesSince) / (T - fall));
}

export type CurvePoint = {
  /** Minutes from the meal. Negative before the first bite. */
  minute: number;
  /** mg/dL the carbs push glucose up over this step. */
  carbMgdl: number;
  /** mg/dL the insulin pulls glucose down over this step. Negative. */
  insulinMgdl: number;
  /** carbMgdl + insulinMgdl. */
  netMgdl: number;
  /** Running total of net effect since the meal. */
  cumulativeMgdl: number;
};

export type CarbPlanInput = {
  grams: number;
  absorptionHours: number;
  /** Units the user plans to take. LoopStack does not compute this — Loop does. */
  units: number;
  /** Minutes the insulin goes in BEFORE the first bite. Negative = after. */
  preBolusMinutes: number;
  therapy: LoopTherapy;
  /** Time of day the meal starts — the schedules resolve against it. */
  mealTime: Date;
};

export type CarbPlan = {
  points: CurvePoint[];
  /** mg/dL the carbs alone are worth. */
  totalCarbRiseMgdl: number;
  /** mg/dL the insulin alone is worth. Negative. */
  totalInsulinDropMgdl: number;
  /** Where the two land net, once both have finished. */
  netMgdl: number;
  /** Minutes from the meal to peak carb impact. */
  carbPeakMinute: number;
  /** Minutes from the meal to peak insulin activity. */
  insulinPeakMinute: number;
  /** insulinPeak − carbPeak. Negative means insulin peaks first. */
  peakGapMinutes: number;
  /** Highest cumulative rise before insulin catches up. */
  maxRiseMgdl: number;
  minuteOfMaxRise: number;
  /** Lowest cumulative point — how far past baseline it ends up going. */
  maxFallMgdl: number;
  minuteOfMaxFall: number;
  /** The schedule values in force at the meal. */
  isf: number;
  carbRatio: number;
  csf: number;
  model: InsulinModel;
  /** Timing observations. Never a dose, never an instruction. */
  notes: string[];
};

/** Round, collapsing negative zero — `-0` renders as "-0" on screen. */
function round(value: number, decimals: number): number {
  const n = +value.toFixed(decimals);
  return n === 0 ? 0 : n;
}

export function computeCarbPlan(input: CarbPlanInput): CarbPlan {
  const { grams, units, preBolusMinutes, therapy, mealTime } = input;
  const absorptionMinutes = Math.max(30, input.absorptionHours * 60);
  const model = modelFromTherapy(therapy);

  const minuteOfDay = mealTime.getHours() * 60 + mealTime.getMinutes();
  const isf = valueAt(therapy.insulinSensitivitySchedule, minuteOfDay);
  const carbRatio = valueAt(therapy.carbRatioSchedule, minuteOfDay);
  const csf = carbRatio > 0 ? isf / carbRatio : 0;

  // The window runs from the earlier of the bolus and the meal, out to
  // whichever finishes last.
  const startMinute = Math.min(0, -preBolusMinutes) || 0;
  const endMinute = Math.max(absorptionMinutes, model.durationMinutes - preBolusMinutes);

  const points: CurvePoint[] = [];
  let cumulative = 0;
  let carbPeak = { minute: 0, value: -Infinity };
  let insulinPeak = { minute: 0, value: -Infinity };
  let maxRise = { minute: 0, value: 0 };
  let maxFall = { minute: 0, value: 0 };

  for (let m = startMinute; m <= endMinute; m += STEP_MINUTES) {
    const carbMgdl = grams * csf * carbImpactFraction(m, absorptionMinutes) * STEP_MINUTES;
    // Insulin started `preBolusMinutes` before the meal, so at meal-minute m it
    // is already that much older.
    const insulinAge = m + preBolusMinutes;
    const insulinMgdl =
      -units * activityFraction(insulinAge, model) * isf * STEP_MINUTES;

    const net = carbMgdl + insulinMgdl;
    cumulative += net;

    if (carbMgdl > carbPeak.value) carbPeak = { minute: m, value: carbMgdl };
    if (-insulinMgdl > insulinPeak.value) insulinPeak = { minute: m, value: -insulinMgdl };
    if (cumulative > maxRise.value) maxRise = { minute: m, value: cumulative };
    if (cumulative < maxFall.value) maxFall = { minute: m, value: cumulative };

    points.push({
      minute: m,
      carbMgdl: round(carbMgdl, 2),
      insulinMgdl: round(insulinMgdl, 2),
      netMgdl: round(net, 2),
      cumulativeMgdl: round(cumulative, 1),
    });
  }

  const totalCarbRiseMgdl = round(grams * csf, 0);
  const totalInsulinDropMgdl = round(-units * isf, 0);

  const notes = buildNotes({
    grams,
    units,
    preBolusMinutes,
    carbPeakMinute: carbPeak.minute,
    insulinPeakMinute: insulinPeak.minute,
    maxRise: maxRise.value,
    minuteOfMaxRise: maxRise.minute,
    maxFall: maxFall.value,
    net: cumulative,
    absorptionMinutes,
  });

  return {
    points,
    totalCarbRiseMgdl,
    totalInsulinDropMgdl,
    netMgdl: round(cumulative, 0),
    carbPeakMinute: carbPeak.minute,
    insulinPeakMinute: insulinPeak.minute,
    peakGapMinutes: insulinPeak.minute - carbPeak.minute,
    maxRiseMgdl: round(maxRise.value, 0),
    minuteOfMaxRise: maxRise.minute,
    maxFallMgdl: round(maxFall.value, 0),
    minuteOfMaxFall: maxFall.minute,
    isf,
    carbRatio,
    csf: round(csf, 2),
    model,
    notes,
  };
}

/**
 * Observations about shape and timing.
 *
 * Deliberately phrased as description, not instruction: this screen shows what
 * the curves do, and the decision stays with Loop and the person reading it.
 */
function buildNotes(x: {
  grams: number;
  units: number;
  preBolusMinutes: number;
  carbPeakMinute: number;
  insulinPeakMinute: number;
  maxRise: number;
  minuteOfMaxRise: number;
  maxFall: number;
  net: number;
  absorptionMinutes: number;
}): string[] {
  const notes: string[] = [];
  if (x.grams <= 0) return notes;

  const gap = x.insulinPeakMinute - x.carbPeakMinute;
  if (x.units > 0) {
    if (gap > 25) {
      notes.push(
        `Insulin peaks about ${Math.round(gap)} min after the food does. That ordering is what a post-meal climb followed by a late fall looks like on a graph — moving the dose earlier is the lever that changes it.`,
      );
    } else if (gap < -25) {
      notes.push(
        `Insulin peaks about ${Math.round(-gap)} min before the food does. Going in this far ahead is what produces a dip before the meal lands, especially with a slow-absorbing plate.`,
      );
    } else {
      notes.push(
        `Insulin and food peak within ${Math.abs(Math.round(gap))} min of each other — the two curves are working over the same stretch.`,
      );
    }
  }

  if (x.maxRise >= 30) {
    notes.push(
      `The modelled path climbs about ${Math.round(x.maxRise)} mg/dL above where it started, peaking around ${Math.round(x.minuteOfMaxRise)} min in, before insulin catches up.`,
    );
  } else if (x.units > 0 && x.grams > 0) {
    notes.push(
      `The modelled path stays within ${Math.round(Math.max(x.maxRise, 5))} mg/dL of where it started — on these settings the two curves cover each other closely.`,
    );
  }

  if (x.units > 0) {
    if (x.net <= -30) {
      notes.push(
        `Once both have finished, the model lands about ${Math.round(-x.net)} mg/dL below the starting point. A meal that finishes low usually shows up as a late drop rather than a high peak.`,
      );
    } else if (x.net >= 30) {
      notes.push(
        `Once both have finished, the model lands about ${Math.round(x.net)} mg/dL above the starting point.`,
      );
    }
  }

  if (x.preBolusMinutes <= 0 && x.units > 0) {
    notes.push(
      'No lead time is set, so insulin starts working from the first bite. Insulin takes far longer than food to get going, which is the usual reason a plate like this runs high early.',
    );
  }

  return notes;
}
