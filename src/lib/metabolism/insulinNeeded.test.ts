import { describe, it, expect } from 'vitest';
import {
  analyzeMealInsulin,
  summariseInsulinNeed,
  describeInsulinNeed,
  EARLY_LOW_CUTOFF_MIN,
  MIN_OCCURRENCES,
  type MealInsulinOutcome,
} from './insulinNeeded';
import type { GlucoseReading } from '@/data/sources/types';

const MEAL = '2026-04-06T12:00:00.000Z';
const ISF = 45;

/**
 * Readings every 15 min, with two pre-meal points at `baseline`.
 * `values[0]` sits at the meal time itself.
 *
 * The last value is held out to the end of the 5-hour outcome window, because
 * a trace that simply stops early is genuinely truncated — the module flags
 * that as a confounder, and it is right to: a low could have happened in the
 * unobserved part. Padding keeps the fixtures about the shape under test.
 */
function trace(values: number[], baseline = values[0], mealIso = MEAL): GlucoseReading[] {
  const start = new Date(mealIso).getTime();
  const pre = [-30, -15].map((m) => ({
    iso: new Date(start + m * 60_000).toISOString(),
    mgdl: baseline,
  }));
  const stepsInWindow = (5 * 60) / 15; // 5h outcome window at 15-min steps
  const padded = [...values];
  while (padded.length <= stepsInWindow) padded.push(values[values.length - 1]);
  return [
    ...pre,
    ...padded.map((mgdl, i) => ({
      iso: new Date(start + i * 15 * 60_000).toISOString(),
      mgdl,
    })),
  ];
}

const analyze = (values: number[], givenU = 2.4, extra = {}) =>
  analyzeMealInsulin({
    mealIso: MEAL,
    carbsG: 60,
    givenU,
    isf: ISF,
    glucose: trace(values),
    lowBoundMgdl: 65,
    ...extra,
  });

