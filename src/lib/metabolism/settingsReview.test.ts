import { describe, expect, it } from 'vitest';
import { computeSettingsReview, type SettingId } from './settingsReview';
import { computeAutotune } from './autotune';
import { computeAbsorptionInsights } from './absorptionProfile';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';

const therapy = {
  glucoseSafetyLimitMgdl: 85,
  correctionRange: [{ startMinutes: 0, low: 105, high: 115 }],
  preMealRange: { low: 80, high: 100 },
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  maxBasalRate: 3,
  maxBolus: 10,
  insulinDurationHours: 6,
  capturedIso: '2026-06-01T00:00:00.000Z',
} as unknown as LoopTherapy;

const NOW = new Date(2026, 6, 15, 12, 0, 0);
const DAY_MS = 24 * 3600_000;

const ALL_IDS: SettingId[] = [
  'safetyLimit',
  'correctionRange',
  'preMealRange',
  'basalRates',
  'maxBasal',
  'maxBolus',
  'insulinSensitivity',
  'carbRatio',
  'insulinDuration',
  'absorptionPresets',
];

/** Flat CGM at `mgdl` for `days`, five-minute cadence. */
function flatGlucose(days: number, mgdl = 110): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  const start = NOW.getTime() - days * DAY_MS;
  for (let i = 0; i < days * 288; i += 1) {
    out.push({ iso: new Date(start + i * 5 * 60_000).toISOString(), mgdl });
  }
  return out;
}

function review(over: Partial<Parameters<typeof computeSettingsReview>[0]> = {}) {
  const glucose = over.glucose ?? flatGlucose(14);
  const carbs = over.carbs ?? [];
  const insulin = over.insulin ?? [];
  const autotune =
    over.autotune ??
    computeAutotune({ glucose, carbs, insulin, therapy, windowDays: 21, now: NOW });
  const absorption =
    over.absorption ??
    computeAbsorptionInsights({ glucose, carbs, insulin, therapy, windowDays: 21, now: NOW });
  return computeSettingsReview({
    therapy,
    autotune,
    absorption,
    glucose,
    carbs,
    insulin,
    windowDays: 21,
    now: NOW,
    ...over,
  });
}

describe('the roster', () => {
  it('gives every Loop setting a row, even with zero data', () => {
    const r = review({ glucose: [], carbs: [], insulin: [] });
    expect(r.items.map((i) => i.id)).toEqual(ALL_IDS);
    for (const item of r.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.current.length).toBeGreaterThan(0);
      expect(item.note.length).toBeGreaterThan(0);
      expect(item.confidence).toBe('unusable');
      expect(item.reading).toBeNull();
    }
  });

  it('keeps the roster complete when data is rich', () => {
    const r = review();
    expect(r.items.map((i) => i.id)).toEqual(ALL_IDS);
  });
});

describe('glucose safety limit', () => {
  it('reports a clean window as never crossing the limit', () => {
    const item = review().items.find((i) => i.id === 'safetyLimit')!;
    expect(item.confidence).toBe('good');
    expect(item.reading).toContain('0%');
    expect(item.note).toContain('never crossed');
  });

  it('counts distinct dips and total time under', () => {
    const glucose = flatGlucose(14);
    // Two separate 30-min dips under 85 on different days.
    for (let d = 0; d < 2; d += 1) {
      const dipStart = 2 * DAY_MS + d * DAY_MS + 3 * 3600_000;
      const startIdx = Math.round(dipStart / (5 * 60_000));
      for (let k = 0; k < 6; k += 1) {
        glucose[startIdx + k] = { ...glucose[startIdx + k], mgdl: 72 };
      }
    }
    const item = review({ glucose }).items.find((i) => i.id === 'safetyLimit')!;
    expect(item.note).toContain('2 stretches');
    expect(item.note).toContain('1h');
  });
});

describe('correction range', () => {
  it('reads the overnight settle point against the range middle', () => {
    // Settles at 140 vs range mid 110 → a 30-point gap, called out.
    const item = review({ glucose: flatGlucose(14, 140) }).items.find(
      (i) => i.id === 'correctionRange',
    )!;
    expect(item.confidence).toBe('good');
    expect(item.reading).toContain('140');
    expect(item.note).toContain('above');
    expect(item.note.toLowerCase()).toContain('basal');
  });

  it('calls agreement when the settle sits inside the range', () => {
    const item = review({ glucose: flatGlucose(14, 112) }).items.find(
      (i) => i.id === 'correctionRange',
    )!;
    expect(item.note).toContain('agree');
  });

  it('refuses to read from too few nights', () => {
    const item = review({ glucose: flatGlucose(2) }).items.find(
      (i) => i.id === 'correctionRange',
    )!;
    expect(item.confidence).toBe('unusable');
  });
});

describe('pre-meal range', () => {
  it('reads the median glucose at the first bite', () => {
    const glucose = flatGlucose(14, 120);
    // Two meals a day across nine days — comfortably past the 15-meal floor
    // while staying inside the 14 days of glucose.
    const carbs: CarbEntry[] = Array.from({ length: 18 }, (_, i) => ({
      iso: new Date(
        NOW.getTime() - (Math.floor(i / 2) + 1) * DAY_MS + (i % 2 === 0 ? 8 : 18) * 3600_000,
      ).toISOString(),
      grams: 50,
      absorptionHours: 3,
    }));
    const item = review({ glucose, carbs }).items.find((i) => i.id === 'preMealRange')!;
    expect(item.confidence).toBe('good');
    expect(item.reading).toContain('120');
    expect(item.note).toContain('0% started inside');
  });

  it('needs enough meals with a reading at the start', () => {
    const item = review({ carbs: [] }).items.find((i) => i.id === 'preMealRange')!;
    expect(item.confidence).toBe('unusable');
  });
});

