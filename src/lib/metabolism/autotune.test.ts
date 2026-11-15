import { describe, expect, it } from 'vitest';
import { computeAutotune, DAMPING, MIN_MEALS } from './autotune';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading } from '@/data/sources/types';

const therapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

const NOW = new Date(2026, 1, 1, 12, 0, 0);
const DAY_MS = 24 * 3600_000;

/**
 * `days` of CGM at 5-minute cadence. `shape(hour)` returns the mg/dL change per
 * step during that hour, so a drift can be confined to a slice of the day.
 */
function cgm(days: number, shape: (hour: number) => number, base = 120): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  const start = NOW.getTime() - days * DAY_MS;
  for (let d = 0; d < days; d += 1) {
    let mgdl = base;
    for (let step = 0; step < 288; step += 1) {
      const t = start + d * DAY_MS + step * 5 * 60_000;
      const hour = new Date(t).getHours();
      mgdl += shape(hour);
      // Keep inside physiological bounds without flattening the drift.
      if (mgdl > 300) mgdl = base;
      if (mgdl < 60) mgdl = base;
      out.push({ iso: new Date(t).toISOString(), mgdl });
    }
  }
  return out;
}

/** One meal a day at `hour`, across `days`. */
function meals(days: number, hour: number, grams = 60): CarbEntry[] {
  const start = NOW.getTime() - days * DAY_MS;
  return Array.from({ length: days }, (_, d) => ({
    iso: new Date(
      new Date(start + d * DAY_MS).setHours(hour, 0, 0, 0),
    ).toISOString(),
    grams,
    absorptionHours: 3,
  }));
}

const flat = () => 0;

