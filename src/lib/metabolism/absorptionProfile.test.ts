import { describe, expect, it } from 'vitest';
import {
  buildAbsorptionReport,
  computeAbsorptionInsights,
  formatMinutes,
  MIN_MEALS_PER_PRESET,
  modeledMinutesToFraction,
  observeMeals,
} from './absorptionProfile';
import { activityFraction, modelFromTherapy } from './insulinActivity';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';

const therapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

const NOW = new Date(2026, 5, 30, 12, 0, 0);
const DAY_MS = 24 * 3600_000;

/**
 * Synthesize days where each meal's glucose trace follows a chosen impact
 * shape exactly, with any boluses cancelled analytically — so the deviation
 * engine recovers the shape we wrote and assertions can be about timing.
 *
 * `shape(minutesSinceMeal)` returns mg/dL per 5-min step of carb impact;
 * outside a meal it contributes nothing.
 */
function synthesize(opts: {
  days: number;
  meals: {
    hour: number;
    grams: number;
    presetHours: number;
    label?: string;
    /** Peak of a triangular impact profile, minutes after eating. */
    peakMinute: number;
    /** Minutes after eating at which impact reaches zero. */
    doneMinute: number;
    withBolus?: boolean;
  }[];
}): { glucose: GlucoseReading[]; carbs: CarbEntry[]; insulin: InsulinEvent[] } {
  const glucose: GlucoseReading[] = [];
  const carbs: CarbEntry[] = [];
  const insulin: InsulinEvent[] = [];
  const model = modelFromTherapy(therapy);
  const isf = 40;
  // Fixed total rise per meal, and boluses sized to cancel exactly that much —
  // if the two disagreed, glucose would run off and hit the physiological
  // clamps, and the clamp (not the engine) would corrupt every assertion.
  const TOTAL = 120;

  for (let d = opts.days; d >= 1; d -= 1) {
    const day = new Date(NOW.getTime() - d * DAY_MS);
    day.setHours(0, 0, 0, 0);

    type Dose = { atMs: number; units: number };
    const doses: Dose[] = [];
    for (const meal of opts.meals) {
      const mealMs = day.getTime() + meal.hour * 3600_000;
      carbs.push({
        iso: new Date(mealMs).toISOString(),
        grams: meal.grams,
        absorptionHours: meal.presetHours,
        label: meal.label,
      });
      if (meal.withBolus) {
        const units = +(TOTAL / isf).toFixed(2);
        const atMs = mealMs - 15 * 60_000;
        insulin.push({ iso: new Date(atMs).toISOString(), units, kind: 'bolus' });
        doses.push({ atMs, units });
      }
    }

    // Triangle profile scaled to TOTAL so grams don't have to agree with CSF
    // for the timing tests to hold.
    const impactAt = (ms: number): number => {
      let v = 0;
      for (const meal of opts.meals) {
        const mealMs = day.getTime() + meal.hour * 3600_000;
        const since = (ms - mealMs) / 60_000;
        if (since <= 0 || since >= meal.doneMinute) continue;
        const p = meal.peakMinute;
        const dEnd = meal.doneMinute;
        const height = (2 * TOTAL) / dEnd; // triangle area = TOTAL
        const frac = since < p ? since / p : (dEnd - since) / (dEnd - p);
        v += height * frac * (5 / 1); // per 5-min step
      }
      return v / (5 / 1); // back to per-minute, integrated below per step
    };

    let mgdl = 110;
    for (let step = 0; step < 288; step += 1) {
      const t = day.getTime() + step * 5 * 60_000;
      // Carb impact for this 5-min step.
      let delta = impactAt(t) * 5;
      // Cancel every bolus analytically with the same curve the engine uses,
      // so net deviation equals the carb shape exactly.
      for (const dose of doses) {
        const age = (t - dose.atMs) / 60_000;
        delta -= dose.units * activityFraction(age, model) * isf * 5;
      }
      mgdl = Math.max(55, Math.min(320, mgdl + delta));
      glucose.push({ iso: new Date(t).toISOString(), mgdl: Math.round(mgdl * 10) / 10 });
    }
  }

  return { glucose, carbs, insulin };
}

