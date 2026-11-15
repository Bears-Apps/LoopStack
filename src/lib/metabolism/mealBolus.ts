import type { InsulinEvent } from '@/data/sources/types';

// Did the up-front bolus for this meal already go in?
//
// The sheet's job is to answer "how much, and split how" — but once the bolus
// has actually been delivered, the up-front half of that answer is no longer a
// suggestion, it is history. Continuing to show "Up front 1.40 U · at the first
// bite" beside a dose that is already in the body is the single most dangerous
// thing this screen can render: it reads as an instruction to do again what has
// already been done, at exactly the moment a person is least likely to
// double-check.
//
// The insulin-on-board credit elsewhere in the engine reduces the TOTAL. This
// is a different question about the same fact: not "how much less is needed"
// but "has the first delivery already happened", which changes what the screen
// should say rather than what it should compute.

/**
 * How far either side of the meal a bolus still counts as that meal's.
 *
 * Wide enough for a pre-bolus (people dose 15-20 min ahead and the levers
 * offer exactly that) and for the lag between eating and remembering to log.
 * Past this a bolus is more likely a correction than the meal's own.
 */
export const AT_MEAL_WINDOW_BEFORE_MIN = 30;
export const AT_MEAL_WINDOW_AFTER_MIN = 20;

/** Below this a delivery is not the meal's up-front portion. */
export const MIN_MEANINGFUL_BOLUS_U = 0.15;

export type MealBolusDelivery = {
  /** Units delivered at the table. */
  unitsU: number;
  /** When the last of them landed. */
  iso: string;
  /** Minutes relative to the meal — negative means it preceded it. */
  minutesFromMeal: number;
  /** True once delivery covers most of what was suggested up front. */
  coversUpfront: boolean;
};

/**
 * Find the bolus already delivered for a meal.
 *
 * Returns null when nothing meaningful landed in the window — which is a
 * different state from "nothing was needed", and the caller must not treat
 * them alike.
 */
export function findMealBolus(input: {
  mealIso: string;
  insulin: InsulinEvent[];
  /** What the engine suggested up front, to judge whether it is covered. */
  suggestedUpfrontU: number;
  now?: Date;
}): MealBolusDelivery | null {
  const mealMs = new Date(input.mealIso).getTime();
  if (!Number.isFinite(mealMs)) return null;

  const from = mealMs - AT_MEAL_WINDOW_BEFORE_MIN * 60_000;
  const to = mealMs + AT_MEAL_WINDOW_AFTER_MIN * 60_000;

  const atTable = input.insulin
    .filter((e) => e.kind === 'bolus')
    .map((e) => ({ ms: new Date(e.iso).getTime(), units: e.units, iso: e.iso }))
    .filter((e) => Number.isFinite(e.ms) && e.ms >= from && e.ms <= to && e.units > 0)
    .sort((a, b) => a.ms - b.ms);

  if (atTable.length === 0) return null;

  const unitsU = +atTable.reduce((a, e) => a + e.units, 0).toFixed(2);
  if (unitsU < MIN_MEANINGFUL_BOLUS_U) return null;

  const last = atTable[atTable.length - 1];

  // "Covered" is deliberately generous — 80% of the suggestion is close
  // enough that repeating the recommendation would be worse than dropping it.
  // The failure directions are not symmetric: suppressing a small remainder
  // costs a little accuracy, while re-suggesting a dose that already landed
  // costs a hypo.
  const coversUpfront =
    input.suggestedUpfrontU <= 0 || unitsU >= input.suggestedUpfrontU * 0.8;

  return {
    unitsU,
    iso: last.iso,
    minutesFromMeal: Math.round((last.ms - mealMs) / 60_000),
    coversUpfront,
  };
}

/** "given 1.40 U, 12 min before eating" — for the delivered-state label. */
export function describeMealBolus(d: MealBolusDelivery): string {
  const mins = Math.abs(d.minutesFromMeal);
  const when =
    mins < 3
      ? 'at the first bite'
      : d.minutesFromMeal < 0
        ? `${mins} min before eating`
        : `${mins} min after starting`;
  return `${d.unitsU.toFixed(2)} U ${when}`;
}
