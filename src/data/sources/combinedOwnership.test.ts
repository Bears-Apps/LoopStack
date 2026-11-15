import { describe, expect, it } from 'vitest';
import { mergeSnapshots } from './combinedDataSource';
import type { DataResult, DataSnapshot } from './types';

// The one-owner rule, asserted rather than trusted.
//
// Loop writes the same bolus to Apple Health AND to Nightscout, and the same
// carb entry to both. So when a field takes data from both sides at once, every
// unit of insulin and gram of carb is counted twice — and nothing looks broken,
// because the numbers are still plausible. Dedupe cannot save this: HealthKit
// stamps the pump's clock and Nightscout stamps the upload's, so the two copies
// of one bolus rarely share a timestamp.
//
// The rule is therefore structural: each field comes from exactly one snapshot,
// whole. These tests fail if anyone ever writes a union.

/** A snapshot whose every field is tagged so its origin is identifiable. */
function taggedSnapshot(tag: 'ns' | 'hk'): DataSnapshot {
  const field = (): DataResult<unknown> => ({
    data: { tag } as never,
    loading: false,
    error: null,
    lastUpdatedIso: `2026-01-01T00:00:00.000Z`,
    isStale: false,
    origin: 'computed',
  });

  const keys: (keyof DataSnapshot)[] = [
    'currentGlucose',
    'recentGlucose',
    'recentInsulin',
    'recentCarbs',
    'recentWorkouts',
    'recentHeartRate',
    'restingHeartRate',
    'metrics',
    'timeTrends',
    'insulinLedger',
    'activitySummary',
    'weekdayExercise',
    'loopMode',
    'basalInsights',
    'autosens',
    'autotune',
    'absorptionInsights',
    'settingsReview',
    'riskWindows',
    'currentLoopIob',
    'hypoEvents',
    'agp',
    'mealPanels',
    'correctionOutcomes',
    'tempBasalUse',
  ];

  const out = {} as Record<string, unknown>;
  for (const k of keys) out[k] = field();
  // metrics carries a real record rather than a tag object: the merge reaches
  // into its shape, and a fixture that cannot survive that would be testing the
  // fixture rather than the merge.
  out.metrics = {
    ...(field() as object),
    data: { today: metricsRow(tag === 'hk' ? 99 : 10) },
  };
  return out as unknown as DataSnapshot;
}

function metricsRow(v: number) {
  return {
    range: 'today',
    targetLowMgdl: v,
    targetHighMgdl: v,
    urgentLowMgdl: v,
    daysInWindow: 1,
    avgGlucose: v,
    gmi: v,
    cv: v,
    sd: v,
    tir: { veryLow: v, low: v, inRange: v, high: v, veryHigh: v },
    totalInsulin: v,
    basalInsulin: v,
    bolusInsulin: v,
    carbs: v,
    steps: v,
    exerciseMinutes: v,
    sleepHours: v,
    deltas: {
      avgGlucose: { value: v, direction: 'neutral' as const },
      inRange: { value: v, direction: 'neutral' as const },
      gmi: { value: v, direction: 'neutral' as const },
      cv: { value: v, direction: 'neutral' as const },
      totalInsulin: { value: v, direction: 'neutral' as const },
    },
  };
}

/** Which side a merged field's data came from, or 'blend' if it came from both. */
function originOf(value: unknown): 'ns' | 'hk' | 'blend' | 'none' {
  const data = (value as DataResult<{ tag?: string }>)?.data;
  if (data == null) return 'none';
  const tag = (data as { tag?: string }).tag;
  if (tag === 'ns' || tag === 'hk') return tag;
  return 'blend';
}

const ns = taggedSnapshot('ns');
const hk = taggedSnapshot('hk');

/** Fields Apple Health owns outright — Nightscout carries no equivalent. */
const HEALTH_OWNED = [
  'recentWorkouts',
  'recentHeartRate',
  'restingHeartRate',
  'activitySummary',
  'weekdayExercise',
] as const;

/** Fields that follow the insulin radio. */
const INSULIN_OWNED = [
  'recentInsulin',
  'insulinLedger',
  'basalInsights',
  'autosens',
  'autotune',
  'absorptionInsights',
  'settingsReview',
  'correctionOutcomes',
] as const;