const compute = (data: ReturnType<typeof synthesize>, windowDays = 21) =>
  computeAbsorptionInsights({ ...data, therapy, windowDays, now: NOW });

describe('modelled reference points', () => {
  it('puts modelled 90% at ~74% of the duration for the piecewise curve', () => {
    // Analytically: rise/plateau hold 63% by the half-way mark, and the decay
    // ramp reaches the remaining 27% about 43 min into its 90 — ~134 min.
    const t90 = modeledMinutesToFraction(180, 0.9);
    expect(t90).toBeGreaterThan(125);
    expect(t90).toBeLessThan(145);
  });

  it('scales with the preset', () => {
    expect(modeledMinutesToFraction(360, 0.9)).toBeCloseTo(
      2 * modeledMinutesToFraction(180, 0.9),
      -1,
    );
  });

  it('reads the marked knee curves, not piecewise, for marked kinds', () => {
    // Dessert knees: 65% at h8, 92% at h10 → 90% ≈ 9h51m of a 12h entry.
    const dessertT90 = modeledMinutesToFraction(720, 0.9, 'dessert');
    expect(dessertT90).toBeGreaterThan(585);
    expect(dessertT90).toBeLessThan(597);
    // Heavy knees: 89% at h7 → 90% ≈ 7h05m of an 8h entry.
    const heavyT90 = modeledMinutesToFraction(480, 0.9, 'heavy');
    expect(heavyT90).toBeGreaterThan(420);
    expect(heavyT90).toBeLessThan(432);
    // Both are far later than the piecewise ~74% reference at those durations.
    expect(dessertT90).toBeGreaterThan(modeledMinutesToFraction(720, 0.9));
    expect(heavyT90).toBeGreaterThan(modeledMinutesToFraction(480, 0.9));
  });
});

describe('isolating readable meals', () => {
  it('reads a lone meal and finds its timing', () => {
    const data = synthesize({
      days: 10,
      meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 }],
    });
    const { observed } = observeMeals({ ...data, therapy });
    const readable = observed.filter((m) => m.minutesToPeak != null);
    expect(readable.length).toBeGreaterThanOrEqual(8);
    const peak = readable[0].minutesToPeak!;
    expect(peak).toBeGreaterThanOrEqual(25);
    expect(peak).toBeLessThanOrEqual(55);
  });

  it('combines a subsequent entry within two hours into one sitting', () => {
    const data = synthesize({
      days: 6,
      meals: [
        { hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 },
        // 90 minutes later — same sitting under the two-hour rule.
        { hour: 9.5, grams: 50, presetHours: 3, peakMinute: 40, doneMinute: 150 },
      ],
    });
    const { observed, excludedOverlapping } = observeMeals({ ...data, therapy });
    expect(excludedOverlapping).toBe(0);
    for (const m of observed) {
      expect(m.grams).toBe(110);
      expect(m.entryCount).toBe(2);
      expect(new Date(m.iso).getHours()).toBe(8);
    }
  });

  it('excludes a meal whose predecessor is still absorbing beyond the combo window', () => {
    const data = synthesize({
      days: 6,
      meals: [
        { hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 },
        // 2.5 h later — past the combining rule, inside the 3 h absorption.
        { hour: 10.5, grams: 50, presetHours: 3, peakMinute: 40, doneMinute: 150 },
      ],
    });
    const { observed, excludedOverlapping } = observeMeals({ ...data, therapy });
    expect(excludedOverlapping).toBeGreaterThan(0);
    // The second plate of each day must never appear as readable.
    for (const m of observed) {
      expect(new Date(m.iso).getHours()).toBe(8);
    }
  });

  it('cuts the window at the next meal instead of absorbing its rise', () => {
    const data = synthesize({
      days: 8,
      meals: [
        { hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 },
        { hour: 12, grams: 80, presetHours: 3, peakMinute: 40, doneMinute: 150 },
      ],
    });
    const { observed } = observeMeals({ ...data, therapy });
    const breakfast = observed.filter((m) => new Date(m.iso).getHours() === 8);
    for (const m of breakfast) {
      // Horizon would be 270; lunch at +240 cuts it to ~225.
      expect(m.observedMinutes).toBeLessThanOrEqual(226);
      expect(m.truncated).toBe(true);
    }
  });

  it('nets a bolus out rather than reading it as fast absorption', () => {
    const plain = synthesize({
      days: 10,
      meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 }],
    });
    const bolused = synthesize({
      days: 10,
      meals: [
        { hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150, withBolus: true },
      ],
    });
    const a = compute(plain).presets[0];
    const b = compute(bolused).presets[0];
    expect(a.medianMinutesTo90).not.toBeNull();
    expect(b.medianMinutesTo90).not.toBeNull();
    // Netting is exact in the synthesis, so timing must agree closely.
    expect(Math.abs(a.medianMinutesTo90! - b.medianMinutesTo90!)).toBeLessThanOrEqual(10);
  });

  it('skips meals with no observable rise instead of inventing timing', () => {
    const data = synthesize({
      days: 6,
      meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 }],
    });
    // Flatten the glucose entirely: logged meals, no impact.
    const flat = data.glucose.map((g) => ({ ...g, mgdl: 110 }));
    const { observed } = observeMeals({ ...data, glucose: flat, therapy });
    for (const m of observed) expect(m.minutesToPeak).toBeNull();
  });
});