describe('analyzeMealInsulin', () => {
  /**
   * The question this module was built to answer: "I gave 2.4 U and went low —
   * what would have held the line?" Nadir 47 against a 65 bound is 18 mg/dL of
   * overshoot, which at 45 mg/dL per unit is 0.4 U that had nowhere to go.
   */
  it('reads the excess out of how far below the bound it went', () => {
    const o = analyze([110, 150, 130, 95, 70, 47, 60, 80]);
    expect(o).not.toBeNull();
    expect(o!.wentLow).toBe(true);
    expect(o!.nadirMgdl).toBe(47);
    expect(o!.excessU).toBeCloseTo(0.4, 2);
    expect(o!.givenU).toBe(2.4);
    expect(o!.neededU).toBeCloseTo(2.0, 2);
  });

  it('reports no excess when the meal never crossed the bound', () => {
    const o = analyze([110, 160, 190, 150, 120, 95, 90]);
    expect(o!.wentLow).toBe(false);
    expect(o!.excessU).toBe(0);
    // Needed equals given: the dose is not evidence of being too small just
    // because it did not go low.
    expect(o!.neededU).toBe(o!.givenU);
  });

  it('never returns a negative need, however deep the low', () => {
    const o = analyze([110, 90, 60, 35, 30, 40], 0.5);
    expect(o!.neededU).toBeGreaterThanOrEqual(0);
  });

  describe('timing — the split/dose distinction', () => {
    it('calls a low soon after the meal a split problem', () => {
      const o = analyze([110, 120, 85, 55, 70, 95, 110]);
      expect(o!.wentLow).toBe(true);
      expect(o!.minutesToNadir).toBeLessThanOrEqual(EARLY_LOW_CUTOFF_MIN);
      expect(o!.timing).toBe('early');
    });

    it('calls a low hours later a dose problem', () => {
      // 15-min steps: index 12 is 3h in, past the early cutoff.
      const o = analyze([110, 170, 200, 190, 175, 160, 150, 140, 130, 120, 100, 85, 58, 70]);
      expect(o!.wentLow).toBe(true);
      expect(o!.minutesToNadir).toBeGreaterThan(EARLY_LOW_CUTOFF_MIN);
      expect(o!.timing).toBe('late');
    });

    it('has no timing when nothing went low', () => {
      expect(analyze([110, 160, 180, 140, 110, 95])!.timing).toBe('none');
    });
  });

  describe('confounders', () => {
    /**
     * A juice on the way down lifts the nadir, so the measured overshoot is a
     * floor on the real one. Reporting the number as clean would understate it.
     */
    it('flags rescue carbs and marks the reading unclean', () => {
      const o = analyze([110, 140, 110, 80, 62, 90, 120], 2.4, {
        carbs: [{ iso: new Date(new Date(MEAL).getTime() + 60 * 60_000).toISOString(), grams: 15 }],
      });
      expect(o!.confounders.rescueCarbsG).toBe(15);
      expect(o!.clean).toBe(false);
    });

    it('does not count a normal later meal as a rescue', () => {
      const o = analyze([110, 150, 175, 160, 140, 120, 105], 2.4, {
        carbs: [{ iso: new Date(new Date(MEAL).getTime() + 4 * 3600_000).toISOString(), grams: 70 }],
      });
      expect(o!.confounders.rescueCarbsG).toBe(0);
      expect(o!.clean).toBe(true);
    });

    it('flags a missing baseline', () => {
      // Starts 15 min AFTER the meal: nothing at or before it to anchor to.
      const bare = [110, 150, 120, 80, 55, 70].map((mgdl, i) => ({
        iso: new Date(new Date(MEAL).getTime() + (i + 1) * 15 * 60_000).toISOString(),
        mgdl,
      }));
      const o = analyzeMealInsulin({
        mealIso: MEAL, carbsG: 60, givenU: 2.4, isf: ISF, glucose: bare, lowBoundMgdl: 65,
      });
      expect(o!.confounders.missingBaseline).toBe(true);
      expect(o!.clean).toBe(false);
    });
  });

  describe('refuses to guess', () => {
    it('returns null without a usable ISF', () => {
      for (const isf of [0, -10, NaN]) {
        expect(
          analyzeMealInsulin({
            mealIso: MEAL, carbsG: 60, givenU: 2.4, isf, glucose: trace([110, 90, 60]),
          }),
        ).toBeNull();
      }
    });

    it('returns null with too few readings to describe a shape', () => {
      // Built without the padding helper — two readings and nothing else.
      const sparse = [110, 90].map((mgdl, i) => ({
        iso: new Date(new Date(MEAL).getTime() + i * 15 * 60_000).toISOString(),
        mgdl,
      }));
      expect(
        analyzeMealInsulin({
          mealIso: MEAL, carbsG: 60, givenU: 2.4, isf: ISF, glucose: sparse, lowBoundMgdl: 65,
        }),
      ).toBeNull();
    });

    it('returns null on an unparseable meal time', () => {
      expect(
        analyzeMealInsulin({
          mealIso: 'nope', carbsG: 60, givenU: 2.4, isf: ISF, glucose: trace([110, 90, 60]),
        }),
      ).toBeNull();
    });
  });
});

