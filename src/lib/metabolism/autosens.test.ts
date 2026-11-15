import { describe, expect, it } from 'vitest';
import { AUTOSENS_MAX, AUTOSENS_MIN, computeAutosens, MIN_CLEAN_STEPS } from './autosens';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';

const therapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

const NOW = new Date(2026, 0, 16, 12, 0, 0);
const START = NOW.getTime() - 20 * 3600_000;

/** `count` readings, 5 min apart, each moving by `perStep` mg/dL. */
function series(count: number, perStep: number, startMgdl = 120): GlucoseReading[] {
  return Array.from({ length: count }, (_, i) => ({
    iso: new Date(START + i * 5 * 60_000).toISOString(),
    mgdl: Math.max(40, startMgdl + i * perStep),
  }));
}

describe('gating', () => {
  it('reports "building" rather than a number until there is enough clean data', () => {
    const a = computeAutosens({
      glucose: series(10, 0),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(a.verdict).toBe('building');
    expect(a.ratio).toBe(1);
    expect(a.note).toContain(`of ${MIN_CLEAN_STEPS}`);
  });

  it('refuses to report without an ISF on file', () => {
    const a = computeAutosens({
      glucose: series(200, 0),
      carbs: [],
      insulin: [],
      therapy: { ...therapy, insulinSensitivitySchedule: [] } as unknown as LoopTherapy,
      now: NOW,
    });
    expect(a.verdict).toBe('building');
    expect(a.note).toContain('No insulin sensitivity on file');
  });

  it('survives an empty history without throwing or returning NaN', () => {
    const a = computeAutosens({ glucose: [], carbs: [], insulin: [], therapy, now: NOW });
    expect(a.verdict).toBe('building');
    expect(Number.isFinite(a.ratio)).toBe(true);
    expect(Number.isFinite(a.medianDeviation)).toBe(true);
  });
});

describe('the ratio', () => {
  it('reads flat glucose with no insulin as no sensitivity shift', () => {
    const a = computeAutosens({
      glucose: series(200, 0),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(a.verdict).toBe('as_expected');
    expect(a.ratio).toBe(1);
    expect(a.cleanStepCount).toBeGreaterThanOrEqual(MIN_CLEAN_STEPS);
  });

  it('calls a persistent unexplained fall "sensitive"', () => {
    // Glucose sliding steadily with no insulin and no food on board: every
    // clean deviation is negative.
    const a = computeAutosens({
      glucose: series(200, -0.5, 220),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(a.verdict).toBe('sensitive');
    expect(a.ratio).toBeLessThan(1);
    expect(a.negativeSharePct).toBeGreaterThan(50);
  });

  it('stays inside the clamps and says so when it hits them', () => {
    // 80 steps of −4 runs 400 → 80 without ever hitting the helper's floor,
    // so every deviation in the median is a real fall.
    const a = computeAutosens({
      glucose: series(80, -4, 400),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(a.ratio).toBeGreaterThanOrEqual(AUTOSENS_MIN);
    expect(a.ratio).toBeLessThanOrEqual(AUTOSENS_MAX);
    expect(a.clamped).toBe(true);
    expect(a.rawRatio).toBeLessThan(AUTOSENS_MIN);
    expect(a.note).toContain('limit');
  });

  it('never reports outside the clamps in either direction', () => {
    for (const slope of [-8, -2, 0, 2, 8]) {
      const a = computeAutosens({
        glucose: series(200, slope, 150),
        carbs: [],
        insulin: [],
        therapy,
        now: NOW,
      });
      expect(a.ratio).toBeGreaterThanOrEqual(AUTOSENS_MIN);
      expect(a.ratio).toBeLessThanOrEqual(AUTOSENS_MAX);
    }
  });
});

describe('exclusions', () => {
  it('excludes steps with food in play', () => {
    const carbs: CarbEntry[] = [
      { iso: new Date(START + 60 * 60_000).toISOString(), grams: 60, absorptionHours: 3 },
    ];
    const a = computeAutosens({
      glucose: series(200, 0),
      carbs,
      insulin: [],
      therapy,
      now: NOW,
    });
    expect(a.excludedStepCount).toBeGreaterThan(0);
  });

  it('does not let a post-meal rise read as resistance', () => {
    // A big logged meal driving a long rise. If those steps reached the median,
    // the ratio would swing resistant on what is just digestion.
    const carbs: CarbEntry[] = [
      { iso: new Date(START + 30 * 60_000).toISOString(), grams: 90, absorptionHours: 4 },
    ];
    const glucose: GlucoseReading[] = [
      ...series(120, 0),
      ...Array.from({ length: 40 }, (_, i) => ({
        iso: new Date(START + (120 + i) * 5 * 60_000).toISOString(),
        mgdl: 120 + i * 4,
      })),
    ];
    const withMeal = computeAutosens({ glucose, carbs, insulin: [], therapy, now: NOW });
    const asIfUnlogged = computeAutosens({ glucose, carbs: [], insulin: [], therapy, now: NOW });
    expect(withMeal.ratio).toBeLessThanOrEqual(asIfUnlogged.ratio);
  });

  it('counts insulin from before the window, since it is still acting inside it', () => {
    // A bolus 30 min before the window opens is still doing most of its work
    // once the window starts. Dropping it would credit its drop to sensitivity.
    // The series is kept to ~6 h so the bolus is acting across most of it —
    // over a longer stretch the median is robust enough to shrug it off.
    const insulin: InsulinEvent[] = [
      { iso: new Date(START - 30 * 60_000).toISOString(), units: 6, kind: 'bolus' },
    ];
    const withBolus = computeAutosens({
      glucose: series(72, -0.5, 220),
      carbs: [],
      insulin,
      therapy,
      now: NOW,
    });
    const without = computeAutosens({
      glucose: series(72, -0.5, 220),
      carbs: [],
      insulin: [],
      therapy,
      now: NOW,
    });
    // The fall is now partly explained, so it reads as less sensitive.
    expect(withBolus.ratio).toBeGreaterThan(without.ratio);
  });
});

describe('safety contract', () => {
  const cases = [
    computeAutosens({ glucose: series(200, 0), carbs: [], insulin: [], therapy, now: NOW }),
    computeAutosens({ glucose: series(200, -0.5, 220), carbs: [], insulin: [], therapy, now: NOW }),
    computeAutosens({ glucose: series(200, 0.6, 90), carbs: [], insulin: [], therapy, now: NOW }),
    computeAutosens({ glucose: series(10, 0), carbs: [], insulin: [], therapy, now: NOW }),
  ];

  it('never issues a dose, a rate, or a settings instruction', () => {
    const banned = [
      /take \d/i,
      /\d+\s*(units?|U)\b/i,
      /increase (your )?(basal|bolus|isf|carb ratio)/i,
      /decrease (your )?(basal|bolus|isf|carb ratio)/i,
      /set your/i,
      /change your (basal|isf|carb ratio)/i,
      /u\/hr/i,
      /grams? of (fast|carb)/i,
    ];
    for (const c of cases) {
      for (const re of banned) {
        expect(c.note, `"${c.note}"`).not.toMatch(re);
      }
    }
  });

  it('frames the ratio as context rather than a lever', () => {
    const sensitive = cases[1];
    expect(sensitive.verdict).toBe('sensitive');
    expect(sensitive.note.toLowerCase()).toMatch(/context|worth knowing|loop already/);
  });
});
