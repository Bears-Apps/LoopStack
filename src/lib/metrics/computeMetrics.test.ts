import { describe, expect, it } from 'vitest';
import {
  ALL_RANGES,
  computeAllMetrics,
  hasMetricsData,
  type MetricsInputs,
} from './computeMetrics';

const NOW = new Date('2026-07-21T12:00:00Z');
const DAY = 24 * 3600_000;

// Per-day glucose pattern (12 readings): 1 very-low, 1 low, 8 in-range,
// 1 high, 1 very-high → 8/12 ≈ 67% in range, deterministic.
const PER_DAY = [50, 65, 120, 120, 120, 120, 120, 120, 120, 120, 220, 260];

function buildGlucose(days: number) {
  const out: { iso: string; mgdl: number }[] = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < PER_DAY.length; i++) {
      const t = NOW.getTime() - d * DAY - i * 3600_000 - 1;
      out.push({ iso: new Date(t).toISOString(), mgdl: PER_DAY[i] });
    }
  }
  return out;
}

function dailySeries(days: number, value: number) {
  return Array.from({ length: days }, (_, d) => ({
    dayIso: new Date(NOW.getTime() - d * DAY).toISOString(),
    value,
  }));
}

function flatInputs(days: number): MetricsInputs {
  return {
    glucose: buildGlucose(days),
    insulinByDay: Array.from({ length: days }, (_, d) => ({
      dayIso: new Date(NOW.getTime() - d * DAY).toISOString(),
      basal: 18,
      bolus: 15,
    })),
    carbsByDay: dailySeries(days, 200),
    stepsByDay: dailySeries(days, 8000),
    exerciseByDay: dailySeries(days, 30),
    sleepByDay: dailySeries(days, 7),
  };
}

describe('computeAllMetrics', () => {
  const all = computeAllMetrics(flatInputs(200), NOW);

  it.each(ALL_RANGES)('%s: TIR bands sum to exactly 100', (r) => {
    const t = all[r].tir;
    expect(t.veryLow + t.low + t.inRange + t.high + t.veryHigh).toBe(100);
  });

  it.each(ALL_RANGES)('%s: in-range ≈ 67%%', (r) => {
    expect(all[r].tir.inRange).toBeGreaterThanOrEqual(66);
    expect(all[r].tir.inRange).toBeLessThanOrEqual(68);
  });

  it.each(ALL_RANGES)('%s: GMI matches the consensus formula', (r) => {
    const m = all[r];
    expect(Math.abs(m.gmi - (3.31 + 0.02392 * m.avgGlucose))).toBeLessThan(0.11);
  });

  it.each(ALL_RANGES)('%s: therapy + lifestyle per-day averages', (r) => {
    const m = all[r];
    expect(m.totalInsulin).toBe(33);
    expect(m.basalInsulin).toBe(18);
    expect(m.bolusInsulin).toBe(15);
    expect(m.carbs).toBe(200);
    expect(m.steps).toBe(8000);
    expect(m.sleepHours).toBe(7);
  });

  it('flat data yields ~zero deltas', () => {
    expect(Math.abs(all['7d'].deltas.inRange.value)).toBeLessThanOrEqual(1);
    expect(Math.abs(all['7d'].deltas.avgGlucose.value)).toBeLessThanOrEqual(1);
  });
});

describe('empty / partial windows', () => {
  it('hasMetricsData is false with no glucose', () => {
    expect(hasMetricsData({ ...flatInputs(0), glucose: [] })).toBe(false);
  });

  it('empty prior window → neutral deltas, never raw-value "changes"', () => {
    // Only 10 days of history: the 90d range has data, but its prior 90d
    // window is empty. Deltas must be neutral zero, not −142 "good".
    const all = computeAllMetrics(flatInputs(10), NOW);
    const d = all['90d'].deltas;
    expect(d.avgGlucose).toEqual({ value: 0, direction: 'neutral' });
    expect(d.inRange).toEqual({ value: 0, direction: 'neutral' });
    expect(d.gmi).toEqual({ value: 0, direction: 'neutral' });
    expect(d.totalInsulin).toEqual({ value: 0, direction: 'neutral' });
  });

  it('no data at all → zeroed metrics without NaN', () => {
    const all = computeAllMetrics(
      {
        glucose: [],
        insulinByDay: [],
        carbsByDay: [],
        stepsByDay: [],
        exerciseByDay: [],
        sleepByDay: [],
      },
      NOW,
    );
    const m = all['7d'];
    expect(m.avgGlucose).toBe(0);
    expect(Number.isNaN(m.cv)).toBe(false);
    expect(Number.isNaN(m.sleepHours)).toBe(false);
  });
});

