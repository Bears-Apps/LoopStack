import { describe, expect, it } from 'vitest';
import {
  absorptionPatternFromNotes,
  carbImpactFraction,
  computeCarbPlan,
  DELAYED_METABOLIC_PATTERN_ID,
  DESSERT_FOOD_TYPE_MARKER,
  HEAVY_FOOD_TYPE_MARKER,
  LEGACY_DESSERT_FOOD_TYPE_MARKER,
  MODEL_KNEES,
  modelCumulativeFraction,
  modelImpactFraction,
  modelKindForEntry,
  modelKindForLabel,
  modelKindGlyph,
  modelKindLabel,
  modelPeakWindowFractions,
  modelPercentTimeAtFraction,
  STANDARD_PATTERN_ID,
  STEP_MINUTES,
} from './carbAbsorption';
import type { LoopTherapy } from '@/data/loopTherapy';

const therapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

const MEAL_TIME = new Date(2026, 4, 1, 12, 0, 0);

const plan = (over: Partial<Parameters<typeof computeCarbPlan>[0]> = {}) =>
  computeCarbPlan({
    grams: 60,
    absorptionHours: 3,
    units: 6,
    preBolusMinutes: 15,
    therapy,
    mealTime: MEAL_TIME,
    ...over,
  });

describe('carb absorption curve', () => {
  const T = 180;

  it('is zero outside the absorption window', () => {
    expect(carbImpactFraction(-10, T)).toBe(0);
    expect(carbImpactFraction(0, T)).toBe(0);
    expect(carbImpactFraction(T, T)).toBe(0);
    expect(carbImpactFraction(T + 60, T)).toBe(0);
  });

  it('integrates to the whole meal', () => {
    let sum = 0;
    for (let m = 0; m < T; m += 0.5) sum += carbImpactFraction(m, T) * 0.5;
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });

  it('ramps up, holds, then falls — Loop’s piecewise shape', () => {
    const early = carbImpactFraction(T * 0.05, T);
    const rising = carbImpactFraction(T * 0.12, T);
    const plateauA = carbImpactFraction(T * 0.25, T);
    const plateauB = carbImpactFraction(T * 0.45, T);
    const late = carbImpactFraction(T * 0.8, T);

    expect(early).toBeLessThan(rising);
    expect(rising).toBeLessThan(plateauA);
    expect(plateauA).toBeCloseTo(plateauB, 6);
    expect(late).toBeLessThan(plateauB);
  });

  it('scales so a longer absorption spreads the same total thinner', () => {
    const fast = carbImpactFraction(60, 120);
    const slow = carbImpactFraction(60, 360);
    expect(fast).toBeGreaterThan(slow);
  });

  it('handles a zero-length window without dividing by zero', () => {
    expect(carbImpactFraction(10, 0)).toBe(0);
  });
});