describe('delivery limits', () => {
  const temp = (daysAgo: number, rate: number): InsulinEvent => ({
    iso: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
    units: +(rate / 2).toFixed(2),
    kind: 'basal_temp',
    rateUPerHr: rate,
    durationMin: 30,
  });

  it('reads headroom when Loop never presses the basal cap', () => {
    const insulin = Array.from({ length: 40 }, (_, i) => temp(1 + (i % 10), 1.4));
    const item = review({ insulin }).items.find((i) => i.id === 'maxBasal')!;
    expect(item.confidence).toBe('good');
    expect(item.reading).toContain('1.4');
    expect(item.note).toContain('not constraining');
  });

  it('flags a basal cap that binds', () => {
    const insulin = Array.from({ length: 40 }, (_, i) =>
      temp(1 + (i % 10), i % 3 === 0 ? 3 : 1.2),
    );
    const item = review({ insulin }).items.find((i) => i.id === 'maxBasal')!;
    expect(item.note).toContain('cap');
    expect(item.note).toContain('care team');
  });

  it('says why it cannot read max basal without temp records', () => {
    const item = review({ insulin: [] }).items.find((i) => i.id === 'maxBasal')!;
    expect(item.confidence).toBe('unusable');
    expect(item.note).toContain('Nightscout');
  });

  it('reads bolus headroom and cap-pinning', () => {
    const bolus = (daysAgo: number, units: number): InsulinEvent => ({
      iso: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
      units,
      kind: 'bolus',
    });
    const comfortable = review({
      insulin: Array.from({ length: 20 }, (_, i) => bolus(1 + (i % 10), 4)),
    }).items.find((i) => i.id === 'maxBolus')!;
    expect(comfortable.note).toContain('headroom');

    const pinned = review({
      insulin: Array.from({ length: 20 }, (_, i) => bolus(1 + (i % 10), i % 2 ? 9.8 : 5)),
    }).items.find((i) => i.id === 'maxBolus')!;
    expect(pinned.note).toContain('ceiling');
  });
});

describe('insulin duration', () => {
  it('is unusable without Loop IOB to compare against', () => {
    const item = review().items.find((i) => i.id === 'insulinDuration')!;
    expect(item.confidence).toBe('unusable');
    expect(item.note).toContain('devicestatus');
  });

  it('reads agreement when the reconstruction tracks Loop', () => {
    const autotune = computeAutotune({
      glucose: flatGlucose(14),
      carbs: [],
      insulin: [],
      therapy,
      windowDays: 21,
      now: NOW,
    });
    const withAgreement = {
      ...autotune,
      iobAgreement: {
        sampleCount: 400,
        meanAbsDiffU: 0.12,
        agreementPct: 93,
        biasU: 0.05,
        trustworthy: true,
        note: 'x',
      },
    };
    const item = review({ autotune: withAgreement }).items.find(
      (i) => i.id === 'insulinDuration',
    )!;
    expect(item.confidence).toBe('good');
    expect(item.note).toContain('fits');
  });

  it('flags a duration that outlasts Loop, and refuses when records are missing', () => {
    const base = computeAutotune({
      glucose: flatGlucose(14),
      carbs: [],
      insulin: [],
      therapy,
      windowDays: 21,
      now: NOW,
    });
    const runsLong = review({
      autotune: {
        ...base,
        iobAgreement: {
          sampleCount: 400,
          meanAbsDiffU: 0.6,
          agreementPct: 71,
          biasU: 0.55,
          trustworthy: true,
          note: 'x',
        },
      },
    }).items.find((i) => i.id === 'insulinDuration')!;
    expect(runsLong.confidence).toBe('limited');
    expect(runsLong.note).toContain('longer');

    const missing = review({
      autotune: {
        ...base,
        iobAgreement: {
          sampleCount: 400,
          meanAbsDiffU: 1.2,
          agreementPct: 40,
          biasU: -1.1,
          trustworthy: false,
          note: 'x',
        },
      },
    }).items.find((i) => i.id === 'insulinDuration')!;
    expect(missing.confidence).toBe('unusable');
    expect(missing.note).toContain('incomplete');
  });
});

describe('safety contract', () => {
  it('never instructs a settings change or a dose, across data-rich and empty runs', () => {
    const banned = [
      /take \d/i,
      /\byou should\b/i,
      /\bmust\b/i,
      /\brecommend\b/i,
      /\d+(\.\d+)?\s*units? (of|for|now|before)/i,
      /\b(raise|lower|increase|decrease|set|change) (your |the )?(cap|limit|basal|bolus|isf|sensitivity|carb ratio|duration|range)\b/i,
    ];
    for (const r of [review(), review({ glucose: [], carbs: [], insulin: [] })]) {
      for (const item of r.items) {
        for (const re of banned) {
          expect(item.note, `${item.id}: "${item.note}"`).not.toMatch(re);
        }
      }
    }
  });

  it('frames anything that stands out as a care-team review point', () => {
    const glucose = flatGlucose(14, 140);
    const r = review({ glucose });
    const range = r.items.find((i) => i.id === 'correctionRange')!;
    expect(range.note).toMatch(/worth (reading|reviewing)/);
  });
});