// ---- Target range drives the in-range boundaries ----

describe('time in range against a personal target', () => {
  const NOW = new Date('2026-07-21T12:00:00Z');
  // One reading in each band relative to a 70–180 target: 50, 60, 100, 200, 300.
  const readings = [50, 60, 100, 200, 300].map((mgdl, i) => ({
    iso: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
    mgdl,
  }));

  const inputsWith = (targetRange?: { lowMgdl: number; highMgdl: number }) => ({
    glucose: readings,
    insulinByDay: [],
    carbsByDay: [],
    stepsByDay: [],
    exerciseByDay: [],
    sleepByDay: [],
    targetRange,
  });

  it('defaults to the consensus 70–180 when no target is set', () => {
    const m = computeAllMetrics(inputsWith(), NOW).today;
    expect(m.targetLowMgdl).toBe(70);
    expect(m.targetHighMgdl).toBe(180);
    // 50 very low, 60 low, 100 in range, 200 high, 300 very high.
    expect(m.tir).toEqual({
      veryLow: 20,
      low: 20,
      inRange: 20,
      high: 20,
      veryHigh: 20,
    });
  });

  it('moves the in-range boundaries to a tighter personal target', () => {
    // 80–160: the 100 stays in range, nothing else changes band here.
    const m = computeAllMetrics(
      inputsWith({ lowMgdl: 80, highMgdl: 160 }),
      NOW,
    ).today;
    expect(m.targetLowMgdl).toBe(80);
    expect(m.tir.inRange).toBe(20);
  });

  it('counts a reading below a raised target low as time spent low', () => {
    // 75 is in range at 70–180 but low at 80–180 — the whole point of the tie.
    const seventyFive = [
      // One minute back: the window is half-open, so a reading stamped exactly
      // at `now` sits outside it.
      { iso: new Date(NOW.getTime() - 60_000).toISOString(), mgdl: 75 },
    ];
    const base = { ...inputsWith(), glucose: seventyFive };

    expect(computeAllMetrics(base, NOW).today.tir.inRange).toBe(100);
    expect(
      computeAllMetrics(
        { ...base, targetRange: { lowMgdl: 80, highMgdl: 180 } },
        NOW,
      ).today.tir.low,
    ).toBe(100);
  });

  it('counts a reading above a lowered target high as time spent high', () => {
    const oneSeventy = [
      { iso: new Date(NOW.getTime() - 60_000).toISOString(), mgdl: 170 },
    ];
    const base = { ...inputsWith(), glucose: oneSeventy };

    expect(computeAllMetrics(base, NOW).today.tir.inRange).toBe(100);
    expect(
      computeAllMetrics(
        { ...base, targetRange: { lowMgdl: 70, highMgdl: 160 } },
        NOW,
      ).today.tir.high,
    ).toBe(100);
  });

  it('never lets a target below 54 invert the severe-low band', () => {
    // 54 is a clinical consensus threshold and does not move with preference.
    const m = computeAllMetrics(
      { ...inputsWith(), targetRange: { lowMgdl: 40, highMgdl: 180 } },
      NOW,
    ).today;
    expect(m.tir.veryLow).toBe(20); // the 50 reading is still severe-low
    expect(m.tir.low).toBe(0);      // no band between 54 and 54
    expect(m.tir.inRange).toBe(40); // 60 and 100 now both in range
  });

  it('never lets a target above 250 invert the severe-high band', () => {
    const m = computeAllMetrics(
      { ...inputsWith(), targetRange: { lowMgdl: 70, highMgdl: 280 } },
      NOW,
    ).today;
    // Ceiling raised to 280: 100 and 200 are in range, 300 is still above it.
    // The "high" band collapses to nothing (280→280) rather than going
    // negative, and 300 lands in very-high.
    expect(m.tir.inRange).toBe(40);
    expect(m.tir.high).toBe(0);
    expect(m.tir.veryHigh).toBe(20);
    expect(
      m.tir.veryLow + m.tir.low + m.tir.inRange + m.tir.high + m.tir.veryHigh,
    ).toBe(100);
  });

  it('always sums to 100 across targets', () => {
    for (const t of [
      { lowMgdl: 70, highMgdl: 180 },
      { lowMgdl: 80, highMgdl: 160 },
      { lowMgdl: 100, highMgdl: 110 },
      { lowMgdl: 60, highMgdl: 300 },
    ]) {
      const { tir } = computeAllMetrics({ ...inputsWith(), targetRange: t }, NOW).today;
      expect(tir.veryLow + tir.low + tir.inRange + tir.high + tir.veryHigh).toBe(100);
    }
  });
});