describe('the modelled plan', () => {
  it('values the meal at grams x carb sensitivity', () => {
    // 60 g at ISF 40 / CR 10 = 4 mg/dL per gram = 240 mg/dL.
    const p = plan();
    expect(p.csf).toBe(4);
    expect(p.totalCarbRiseMgdl).toBe(240);
  });

  it('values the insulin at units x ISF', () => {
    expect(plan().totalInsulinDropMgdl).toBe(-240);
  });

  it('nets to roughly nothing when the two are matched', () => {
    // 60 g on a 10 g/U ratio is 6 U — the curves should cancel.
    expect(Math.abs(plan().netMgdl)).toBeLessThan(15);
  });

  it('finishes high when the meal is under-covered', () => {
    expect(plan({ units: 2 }).netMgdl).toBeGreaterThan(100);
  });

  it('finishes low when the meal is over-covered', () => {
    expect(plan({ units: 10 }).netMgdl).toBeLessThan(-100);
  });

  it('carries carbs with no insulin as a pure rise', () => {
    const p = plan({ units: 0 });
    expect(p.netMgdl).toBeGreaterThan(200);
    // Plain zero, not −0: the latter renders as "-0" wherever a point is
    // formatted for display.
    for (const pt of p.points) expect(Object.is(pt.insulinMgdl, 0)).toBe(true);
  });

  it('starts the window at the bolus when it goes in first', () => {
    const p = plan({ preBolusMinutes: 30 });
    expect(p.points[0].minute).toBe(-30);
  });

  it('starts at the meal when there is no lead time', () => {
    expect(plan({ preBolusMinutes: 0 }).points[0].minute).toBe(0);
  });

  it('steps at CGM cadence', () => {
    const p = plan();
    expect(p.points[1].minute - p.points[0].minute).toBe(STEP_MINUTES);
  });

  it('tracks a cumulative path that matches the per-step net', () => {
    const p = plan();
    const summed = p.points.reduce((a, pt) => a + pt.netMgdl, 0);
    expect(p.points[p.points.length - 1].cumulativeMgdl).toBeCloseTo(summed, 0);
  });

  it('resolves the schedules against the meal time, not the wall clock', () => {
    const scheduled = {
      ...therapy,
      insulinSensitivitySchedule: [
        { startMinutes: 0, value: 40 },
        { startMinutes: 18 * 60, value: 80 },
      ],
      carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
    } as unknown as LoopTherapy;
    const evening = computeCarbPlan({
      grams: 60,
      absorptionHours: 3,
      units: 6,
      preBolusMinutes: 15,
      therapy: scheduled,
      mealTime: new Date(2026, 4, 1, 19, 0, 0),
    });
    expect(evening.isf).toBe(80);
  });
});

describe('peak timing — the question this screen exists to answer', () => {
  it('puts insulin later than food when the bolus goes in at the table', () => {
    const p = plan({ preBolusMinutes: 0, absorptionHours: 2 });
    expect(p.peakGapMinutes).toBeGreaterThan(0);
  });

  it('closes the gap as lead time increases', () => {
    const none = plan({ preBolusMinutes: 0 });
    const lead = plan({ preBolusMinutes: 45 });
    expect(lead.peakGapMinutes).toBeLessThan(none.peakGapMinutes);
  });

  it('shows a lower peak rise when the dose goes in earlier', () => {
    const none = plan({ preBolusMinutes: 0 });
    const lead = plan({ preBolusMinutes: 45 });
    expect(lead.maxRiseMgdl).toBeLessThan(none.maxRiseMgdl);
  });
});

describe('safety contract', () => {
  const cases = [
    plan(),
    plan({ units: 0 }),
    plan({ units: 2 }),
    plan({ units: 12 }),
    plan({ preBolusMinutes: 0 }),
    plan({ preBolusMinutes: 60 }),
    plan({ grams: 0, units: 0 }),
  ];

  it('never tells anyone what to take', () => {
    const banned = [
      /take \d/i,
      /\bgive\b/i,
      /you should/i,
      /\bmust\b/i,
      /\bbolus \d/i,
      /recommend/i,
      /\d+(\.\d+)?\s*units? (of|for|now|before)/i,
      /increase (your )?(basal|bolus|dose)/i,
    ];
    const lines = cases.flatMap((c) => c.notes);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const re of banned) expect(line, `"${line}"`).not.toMatch(re);
    }
  });

  it('says nothing at all about an empty plan', () => {
    expect(plan({ grams: 0, units: 0 }).notes).toHaveLength(0);
  });

  it('describes shape rather than prescribing a change', () => {
    const late = plan({ preBolusMinutes: 0, absorptionHours: 2 });
    expect(late.notes.join(' ')).toMatch(/peaks|climbs|curves|lands|stays/);
  });
});

