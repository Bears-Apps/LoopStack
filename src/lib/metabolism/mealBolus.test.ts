import { describe, it, expect } from 'vitest';
import { findMealBolus, describeMealBolus, MIN_MEANINGFUL_BOLUS_U } from './mealBolus';
import type { InsulinEvent } from '@/data/sources/types';

const MEAL = '2026-08-12T12:00:00.000Z';
const at = (minsFromMeal: number, units: number, kind: InsulinEvent['kind'] = 'bolus'): InsulinEvent => ({
  iso: new Date(new Date(MEAL).getTime() + minsFromMeal * 60_000).toISOString(),
  units,
  kind,
});

const find = (insulin: InsulinEvent[], suggestedUpfrontU = 1.4) =>
  findMealBolus({ mealIso: MEAL, insulin, suggestedUpfrontU });

describe('findMealBolus', () => {
  /**
   * The case this exists for: the dose already went in, so the screen must
   * stop presenting it as something to do.
   */
  it('finds a bolus delivered at the table', () => {
    const d = find([at(-12, 1.4)]);
    expect(d).not.toBeNull();
    expect(d!.unitsU).toBe(1.4);
    expect(d!.minutesFromMeal).toBe(-12);
    expect(d!.coversUpfront).toBe(true);
  });

  it('sums several deliveries in the window', () => {
    const d = find([at(-10, 0.8), at(2, 0.7)]);
    expect(d!.unitsU).toBeCloseTo(1.5, 2);
    // Reported time is the LAST delivery — that is when dosing finished.
    expect(d!.minutesFromMeal).toBe(2);
  });

  it('counts a pre-bolus, because the levers offer exactly that', () => {
    expect(find([at(-20, 1.4)])!.coversUpfront).toBe(true);
  });

  describe('what is NOT this meal', () => {
    it('ignores a bolus well before the meal', () => {
      expect(find([at(-90, 2.0)])).toBeNull();
    });

    it('ignores a correction hours later', () => {
      expect(find([at(180, 2.0)])).toBeNull();
    });

    it('ignores basal — only a bolus is an up-front delivery', () => {
      expect(find([at(-5, 1.4, 'basal_temp')])).toBeNull();
    });

    it('ignores a trace delivery', () => {
      expect(find([at(-5, MIN_MEANINGFUL_BOLUS_U / 2)])).toBeNull();
    });
  });

  describe('coversUpfront', () => {
    /**
     * Generous on purpose. The failure directions are not symmetric:
     * suppressing a small remainder costs a little accuracy, re-suggesting a
     * dose that already landed costs a hypo.
     */
    it('treats 80% of the suggestion as covered', () => {
      expect(find([at(-5, 1.12)], 1.4)!.coversUpfront).toBe(true);
      expect(find([at(-5, 1.05)], 1.4)!.coversUpfront).toBe(false);
    });

    it('is covered when nothing was suggested up front', () => {
      expect(find([at(-5, 0.4)], 0)!.coversUpfront).toBe(true);
    });

    it('still reports a partial delivery rather than hiding it', () => {
      const d = find([at(-5, 0.5)], 1.4);
      expect(d).not.toBeNull();
      expect(d!.coversUpfront).toBe(false);
      expect(d!.unitsU).toBe(0.5);
    });
  });

  it('returns null on an unparseable meal time rather than guessing', () => {
    expect(findMealBolus({ mealIso: 'nope', insulin: [at(0, 1.4)], suggestedUpfrontU: 1.4 })).toBeNull();
  });
});

describe('describeMealBolus', () => {
  it('says when it landed, relative to eating', () => {
    expect(describeMealBolus(find([at(-15, 1.4)])!)).toBe('1.40 U 15 min before eating');
    expect(describeMealBolus(find([at(8, 1.4)])!)).toBe('1.40 U 8 min after starting');
    expect(describeMealBolus(find([at(1, 1.4)])!)).toBe('1.40 U at the first bite');
  });
});