describe('preset verdicts', () => {
  it('calls a preset that matches its meals "matches"', () => {
    // 3h preset, impact done at ~150min ≈ modelled t90 of ~157.
    const r = compute(
      synthesize({
        days: 12,
        meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 50, doneMinute: 160 }],
      }),
    );
    expect(r.presets).toHaveLength(1);
    expect(r.presets[0].verdict).toBe('matches');
  });

  it('flags a preset whose meals finish well early', () => {
    // Entered at 6h, actually done in ~2.5h.
    const r = compute(
      synthesize({
        days: 12,
        meals: [{ hour: 8, grams: 70, presetHours: 6, peakMinute: 45, doneMinute: 150 }],
      }),
    );
    expect(r.presets[0].verdict).toBe('finishes_early');
    expect(r.presets[0].note).toContain('shorter absorption');
  });

  it('flags a preset whose meals outlast it', () => {
    // Entered at 3h, still absorbing at 4h+ (horizon is 4.5h).
    const r = compute(
      synthesize({
        days: 12,
        meals: [{ hour: 8, grams: 70, presetHours: 3, peakMinute: 90, doneMinute: 280 }],
      }),
    );
    expect(r.presets[0].verdict).toBe('outlasts');
    expect(r.presets[0].note).toContain('longer absorption');
  });

  it('stays "building" below the meal floor and states the gate', () => {
    const r = compute(
      synthesize({
        days: 3,
        meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 50, doneMinute: 160 }],
      }),
    );
    expect(r.presets[0].verdict).toBe('building');
    expect(r.presets[0].note).toContain(`${MIN_MEALS_PER_PRESET}`);
  });

  it('keeps the user presets separate', () => {
    const r = compute(
      synthesize({
        days: 12,
        meals: [
          { hour: 8, grams: 55, presetHours: 3, peakMinute: 45, doneMinute: 155 },
          { hour: 19, grams: 85, presetHours: 6, peakMinute: 100, doneMinute: 340 },
        ],
      }),
    );
    expect(r.presets.map((p) => p.presetHours)).toEqual([3, 6]);
  });

  it('keeps 🍲-marked entries an individual case beside plain entries of the same duration', () => {
    // The heavy plate sits in the morning: the synthesizer starts each day
    // fresh, so a meal whose tail crosses midnight loses it.
    const r = compute(
      synthesize({
        days: 12,
        meals: [
          {
            hour: 8,
            grams: 80,
            presetHours: 8,
            label: '🍲8h lentil stew night',
            peakMinute: 150,
            doneMinute: 520,
          },
          { hour: 19, grams: 60, presetHours: 8, peakMinute: 90, doneMinute: 280 },
        ],
      }),
    );
    expect(r.presets.map((p) => [p.presetHours, p.modelKind])).toEqual([
      [8, 'piecewise'],
      [8, 'heavy'],
    ]);
    const heavy = r.presets[1];
    // The marked group is graded against the fork's long-tail knee curve:
    // modelled 90% ≈ 7h05m, not the piecewise ~5h55m the plain group carries.
    expect(heavy.modelLabel).toContain('long-tail');
    expect(heavy.modeledMinutesTo90).toBeGreaterThan(r.presets[0].modeledMinutesTo90 + 60);
    // Peak window is the knee curve's steepest segment: hours 2–3 of 8.
    expect(heavy.modeledPeakStart).toBe(120);
    expect(heavy.modeledPeakEnd).toBe(180);
    // A ~6.4h-done plate against the long-tail curve reads as a fit, and the
    // note names the curve it was graded against.
    expect(heavy.verdict).toBe('matches');
    expect(heavy.note).toContain('long-tail curve');
  });

  it('grades dessert-marked entries against the second-wave curve — legacy 🌙 label included', () => {
    const r = compute(
      synthesize({
        days: 14,
        meals: [
          {
            hour: 8,
            grams: 90,
            presetHours: 12,
            // Deliberately the LEGACY marker: 30 days of real history
            // carries 🌙12h from pre-rename builds and must still group here.
            label: '🌙12h dessert',
            peakMinute: 500,
            doneMinute: 640,
          },
        ],
      }),
    );
    expect(r.presets.map((p) => [p.presetHours, p.modelKind])).toEqual([[12, 'dessert']]);
    const dessert = r.presets[0];
    // Second-wave peak window: hours 8–10 of 12; modelled 90% ≈ 9h51m.
    expect(dessert.modeledPeakStart).toBe(480);
    expect(dessert.modeledPeakEnd).toBe(600);
    expect(dessert.modeledMinutesTo90).toBeGreaterThan(585);
    expect(dessert.modeledMinutesTo90).toBeLessThan(597);
  });

  it('builds a curve that ends at ~100% observed and modelled', () => {
    const r = compute(
      synthesize({
        days: 12,
        meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 50, doneMinute: 160 }],
      }),
    );
    const curve = r.presets[0].curve;
    expect(curve.length).toBeGreaterThan(20);
    const last = curve[curve.length - 1];
    expect(last.observedPct).toBeGreaterThanOrEqual(95);
    expect(last.modeledPct).toBeGreaterThanOrEqual(95);
    // Monotone non-decreasing — a cumulative curve that dips is a bug.
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].observedPct).toBeGreaterThanOrEqual(curve[i - 1].observedPct);
    }
  });
});