describe('marked curve models (🥜 dessert / 🍲 heavy)', () => {
  it('resolves the curve kind from the food label, dessert first', () => {
    expect(modelKindForLabel(undefined)).toBe('piecewise');
    expect(modelKindForLabel('pizza night')).toBe('piecewise');
    expect(modelKindForLabel(DESSERT_FOOD_TYPE_MARKER)).toBe('dessert');
    expect(modelKindForLabel(`${DESSERT_FOOD_TYPE_MARKER} birthday cake`)).toBe('dessert');
    // Legacy 🌙 marker from pre-rename builds still grades as dessert.
    expect(modelKindForLabel(LEGACY_DESSERT_FOOD_TYPE_MARKER)).toBe('dessert');
    expect(modelKindForLabel(`${LEGACY_DESSERT_FOOD_TYPE_MARKER} birthday cake`)).toBe('dessert');
    expect(modelKindForLabel(HEAVY_FOOD_TYPE_MARKER)).toBe('heavy');
    expect(modelKindForLabel(`${HEAVY_FOOD_TYPE_MARKER} deep dish`)).toBe('heavy');
    // Same precedence as the fork's resolvedAbsorptionModel: dessert wins.
    expect(modelKindForLabel(`${DESSERT_FOOD_TYPE_MARKER} ${HEAVY_FOOD_TYPE_MARKER}`)).toBe('dessert');
  });

  it('integrates to the whole meal for every kind', () => {
    for (const [kind, T] of [
      ['dessert', 720],
      ['heavy', 480],
      ['delayedMetabolicV1', 720],
      ['piecewise', 180],
    ] as const) {
      let sum = 0;
      for (let m = 0; m < T; m += 0.5) sum += modelImpactFraction(kind, m, T) * 0.5;
      expect(sum, kind).toBeGreaterThan(0.99);
      expect(sum, kind).toBeLessThan(1.01);
    }
  });

  it('is zero outside the absorption window for the knee curves', () => {
    for (const kind of ['dessert', 'heavy', 'delayedMetabolicV1'] as const) {
      expect(modelImpactFraction(kind, -10, 480)).toBe(0);
      expect(modelImpactFraction(kind, 0, 480)).toBe(0);
      expect(modelImpactFraction(kind, 480, 480)).toBe(0);
      expect(modelImpactFraction(kind, 500, 480)).toBe(0);
    }
  });

  it('delegates piecewise to the untouched Loop curve', () => {
    for (const m of [10, 45, 90, 150]) {
      expect(modelImpactFraction('piecewise', m, 180)).toBe(carbImpactFraction(m, 180));
    }
  });

  it('puts each curve peak where the fork designed it', () => {
    // Piecewise plateau: 15–50% of the duration.
    expect(modelPeakWindowFractions('piecewise')).toEqual({ start: 0.15, end: 0.5 });
    // Dessert second wave: hours 8–10 of 12.
    const dessert = modelPeakWindowFractions('dessert');
    expect(dessert.start).toBeCloseTo(8 / 12, 9);
    expect(dessert.end).toBeCloseTo(10 / 12, 9);
    // Heavy mid-peak: hours 2–3 of 8.
    const heavy = modelPeakWindowFractions('heavy');
    expect(heavy.start).toBeCloseTo(2 / 8, 9);
    expect(heavy.end).toBeCloseTo(3 / 8, 9);
  });
});