describe('summariseInsulinNeed', () => {
  const low = (nadir: number, minutes: number, givenU = 2.4): MealInsulinOutcome => ({
    mealIso: MEAL, carbsG: 60, givenU,
    excessU: +((65 - nadir) / ISF).toFixed(2),
    neededU: +(givenU - (65 - nadir) / ISF).toFixed(2),
    baselineMgdl: 110, nadirMgdl: nadir, minutesToNadir: minutes, wentLow: true,
    timing: minutes <= EARLY_LOW_CUTOFF_MIN ? 'early' : 'late',
    confounders: { rescueCarbsG: 0, missingBaseline: false, truncated: false },
    clean: true,
  });
  const ok = (): MealInsulinOutcome => ({
    mealIso: MEAL, carbsG: 60, givenU: 2.4, excessU: 0, neededU: 2.4,
    baselineMgdl: 110, nadirMgdl: 95, minutesToNadir: 200, wentLow: false, timing: 'none',
    confounders: { rescueCarbsG: 0, missingBaseline: false, truncated: false },
    clean: true,
  });

  it('points at the split when the lows are early', () => {
    const p = summariseInsulinNeed([low(50, 90), low(55, 105), ok()]);
    expect(p.lever).toBe('split');
    expect(p.actionable).toBe(true);
    expect(p.earlyLows).toBe(2);
    expect(describeInsulinNeed(p)).toMatch(/upfront/i);
  });

  it('points at the total when the lows are late', () => {
    const p = summariseInsulinNeed([low(52, 240), low(58, 260), ok()]);
    expect(p.lever).toBe('dose');
    expect(describeInsulinNeed(p)).toMatch(/total/i);
  });

  it('says mixed rather than averaging opposite fixes together', () => {
    const p = summariseInsulinNeed([low(50, 90), low(52, 250), ok()]);
    expect(p.lever).toBe('mixed');
    expect(describeInsulinNeed(p)).toMatch(/opposite directions/i);
  });

  it('will not act on a single low', () => {
    const p = summariseInsulinNeed([low(50, 90), ok(), ok()]);
    expect(p.actionable).toBe(false);
    expect(p.lever).toBe('none');
  });

  it(`will not act on fewer than ${MIN_OCCURRENCES} servings`, () => {
    const p = summariseInsulinNeed([low(50, 90), low(55, 100)]);
    expect(p.occurrences).toBe(2);
    expect(p.actionable).toBe(false);
  });

  it('ignores unjudgeable servings instead of scoring them as fine', () => {
    // A null must not count as a serving that went well — that would dilute
    // the low rate with meals nothing was ever measured about.
    const p = summariseInsulinNeed([low(50, 90), low(55, 100), null, null, ok()]);
    expect(p.occurrences).toBe(3);
    expect(p.lowRate).toBeCloseTo(0.67, 2);
  });

  it('uses the median so one bad serving cannot carry the pattern', () => {
    const p = summariseInsulinNeed([low(60, 90), low(58, 95), low(10, 100), ok()]);
    // The 10 mg/dL crash is an outlier; the median excess stays near the others.
    expect(p.medianExcessU).toBeLessThan(0.3);
  });

  it('reports how many servings were confounded', () => {
    const dirty = { ...low(50, 90), clean: false };
    const p = summariseInsulinNeed([dirty, low(55, 100), ok()]);
    expect(p.confoundedCount).toBe(1);
  });

  it('handles no history without dividing by zero', () => {
    const p = summariseInsulinNeed([]);
    expect(p.occurrences).toBe(0);
    expect(p.lowRate).toBe(0);
    expect(p.actionable).toBe(false);
    expect(describeInsulinNeed(p)).toMatch(/no servings/i);
  });
});

describe('describeInsulinNeed — no instructions', () => {
  it('never tells the reader what to take', () => {
    const patterns = [
      summariseInsulinNeed([]),
      summariseInsulinNeed([
        { ...({} as MealInsulinOutcome) },
      ].slice(0, 0)),
      summariseInsulinNeed([
        {
          mealIso: MEAL, carbsG: 60, givenU: 2.4, excessU: 0.4, neededU: 2.0,
          baselineMgdl: 110, nadirMgdl: 47, minutesToNadir: 90, wentLow: true, timing: 'early',
          confounders: { rescueCarbsG: 0, missingBaseline: false, truncated: false }, clean: true,
        },
        {
          mealIso: MEAL, carbsG: 60, givenU: 2.4, excessU: 0.3, neededU: 2.1,
          baselineMgdl: 110, nadirMgdl: 52, minutesToNadir: 100, wentLow: true, timing: 'early',
          confounders: { rescueCarbsG: 0, missingBaseline: false, truncated: false }, clean: true,
        },
        {
          mealIso: MEAL, carbsG: 60, givenU: 2.4, excessU: 0, neededU: 2.4,
          baselineMgdl: 110, nadirMgdl: 95, minutesToNadir: 200, wentLow: false, timing: 'none',
          confounders: { rescueCarbsG: 0, missingBaseline: false, truncated: false }, clean: true,
        },
      ]),
    ];
    const BANNED = [
      /\btake\b/i,
      /\bgive yourself\b/i,
      /\byou should\b/i,
      /\btry\s+\d/i,
      /\bnext time\b[^.]{0,20}\b\d+(\.\d+)?\s*U\b/i,
    ];
    for (const p of patterns) {
      const copy = describeInsulinNeed(p);
      for (const pattern of BANNED) {
        expect(pattern.test(copy), `"${copy}" matched ${pattern}`).toBe(false);
      }
    }
  });
});
