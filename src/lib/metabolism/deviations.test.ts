import { describe, expect, it } from 'vitest';
import {
  carbsOnBoardAt,
  computeDeviations,
  flatCarbRatio,
  flatIsf,
  percentile,
  seedCsf,
  CARB_BLACKOUT_MINUTES,
} from './deviations';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';

const therapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

const T0 = new Date(2026, 0, 15, 2, 0, 0).getTime(); // 2am local, quiet hour

/** Flat glucose every 5 min for `count` steps. */
function flatGlucose(count: number, mgdl = 120, startMs = T0): GlucoseReading[] {
  return Array.from({ length: count }, (_, i) => ({
    iso: new Date(startMs + i * 5 * 60_000).toISOString(),
    mgdl,
  }));
}

function risingGlucose(count: number, perStep: number, startMgdl = 120, startMs = T0) {
  return Array.from({ length: count }, (_, i) => ({
    iso: new Date(startMs + i * 5 * 60_000).toISOString(),
    mgdl: startMgdl + i * perStep,
  }));
}

describe('schedule flattening', () => {
  it('weights each segment by how long it runs', () => {
    const t = {
      insulinSensitivitySchedule: [
        { startMinutes: 0, value: 40 },        // 12 h
        { startMinutes: 12 * 60, value: 60 },  // 12 h
      ],
      carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
    } as unknown as LoopTherapy;
    expect(flatIsf(t)).toBe(50);
    expect(flatCarbRatio(t)).toBe(10);
  });

  it('weights a short segment less than a long one', () => {
    const t = {
      insulinSensitivitySchedule: [
        { startMinutes: 0, value: 40 },        // 23 h
        { startMinutes: 23 * 60, value: 100 }, // 1 h
      ],
    } as unknown as LoopTherapy;
    expect(flatIsf(t)).toBeCloseTo(42.5, 1);
  });

  it('returns zero for an empty schedule rather than NaN', () => {
    expect(flatIsf({ insulinSensitivitySchedule: [] } as unknown as LoopTherapy)).toBe(0);
  });
});

describe('carb sensitivity seed', () => {
  it('is ISF divided by carb ratio', () => {
    expect(seedCsf(42, 14)).toBe(3);
  });

  it('does not divide by zero', () => {
    expect(seedCsf(42, 0)).toBe(0);
  });
});

describe('carbs on board', () => {
  const carbs: CarbEntry[] = [
    { iso: new Date(T0).toISOString(), grams: 60, absorptionHours: 3 },
  ];

  it('is the full amount at entry and gone after absorption', () => {
    expect(carbsOnBoardAt(T0, carbs, 4)).toBeCloseTo(60, 0);
    expect(carbsOnBoardAt(T0 + 4 * 3600_000, carbs, 4)).toBe(0);
  });

  it('decays monotonically', () => {
    let prev = Infinity;
    for (let m = 0; m < 180; m += 15) {
      const cob = carbsOnBoardAt(T0 + m * 60_000, carbs, 4);
      expect(cob).toBeLessThanOrEqual(prev);
      prev = cob;
    }
  });

  it('applies the decay floor so a long absorption cannot pin COB forever', () => {
    // 100 g logged with a 12 h absorption decays linearly at only ~0.7 g per
    // 5 min, so COB would still be near 80 g three hours later and every step
    // until midnight would be excluded as "still absorbing". The floor decays
    // at 8 mg/dL per 5 min worth of carb — here 2 g — and must win.
    const slow: CarbEntry[] = [
      { iso: new Date(T0).toISOString(), grams: 100, absorptionHours: 12 },
    ];
    const linear = 100 * (1 - 180 / 720); // 75 g
    const floored = 100 - (180 / 5) * (8 / 4); // 28 g
    const actual = carbsOnBoardAt(T0 + 180 * 60_000, slow, 4);
    expect(actual).toBeLessThan(linear);
    expect(actual).toBeCloseTo(floored, 5);
  });

  it('lets linear decay win when it is the faster of the two', () => {
    // The floor is a minimum decay rate, not a replacement. A big meal on a
    // short absorption already clears faster than the floor and must not be
    // held back to it: 80 g over 2 h sheds 3.3 g per 5 min against a 2 g floor.
    const big: CarbEntry[] = [
      { iso: new Date(T0).toISOString(), grams: 80, absorptionHours: 2 },
    ];
    const linear = 80 * (1 - 60 / 120); // 40 g
    const floored = 80 - (60 / 5) * (8 / 4); // 56 g
    expect(linear).toBeLessThan(floored);
    expect(carbsOnBoardAt(T0 + 60 * 60_000, big, 4)).toBeCloseTo(linear, 5);
  });

  it('ignores carbs logged in the future', () => {
    expect(carbsOnBoardAt(T0 - 60_000, carbs, 4)).toBe(0);
  });
});