describe('foods', () => {
  it('groups labelled meals and says which preset the food actually tracks', () => {
    const r = compute(
      synthesize({
        days: 12,
        meals: [
          // Logged 3h but behaves like the 6h preset.
          { hour: 8, grams: 60, presetHours: 3, label: 'Pizza night', peakMinute: 90, doneMinute: 290 },
          { hour: 19, grams: 80, presetHours: 6, label: 'Dal + rice', peakMinute: 110, doneMinute: 330 },
        ],
      }),
    );
    const pizza = r.foods.find((f) => f.label === 'Pizza night');
    expect(pizza).toBeDefined();
    expect(pizza!.loggedPresetHours).toBe(3);
    expect(pizza!.closestPresetHours).toBe(6);
    expect(pizza!.note).toContain('tracks your 6h preset');
  });

  it('leaves unlabelled meals out of the food table', () => {
    const r = compute(
      synthesize({
        days: 12,
        meals: [{ hour: 8, grams: 60, presetHours: 3, peakMinute: 50, doneMinute: 160 }],
      }),
    );
    expect(r.foods).toHaveLength(0);
  });
});

describe('the export', () => {
  const r = compute(
    synthesize({
      days: 12,
      meals: [
        { hour: 8, grams: 55, presetHours: 3, label: 'Oatmeal', peakMinute: 45, doneMinute: 155 },
        { hour: 19, grams: 85, presetHours: 6, label: 'Pizza night', peakMinute: 100, doneMinute: 340 },
      ],
    }),
  );

  it('carries every preset and food with observed vs modelled figures', () => {
    expect(r.report).toContain('# LoopStack — observed carb absorption export');
    expect(r.report).toContain('| 3h |');
    expect(r.report).toContain('| 6h |');
    expect(r.report).toContain('Oatmeal');
    expect(r.report).toContain('Pizza night');
    expect(r.report).toContain('90% done');
    expect(r.report).toContain('Caveats');
  });

  it('describes method and settings so an outside model has the context', () => {
    expect(r.report).toContain('insulin activity netted out');
    expect(r.report).toContain('ISF');
    expect(r.report).toContain('carb ratio');
  });

  it('never contains dosing language', () => {
    const banned = [
      /take \d/i,
      /\byou should\b/i,
      /\d+(\.\d+)?\s*units? (of|for|now|before)/i,
      /(increase|decrease|raise|lower) (your |the )?(basal|bolus|dose|isf)/i,
      /\brecommend\b/i,
    ];
    for (const re of banned) expect(r.report).not.toMatch(re);
    for (const p of r.presets) {
      for (const re of banned) expect(p.note).not.toMatch(re);
    }
  });
});