describe('combined source: one owner per field', () => {
  it('never blends two sources into a single field', () => {
    for (const owner of ['nightscout', 'healthkit'] as const) {
      const merged = mergeSnapshots(ns, hk, owner);
      for (const [key, value] of Object.entries(merged)) {
        // `metrics` is the one deliberate composite and is checked separately.
        if (key === 'metrics') continue;
        expect(originOf(value), `${key} under owner=${owner}`).not.toBe('blend');
      }
    }
  });

  it('covers every field — a new field must not silently default to nothing', () => {
    const merged = mergeSnapshots(ns, hk, 'nightscout');
    for (const [key, value] of Object.entries(merged)) {
      expect(originOf(value), `${key} has no data`).not.toBe('none');
    }
    // If the snapshot grows, this test's key list must grow with it.
    expect(Object.keys(merged).sort()).toEqual(Object.keys(ns).sort());
  });

  it('keeps Loop IOB on Nightscout even when insulin follows Apple Health', () => {
    // This is Loop's own published IOB from devicestatus. HealthKit has no
    // equivalent, so the insulin radio must not be able to point it at a source
    // that would silently return nothing.
    for (const owner of ['nightscout', 'healthkit'] as const) {
      const merged = mergeSnapshots(ns, hk, owner);
      expect(originOf(merged.currentLoopIob), `owner=${owner}`).toBe('ns');
    }
  });

  it('gives Apple Health the activity fields regardless of the insulin owner', () => {
    for (const owner of ['nightscout', 'healthkit'] as const) {
      const merged = mergeSnapshots(ns, hk, owner);
      for (const f of HEALTH_OWNED) {
        expect(originOf(merged[f]), `${f} under owner=${owner}`).toBe('hk');
      }
    }
  });

  it('gives Nightscout everything it owns regardless of the insulin owner', () => {
    const nsOwned = (Object.keys(ns) as (keyof DataSnapshot)[]).filter(
      (k) =>
        k !== 'metrics' &&
        !(HEALTH_OWNED as readonly string[]).includes(k) &&
        !(INSULIN_OWNED as readonly string[]).includes(k),
    );
    for (const owner of ['nightscout', 'healthkit'] as const) {
      const merged = mergeSnapshots(ns, hk, owner);
      for (const f of nsOwned) {
        expect(originOf(merged[f]), `${f} under owner=${owner}`).toBe('ns');
      }
    }
  });

  it('moves every insulin-derived field together, never a mix', () => {
    // Half from one side and half from the other would compare a glucose fall
    // against doses that were never in the same ledger.
    for (const owner of ['nightscout', 'healthkit'] as const) {
      const merged = mergeSnapshots(ns, hk, owner);
      const origins = INSULIN_OWNED.map((f) => originOf(merged[f]));
      expect(new Set(origins).size, `owner=${owner} split the insulin fields`).toBe(1);
      expect(origins[0]).toBe(owner === 'healthkit' ? 'hk' : 'ns');
    }
  });
});

describe('combined source: merged metrics take each column from one side', () => {
  const metricsSnapshot = (tag: 'ns' | 'hk', v: number): DataSnapshot => {
    const base = taggedSnapshot(tag);
    return {
      ...base,
      metrics: {
        ...base.metrics,
        data: { today: metricsRow(v) } as never,
      },
    };
  };

  const nsM = metricsSnapshot('ns', 10);
  const hkM = metricsSnapshot('hk', 99);

  it('takes lifestyle columns from Apple Health and never adds the two', () => {
    const m = mergeSnapshots(nsM, hkM, 'nightscout').metrics.data!.today;
    expect(m.steps).toBe(99);
    expect(m.exerciseMinutes).toBe(99);
    expect(m.sleepHours).toBe(99);
    // The sum would be 109 — the exact failure this guards.
    expect(m.steps).not.toBe(109);
  });

  it('takes glucose and carbs from Nightscout', () => {
    const m = mergeSnapshots(nsM, hkM, 'nightscout').metrics.data!.today;
    expect(m.avgGlucose).toBe(10);
    expect(m.carbs).toBe(10);
    expect(m.carbs).not.toBe(109);
  });

  it('takes the whole insulin trio from one side, never a mix', () => {
    const fromNs = mergeSnapshots(nsM, hkM, 'nightscout').metrics.data!.today;
    expect([fromNs.totalInsulin, fromNs.basalInsulin, fromNs.bolusInsulin]).toEqual([
      10, 10, 10,
    ]);

    const fromHk = mergeSnapshots(nsM, hkM, 'healthkit').metrics.data!.today;
    expect([fromHk.totalInsulin, fromHk.basalInsulin, fromHk.bolusInsulin]).toEqual([
      99, 99, 99,
    ]);
  });

  it('never sums insulin across the two back ends', () => {
    for (const owner of ['nightscout', 'healthkit'] as const) {
      const m = mergeSnapshots(nsM, hkM, owner).metrics.data!.today;
      expect(m.totalInsulin).not.toBe(109);
      expect(m.bolusInsulin).not.toBe(109);
    }
  });
});