describe('configurable urgent-low band', () => {
  // Ryan's bands: urgent below 60, low 60-65, in range 65+. The urgent line is
  // a setting because where you start treating a low differently is personal.
  const at = (mgdl: number) => [
    { iso: new Date(NOW.getTime() - 60_000).toISOString(), mgdl },
  ];

  it('counts a 57 as urgent low when the line is 60, not merely low', () => {
    const m = computeAllMetrics(
      { ...flatInputs(0), glucose: at(57), targetRange: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 } },
      NOW,
    );
    expect(m.today.tir.veryLow).toBe(100);
    expect(m.today.tir.low).toBe(0);
  });

  it('counts a 62 as low, sitting between the two lines', () => {
    const m = computeAllMetrics(
      { ...flatInputs(0), glucose: at(62), targetRange: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 } },
      NOW,
    );
    expect(m.today.tir.low).toBe(100);
  });

  it('counts a 67 as in range once target low is 65', () => {
    const m = computeAllMetrics(
      { ...flatInputs(0), glucose: at(67), targetRange: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 } },
      NOW,
    );
    expect(m.today.tir.inRange).toBe(100);
  });

  it('falls back to the consensus 54 line when unset', () => {
    const m = computeAllMetrics(
      { ...flatInputs(0), glucose: at(57), targetRange: { lowMgdl: 70, highMgdl: 180 } },
      NOW,
    );
    expect(m.today.tir.low).toBe(100);
    expect(m.today.tir.veryLow).toBe(0);
  });

  it('reports the boundaries it scored against', () => {
    const m = computeAllMetrics(
      { ...flatInputs(3), targetRange: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 } },
      NOW,
    );
    expect(m['7d'].urgentLowMgdl).toBe(60);
    expect(m['7d'].targetLowMgdl).toBe(65);
  });
});

// ── Scheduled-basal fallback ────────────────────────────────────────────────
// Nightscout reports bolus only, so delivered basal arrives as 0. Without a
// fallback the split reads "100% bolus", which misrepresents what the pump is
// actually doing. The substituted value must be flagged so the UI can label it.
describe('scheduled basal fallback', () => {
  function bolusOnlyInputs(days: number, scheduled?: number): MetricsInputs {
    const base = flatInputs(days);
    return {
      ...base,
      insulinByDay: base.insulinByDay.map((d) => ({ ...d, basal: 0 })),
      scheduledDailyBasal: scheduled,
    };
  }

  it('substitutes the schedule when no basal was delivered', () => {
    const m = computeAllMetrics(bolusOnlyInputs(7, 20), NOW)['7d'];
    expect(m.basalInsulin).toBe(20);
    expect(m.bolusInsulin).toBe(15);
    expect(m.totalInsulin).toBe(35);
    expect(m.basalIsScheduled).toBe(true);
  });

  it('leaves delivered basal alone and does not flag it', () => {
    const m = computeAllMetrics({ ...flatInputs(7), scheduledDailyBasal: 20 }, NOW)['7d'];
    expect(m.basalInsulin).toBe(18); // delivered wins over scheduled
    expect(m.basalIsScheduled).toBe(false);
  });

  it('reports bolus-only honestly when no schedule is available', () => {
    const m = computeAllMetrics(bolusOnlyInputs(7), NOW)['7d'];
    expect(m.basalInsulin).toBe(0);
    expect(m.basalIsScheduled).toBe(false);
  });
});
