import { describe, expect, it } from 'vitest';
import {
  bucketInsulinByHour,
  observedRatio,
  peakHourlyUnits,
} from './insulinLedger';
import type { InsulinEvent } from '@/data/sources/types';

const now = new Date('2026-07-25T14:30:00'); // local Sat afternoon

function at(hour: number, units: number, kind: InsulinEvent['kind'], min = 0): InsulinEvent {
  const d = new Date('2026-07-25T00:00:00');
  d.setHours(hour, min, 0, 0);
  return { iso: d.toISOString(), units, kind };
}

describe('bucketInsulinByHour', () => {
  it('accumulates micro-doses into their hour, basal and bolus apart', () => {
    // Loop's every-5-min temp basals across the 2 AM hour, plus a breakfast bolus.
    const events: InsulinEvent[] = [
      at(2, 0.3, 'basal_temp', 0),
      at(2, 0.25, 'basal_temp', 5),
      at(2, 0.2, 'basal_temp', 10),
      at(8, 3.2, 'bolus', 15),
      at(8, 0.15, 'basal_temp', 20),
    ];
    const hourly = bucketInsulinByHour(events, now);

    expect(hourly).toHaveLength(24);
    expect(hourly[2].basalU).toBeCloseTo(0.75, 2);
    expect(hourly[2].bolusU).toBe(0);
    expect(hourly[8].bolusU).toBeCloseTo(3.2, 2);
    expect(hourly[8].basalU).toBeCloseTo(0.15, 2);
  });

  it('ignores events from other days', () => {
    const yesterday: InsulinEvent = { iso: '2026-07-24T08:00:00', units: 5, kind: 'bolus' };
    const hourly = bucketInsulinByHour([yesterday, at(8, 2, 'bolus')], now);
    expect(hourly[8].bolusU).toBe(2);
  });

  it('skips unparseable timestamps without crashing', () => {
    const bad: InsulinEvent = { iso: 'nope', units: 5, kind: 'bolus' };
    const hourly = bucketInsulinByHour([bad, at(9, 1, 'bolus')], now);
    expect(hourly[9].bolusU).toBe(1);
  });

  it('returns 24 empty buckets for no events', () => {
    const hourly = bucketInsulinByHour([], now);
    expect(hourly).toHaveLength(24);
    expect(hourly.every((h) => h.basalU === 0 && h.bolusU === 0)).toBe(true);
  });
});

describe('observedRatio', () => {
  it('backs out grams per unit of non-basal insulin', () => {
    // 180g carbs, 24U total, 14.82 baseline basal → 9.18U xtra → ~20 g/U.
    const r = observedRatio({
      carbsPerDay: 180,
      totalInsulinPerDay: 24,
      scheduledBasalPerDay: 14.82,
    });
    expect(r.xtraU).toBeCloseTo(9.18, 1);
    expect(r.ratio).toBe(20);
  });

  it('returns a null ratio when the day ran at or below baseline basal', () => {
    const r = observedRatio({
      carbsPerDay: 40,
      totalInsulinPerDay: 14,
      scheduledBasalPerDay: 14.82,
    });
    expect(r.xtraU).toBeLessThan(0);
    expect(r.ratio).toBeNull();
  });

  it('returns a null ratio when there were no carbs to attribute', () => {
    expect(
      observedRatio({ carbsPerDay: 0, totalInsulinPerDay: 24, scheduledBasalPerDay: 14.82 }).ratio,
    ).toBeNull();
  });

  it('treats under ~1U of xtra as noise, not a ratio', () => {
    const r = observedRatio({
      carbsPerDay: 30,
      totalInsulinPerDay: 15.5,
      scheduledBasalPerDay: 14.82,
    });
    expect(r.ratio).toBeNull();
  });
});

describe('peakHourlyUnits', () => {
  it('is the largest hourly basal+bolus total', () => {
    const hourly = bucketInsulinByHour([at(8, 3.2, 'bolus'), at(8, 0.3, 'basal_temp')], now);
    expect(peakHourlyUnits(hourly)).toBeCloseTo(3.5, 2);
  });

  it('has a floor so a quiet day does not magnify tiny doses', () => {
    const hourly = bucketInsulinByHour([at(3, 0.1, 'basal_temp')], now);
    expect(peakHourlyUnits(hourly)).toBe(0.5);
  });
});