describe('deviation computation', () => {
  it('reads flat glucose with no insulin as zero deviation', () => {
    const { steps } = computeDeviations({
      glucose: flatGlucose(12),
      carbs: [],
      insulin: [],
      therapy,
    });
    expect(steps.length).toBe(11);
    for (const s of steps) expect(s.deviation).toBeCloseTo(0, 6);
  });

  it('credits insulin with the drop it explains', () => {
    // A bolus is acting, and glucose falls. If the fall matches the insulin,
    // deviation is near zero — glucose did what the insulin said it would.
    const insulin: InsulinEvent[] = [
      { iso: new Date(T0 - 60 * 60_000).toISOString(), units: 2, kind: 'bolus' },
    ];
    const withInsulin = computeDeviations({
      glucose: flatGlucose(12),
      carbs: [],
      insulin,
      therapy,
    });
    // Glucose held flat while insulin was acting, so something unexplained held
    // it up: deviation must be positive.
    const mean =
      withInsulin.steps.reduce((a, s) => a + s.deviation, 0) / withInsulin.steps.length;
    expect(mean).toBeGreaterThan(0);
    for (const s of withInsulin.steps) expect(s.bgi).toBeLessThan(0);
  });

  it('does not fabricate a deviation across a CGM gap', () => {
    const glucose: GlucoseReading[] = [
      { iso: new Date(T0).toISOString(), mgdl: 100 },
      { iso: new Date(T0 + 60 * 60_000).toISOString(), mgdl: 200 },
    ];
    const { steps } = computeDeviations({ glucose, carbs: [], insulin: [], therapy });
    expect(steps).toHaveLength(0);
  });

  it('normalises uneven steps so percentiles stay comparable', () => {
    // A 10-minute gap with a 10 mg/dL rise is the same rate as a 5-minute gap
    // with a 5 mg/dL rise, and must produce the same deviation.
    const even = computeDeviations({
      glucose: [
        { iso: new Date(T0).toISOString(), mgdl: 100 },
        { iso: new Date(T0 + 5 * 60_000).toISOString(), mgdl: 105 },
      ],
      carbs: [],
      insulin: [],
      therapy,
    });
    const uneven = computeDeviations({
      glucose: [
        { iso: new Date(T0).toISOString(), mgdl: 100 },
        { iso: new Date(T0 + 10 * 60_000).toISOString(), mgdl: 110 },
      ],
      carbs: [],
      insulin: [],
      therapy,
    });
    expect(uneven.steps[0].deviation).toBeCloseTo(even.steps[0].deviation, 6);
  });
});

describe('bucketing — the part that decides what each insight may claim', () => {
  it('keeps the first 45 minutes after a carb entry out of the basal read', () => {
    const carbs: CarbEntry[] = [
      { iso: new Date(T0).toISOString(), grams: 40, absorptionHours: 3 },
    ];
    const { steps } = computeDeviations({
      glucose: risingGlucose(20, 4),
      carbs,
      insulin: [],
      therapy,
    });
    const early = steps.filter((s) => s.ms - T0 <= CARB_BLACKOUT_MINUTES * 60_000);
    expect(early.length).toBeGreaterThan(0);
    for (const s of early) expect(s.bucket).not.toBe('basal');
  });

  it('counts the early post-meal rise toward carbs, not against them', () => {
    // The steepest part of a meal is the first 45 minutes. If those land
    // outside the carb bucket, the observed rise gets divided by the full
    // grams eaten and every meal reads as far weaker than it was.
    const carbs: CarbEntry[] = [
      { iso: new Date(T0).toISOString(), grams: 40, absorptionHours: 3 },
    ];
    const { carbSteps } = computeDeviations({
      glucose: risingGlucose(20, 4),
      carbs,
      insulin: [],
      therapy,
    });
    const early = carbSteps.filter((s) => s.ms - T0 <= CARB_BLACKOUT_MINUTES * 60_000);
    expect(early.length).toBeGreaterThan(0);
  });

  it('files later absorbing steps under csf, not basal', () => {
    const carbs: CarbEntry[] = [
      { iso: new Date(T0).toISOString(), grams: 60, absorptionHours: 3 },
    ];
    const { steps, cleanSteps } = computeDeviations({
      glucose: risingGlucose(24, 3),
      carbs,
      insulin: [],
      therapy,
    });
    expect(steps.some((s) => s.bucket === 'csf')).toBe(true);
    // Nothing during a logged meal may reach the basal analysis.
    for (const s of cleanSteps) expect(s.cob).toBe(0);
  });

  it('quarantines an unannounced meal instead of blaming basal', () => {
    // A sustained rise with nothing logged. If this lands in the basal bucket
    // it reads as chronic under-basal forever — the classic failure mode.
    const { steps } = computeDeviations({
      glucose: risingGlucose(30, 6),
      carbs: [],
      insulin: [],
      therapy,
    });
    expect(steps.some((s) => s.bucket === 'uam')).toBe(true);
    const basalShare = steps.filter((s) => s.bucket === 'basal').length / steps.length;
    expect(basalShare).toBeLessThan(0.5);
  });

  it('leaves a genuinely quiet stretch in the basal bucket', () => {
    const { cleanSteps, steps } = computeDeviations({
      glucose: flatGlucose(24),
      carbs: [],
      insulin: [],
      therapy,
    });
    expect(cleanSteps.length).toBe(steps.length);
  });
});

describe('percentile', () => {
  it('finds the median', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('handles the degenerate cases', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([7], 0.5)).toBe(7);
  });

  it('does not care about input order', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
  });
});