describe('gating on data volume', () => {
  it('reports nothing usable from a couple of days', () => {
    const r = computeAutotune({
      glucose: cgm(2, flat),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.basal.confidence).toBe('unusable');
    expect(r.suggestions).toHaveLength(0);
  });

  it('survives a completely empty history', () => {
    const r = computeAutotune({ glucose: [], carbs: [], insulin: [], therapy, now: NOW });
    expect(r.basal.confidence).toBe('unusable');
    expect(r.isf.implied).toBeNull();
    expect(r.carbRatio.implied).toBeNull();
    expect(Number.isFinite(r.basal.impliedDailyU)).toBe(true);
  });

  it('marks an hour with too few readings unusable rather than guessing', () => {
    const r = computeAutotune({
      glucose: cgm(14, (h) => (h === 3 ? 0 : 0)).filter(
        (g) => new Date(g.iso).getHours() < 12,
      ),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    const afternoon = r.basal.hours.filter((h) => h.hour >= 13);
    for (const h of afternoon) {
      expect(h.confidence).toBe('unusable');
      expect(h.deltaU).toBe(0);
    }
  });
});

describe('basal by hour', () => {
  it('leaves a schedule alone when nothing drifts', () => {
    const r = computeAutotune({
      glucose: cgm(14, flat),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    for (const h of r.basal.hours) {
      expect(Math.abs(h.deltaU)).toBeLessThan(0.02);
    }
  });

  it('points higher for an hour that drifts up while fasting', () => {
    // 2am–5am rises with nothing logged; the rest of the day is flat.
    const r = computeAutotune({
      glucose: cgm(14, (h) => (h >= 2 && h < 5 ? 0.8 : 0)),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    const drifting = r.basal.hours.filter((h) => h.hour >= 2 && h.hour < 5);
    const calm = r.basal.hours.filter((h) => h.hour >= 8 && h.hour < 12);
    const driftDelta = drifting.reduce((a, h) => a + h.deltaU, 0) / drifting.length;
    const calmDelta = calm.reduce((a, h) => a + h.deltaU, 0) / calm.length;
    expect(driftDelta).toBeGreaterThan(calmDelta);
  });

  it('damps to a fraction of the computed correction', () => {
    const r = computeAutotune({
      glucose: cgm(14, (h) => (h >= 2 && h < 5 ? 0.8 : 0)),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    for (const h of r.basal.hours) {
      if (h.confidence === 'unusable') continue;
      if (h.impliedRate === h.scheduledRate) continue;
      const full = Math.abs(h.impliedRate - h.scheduledRate);
      const applied = Math.abs(h.dampedRate - h.scheduledRate);
      // A single run must move only part of the way — never the whole way.
      // Slack covers the 3-decimal rounding on both rates.
      expect(applied).toBeLessThan(full);
      expect(applied).toBeLessThanOrEqual(full * DAMPING + 0.002);
    }
  });

  it('never recommends a negative rate', () => {
    const r = computeAutotune({
      glucose: cgm(14, (h) => (h < 6 ? -2 : 0), 280),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    for (const h of r.basal.hours) expect(h.dampedRate).toBeGreaterThanOrEqual(0);
  });

  it('caps how far one run can move a rate even on extreme data', () => {
    const r = computeAutotune({
      glucose: cgm(14, () => 3),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    for (const h of r.basal.hours) {
      if (h.confidence === 'unusable') continue;
      expect(h.dampedRate).toBeLessThanOrEqual(h.scheduledRate * 1.2 + 1e-6);
      expect(h.dampedRate).toBeGreaterThanOrEqual(h.scheduledRate * 0.8 - 1e-6);
    }
  });
});

describe('carb-log gating — the constraint the whole method depends on', () => {
  it('refuses carb ratio outright when no carbs were logged', () => {
    const r = computeAutotune({
      glucose: cgm(21, flat),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.carbRatio.confidence).toBe('unusable');
    expect(r.carbRatio.implied).toBeNull();
    expect(r.carbQuality.note).toContain('No carb entries');
  });

  it('refuses carb ratio below the meal-count floor', () => {
    const r = computeAutotune({
      glucose: cgm(21, flat),
      carbs: meals(5, 12),
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.carbRatio.confidence).toBe('unusable');
    expect(r.carbRatio.note).toContain(`of ${MIN_MEALS}`);
  });

  it('downgrades ISF rather than trusting it when carbs are absent', () => {
    const r = computeAutotune({
      glucose: cgm(21, flat),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.isf.confidence).not.toBe('good');
  });

  it('downgrades everything when unlogged meals dominate', () => {
    // Big daily rises with nothing logged: the window is full of meals the
    // analysis cannot see.
    const r = computeAutotune({
      glucose: cgm(21, (h) => (h >= 7 && h < 11 ? 2.5 : 0)),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.carbQuality.uamSharePct).toBeGreaterThan(0);
    expect(r.carbRatio.confidence).toBe('unusable');
  });

  it('counts days with carbs, not just entries', () => {
    // Twenty meals all on one day is not twenty days of evidence.
    const oneDay = Array.from({ length: 20 }, (_, i) => ({
      iso: new Date(NOW.getTime() - 3 * DAY_MS + i * 60_000).toISOString(),
      grams: 40,
      absorptionHours: 3,
    }));
    const r = computeAutotune({
      glucose: cgm(21, flat),
      carbs: oneDay,
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.carbQuality.daysWithCarbs).toBe(1);
    expect(r.carbQuality.coveragePct).toBeLessThan(50);
    expect(r.carbRatio.confidence).not.toBe('good');
  });
});

describe('carb ratio', () => {
  it('reads a ratio once meals are logged consistently', () => {
    const days = 21;
    const r = computeAutotune({
      glucose: cgm(days, (h) => (h >= 12 && h < 15 ? 1.5 : 0)),
      carbs: meals(days, 12),
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.carbRatio.confidence).not.toBe('unusable');
    expect(r.carbRatio.implied).toBeGreaterThan(0);
    expect(r.carbRatio.observedCsf).toBeGreaterThan(0);
  });

  it('seeds carb sensitivity as ISF over carb ratio', () => {
    const r = computeAutotune({
      glucose: cgm(21, flat),
      carbs: meals(21, 12),
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(r.carbRatio.seededCsf).toBeCloseTo(4, 2); // 40 / 10
  });

  it('damps the carb ratio like everything else', () => {
    const days = 21;
    const r = computeAutotune({
      glucose: cgm(days, (h) => (h >= 12 && h < 15 ? 3 : 0)),
      carbs: meals(days, 12),
      insulin: [],
      therapy,
      now: NOW,
    });
    if (r.carbRatio.implied != null && r.carbRatio.damped != null) {
      const full = Math.abs(r.carbRatio.implied - r.carbRatio.current);
      const applied = Math.abs(r.carbRatio.damped - r.carbRatio.current);
      if (full > 0) expect(applied).toBeLessThan(full);
    }
  });
});

describe('flat outputs only — this method has no per-hour ISF or carb ratio', () => {
  it('exposes a single ISF and a single carb ratio, not schedules', () => {
    const schedules = {
      ...therapy,
      insulinSensitivitySchedule: [
        { startMinutes: 0, value: 40 },
        { startMinutes: 12 * 60, value: 60 },
      ],
      carbRatioSchedule: [
        { startMinutes: 0, value: 10 },
        { startMinutes: 12 * 60, value: 14 },
      ],
    } as unknown as LoopTherapy;
    const r = computeAutotune({
      glucose: cgm(21, flat),
      carbs: meals(21, 12),
      insulin: [],
      therapy: schedules,
      now: NOW,
    });
    expect(typeof r.isf.current).toBe('number');
    expect(typeof r.carbRatio.current).toBe('number');
    // Flattened as a duration-weighted mean of the schedule.
    expect(r.isf.current).toBe(50);
    expect(r.carbRatio.current).toBe(12);
  });
});

describe('safety contract', () => {
  const runs = [
    computeAutotune({
      glucose: cgm(21, (h) => (h >= 2 && h < 5 ? 0.8 : 0)),
      carbs: meals(21, 12),
      insulin: [],
      therapy,
      now: NOW,
    }),
    computeAutotune({ glucose: cgm(21, flat), carbs: [], insulin: [], therapy, now: NOW }),
    computeAutotune({ glucose: cgm(2, flat), carbs: [], insulin: [], therapy, now: NOW }),
  ];

  it('never instructs a change to a pump setting', () => {
    const banned = [
      /take \d/i,
      /\b(increase|decrease|raise|lower|set|change|adjust) (your |the )?(basal|bolus|isf|sensitivity|carb ratio|rate)/i,
      /you should/i,
      /\bmust\b/i,
      /grams? of (fast|carb)/i,
    ];
    const lines = runs.flatMap((r) => [
      ...r.suggestions,
      r.basal.note,
      r.isf.note,
      r.carbRatio.note,
      r.carbQuality.note,
    ]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const re of banned) expect(line, `"${line}"`).not.toMatch(re);
    }
  });

  it('frames every basal line as something to review, not to do', () => {
    const basalLines = runs[0].suggestions.filter((s) => s.includes('U/hr'));
    for (const line of basalLines) {
      expect(line.toLowerCase()).toMatch(/worth reviewing|care team|points at/);
    }
  });

  it('emits no suggestions at all when confidence is unusable', () => {
    expect(runs[2].suggestions).toHaveLength(0);
  });
});