describe('🥜 delayed-metabolic curve (absorptionPatternIdentifier = delayed-metabolic-v1)', () => {
  // DelayedMetabolicResponseAbsorption.knees in the LoopKit fork
  // (LoopKit/LoopKit/CarbKit/DelayedMetabolicResponseAbsorption.swift,
  // parabolic-absorption @ 1bdbe685). Any drift here means LoopStack grades
  // these entries against a curve Loop is not running.
  const SWIFT_KNEES: [number, number][] = [
    [0, 0],
    [0.125, 0.05],
    [0.25, 0.13],
    [0.36, 0.23],
    [0.43, 0.33],
    [0.57, 0.6],
    [0.64, 0.7],
    [0.8, 0.86],
    [1, 1],
  ];
  const kind = 'delayedMetabolicV1' as const;

  it('matches the Swift knee table exactly', () => {
    expect(MODEL_KNEES.delayedMetabolicV1.map(([t, p]) => [t, p])).toEqual(SWIFT_KNEES);
  });

  it('is strictly increasing in both time and absorbed fraction, from (0,0) to (1,1)', () => {
    const knees = MODEL_KNEES.delayedMetabolicV1;
    expect(knees[0]).toEqual([0, 0]);
    expect(knees[knees.length - 1]).toEqual([1, 1]);
    for (let i = 1; i < knees.length; i += 1) {
      expect(knees[i][0]).toBeGreaterThan(knees[i - 1][0]);
      expect(knees[i][1]).toBeGreaterThan(knees[i - 1][1]);
    }
  });

  it('sums its segment shares to the whole meal', () => {
    const knees = MODEL_KNEES.delayedMetabolicV1;
    let total = 0;
    for (let i = 1; i < knees.length; i += 1) total += knees[i][1] - knees[i - 1][1];
    expect(total).toBeCloseTo(1, 12);
    // And the per-minute rate integrates to 1 at a 12 h entry.
    let sum = 0;
    for (let m = 0; m < 720; m += 0.25) sum += modelImpactFraction(kind, m, 720) * 0.25;
    expect(sum).toBeCloseTo(1, 3);
  });

  it('reproduces the documented milestones at a 12 h entry', () => {
    // 5% by 1.5 h, 13% by 3 h, 23% by 4.3 h, 60% by 6.8 h, 86% by 9.6 h.
    expect(modelCumulativeFraction(kind, 1.5 / 12)).toBeCloseTo(0.05, 9);
    expect(modelCumulativeFraction(kind, 3 / 12)).toBeCloseTo(0.13, 9);
    expect(modelCumulativeFraction(kind, 0.36)).toBeCloseTo(0.23, 9);
    expect(modelCumulativeFraction(kind, 0.57)).toBeCloseTo(0.6, 9);
    expect(modelCumulativeFraction(kind, 0.8)).toBeCloseTo(0.86, 9);
    expect(modelCumulativeFraction(kind, 0)).toBe(0);
    expect(modelCumulativeFraction(kind, 1)).toBe(1);
    expect(modelCumulativeFraction(kind, -0.1)).toBe(0);
    expect(modelCumulativeFraction(kind, 1.5)).toBe(1);
  });

  it('is monotone between the knees and inverts exactly', () => {
    let prev = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const t = i / 1000;
      const p = modelCumulativeFraction(kind, t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
      // percentTimeAtPercentAbsorption(percentAbsorptionAtPercentTime(t)) == t
      expect(modelPercentTimeAtFraction(kind, p)).toBeCloseTo(t, 9);
    }
    for (let i = 0; i <= 1000; i += 1) {
      const p = i / 1000;
      expect(modelCumulativeFraction(kind, modelPercentTimeAtFraction(kind, p))).toBeCloseTo(p, 9);
    }
  });

  it('puts the peak-rate window at 0.43–0.57 of the duration, centred on the 0.50 average late rise', () => {
    const peak = modelPeakWindowFractions(kind);
    expect(peak.start).toBeCloseTo(0.43, 9);
    expect(peak.end).toBeCloseTo(0.57, 9);
    expect((peak.start + peak.end) / 2).toBeCloseTo(0.5, 9);
    // Peak segment carries 27% in 14% of the time: 1.93x the mean rate.
    const rate = modelImpactFraction(kind, 0.5 * 720, 720) * 720;
    expect(rate).toBeCloseTo(0.27 / 0.14, 6);
  });

  it('holds more carbs back than the global piecewise model early on', () => {
    // The fork's note: PiecewiseLinear has 26% absorbed by 25% time, 63% by 50%.
    expect(modelCumulativeFraction(kind, 0.25)).toBeLessThan(modelCumulativeFraction('piecewise', 0.25));
    expect(modelCumulativeFraction(kind, 0.5)).toBeLessThan(modelCumulativeFraction('piecewise', 0.5));
  });

  it('names the curve distinctly from the legacy 🥜 dessert curve', () => {
    expect(modelKindLabel(kind)).not.toBe(modelKindLabel('dessert'));
    expect(modelKindGlyph(kind)).not.toBe(modelKindGlyph('dessert'));
    expect(modelKindGlyph('piecewise')).toBe('');
  });
});

describe('cumulative piecewise curve', () => {
  it('integrates the per-minute shape and inverts', () => {
    for (const t of [0.05, 0.15, 0.3, 0.5, 0.7, 0.95]) {
      let sum = 0;
      for (let m = 0; m < t * 600; m += 0.1) sum += carbImpactFraction(m, 600) * 0.1;
      expect(modelCumulativeFraction('piecewise', t)).toBeCloseTo(sum, 3);
      expect(modelPercentTimeAtFraction('piecewise', modelCumulativeFraction('piecewise', t))).toBeCloseTo(t, 6);
    }
    expect(modelCumulativeFraction('piecewise', 1)).toBe(1);
  });
});