describe('gating and degenerate inputs', () => {
  it('survives an empty history', () => {
    const r = computeAbsorptionInsights({
      glucose: [],
      carbs: [],
      insulin: [],
      therapy,
      windowDays: 30,
      now: NOW,
    });
    expect(r.presets).toHaveLength(0);
    expect(r.foods).toHaveLength(0);
    expect(r.dataNote).toContain('No meals');
    expect(r.report).toContain('0 of 0');
  });

  it('reports exclusions in the data note instead of hiding them', () => {
    const r = compute(
      synthesize({
        days: 8,
        meals: [
          { hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 },
          { hour: 10.5, grams: 50, presetHours: 3, peakMinute: 40, doneMinute: 150 },
        ],
      }),
    );
    expect(r.excludedOverlapping).toBeGreaterThan(0);
    expect(r.dataNote).toContain('overlapped');
  });

  it('reports combos in the data note and the export', () => {
    const r = compute(
      synthesize({
        days: 8,
        meals: [
          { hour: 8, grams: 60, presetHours: 3, peakMinute: 40, doneMinute: 150 },
          { hour: 9.5, grams: 50, presetHours: 3, peakMinute: 40, doneMinute: 150 },
        ],
      }),
    );
    expect(r.comboMeals).toBeGreaterThan(0);
    expect(r.dataNote).toContain('one big meal');
    expect(r.report).toContain('combined from carb entries');
  });
});

describe('formatMinutes', () => {
  it('formats under and over an hour', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(155)).toBe('2h 35m');
  });
});

describe('report builder in isolation', () => {
  it('handles a result with no presets at all', () => {
    const text = buildAbsorptionReport(
      {
        windowDays: 30,
        totalMeals: 2,
        cleanMeals: 0,
        comboMeals: 0,
        excludedOverlapping: 2,
        excludedOther: 0,
        presets: [],
        foods: [],
        dataNote: 'x',
      },
      therapy,
    );
    expect(text).toContain('0 of 2');
    expect(text).not.toContain('| undefined');
  });
});