describe('absorption-pattern identifier (Nightscout notes marker)', () => {
  it('reads the bracketed identifier the uploader patch writes', () => {
    expect(absorptionPatternFromNotes('[delayed-metabolic-v1]')).toBe(DELAYED_METABOLIC_PATTERN_ID);
    expect(absorptionPatternFromNotes('[standard-v1]')).toBe(STANDARD_PATTERN_ID);
    expect(absorptionPatternFromNotes('late dessert [delayed-metabolic-v1] zoodles')).toBe(
      DELAYED_METABOLIC_PATTERN_ID,
    );
    // A newer build's identifier still parses; the resolver decides what to do with it.
    expect(absorptionPatternFromNotes('[delayed-metabolic-v2]')).toBe('delayed-metabolic-v2');
  });

  it('ignores notes without a marker, and bracketed text that is not an identifier', () => {
    expect(absorptionPatternFromNotes(undefined)).toBeNull();
    expect(absorptionPatternFromNotes(null)).toBeNull();
    expect(absorptionPatternFromNotes('')).toBeNull();
    expect(absorptionPatternFromNotes('pizza night')).toBeNull();
    expect(absorptionPatternFromNotes('[late]')).toBeNull();
    expect(absorptionPatternFromNotes('[Delayed-Metabolic-V1]')).toBeNull();
    expect(absorptionPatternFromNotes('delayed-metabolic-v1')).toBeNull();
  });

  it('resolves the curve the way the fork does: identifier first, then legacy markers', () => {
    // Identifier set: it decides, whatever the label says.
    expect(modelKindForEntry({ absorptionPattern: DELAYED_METABOLIC_PATTERN_ID })).toBe('delayedMetabolicV1');
    expect(
      modelKindForEntry({ label: `${DESSERT_FOOD_TYPE_MARKER} cake`, absorptionPattern: DELAYED_METABOLIC_PATTERN_ID }),
    ).toBe('delayedMetabolicV1');
    expect(
      modelKindForEntry({ label: `${HEAVY_FOOD_TYPE_MARKER} stew`, absorptionPattern: DELAYED_METABOLIC_PATTERN_ID }),
    ).toBe('delayedMetabolicV1');
    // "standard-v1" pins the global model even over a legacy marker.
    expect(modelKindForEntry({ label: DESSERT_FOOD_TYPE_MARKER, absorptionPattern: STANDARD_PATTERN_ID })).toBe(
      'piecewise',
    );
    expect(modelKindForEntry({ label: HEAVY_FOOD_TYPE_MARKER, absorptionPattern: STANDARD_PATTERN_ID })).toBe(
      'piecewise',
    );
    // An identifier this code does not know falls back to the global model, not a guess.
    expect(modelKindForEntry({ label: DESSERT_FOOD_TYPE_MARKER, absorptionPattern: 'delayed-metabolic-v2' })).toBe(
      'piecewise',
    );
    // No identifier: the legacy marker path, untouched.
    expect(modelKindForEntry({ label: DESSERT_FOOD_TYPE_MARKER })).toBe('dessert');
    expect(modelKindForEntry({ label: LEGACY_DESSERT_FOOD_TYPE_MARKER, absorptionPattern: null })).toBe('dessert');
    expect(modelKindForEntry({ label: HEAVY_FOOD_TYPE_MARKER, absorptionPattern: undefined })).toBe('heavy');
    expect(modelKindForEntry({ label: 'pizza night' })).toBe('piecewise');
    expect(modelKindForEntry({})).toBe('piecewise');
  });

  it('leaves the label-only resolver exactly as it was', () => {
    expect(modelKindForLabel(`${DESSERT_FOOD_TYPE_MARKER} [delayed-metabolic-v1]`)).toBe('dessert');
    expect(modelKindForLabel('[delayed-metabolic-v1]')).toBe('piecewise');
  });
});
