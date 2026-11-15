import { describe, expect, it } from 'vitest';
import type { InsulinEvent } from '@/data/sources/types';
import { computeTempBasalUse } from './tempBasalUse';

const MIN = 60_000;
const START = new Date(2026, 9, 1, 0, 0, 0).getTime();
const temp = (t: number, rate: number, durationMin = 30): InsulinEvent => ({
  iso: new Date(t).toISOString(),
  units: (rate * durationMin) / 60,
  kind: 'basal_temp',
  rateUPerHr: rate,
  durationMin,
});

describe('computeTempBasalUse', () => {
  const now = new Date(START + 2 * 24 * 60 * MIN);

  it('ends each temp at the next one and merges back-to-back zero temps', () => {
    const insulin: InsulinEvent[] = [];
    // Day 0: six 5-minute zero temps in a row (one 30-minute suspension), then
    // an hour at max (two 30-minute temps), then normal.
    for (let i = 0; i < 6; i++) insulin.push(temp(START + (60 + i * 5) * MIN, 0));
    insulin.push(temp(START + 90 * MIN, 3.0), temp(START + 120 * MIN, 3.0), temp(START + 150 * MIN, 0.8));
    // Day 1: one separate zero temp.
    insulin.push(temp(START + (24 * 60 + 300) * MIN, 0, 20));
    const u = computeTempBasalUse({ insulin, maxBasalRate: 3.0, now, windowDays: 2 })!;
    expect(u.daysWithTemps).toBe(2);
    expect(u.zeroEpisodesPerDay).toBe(1);
    expect(u.zeroMinutesPerDay).toBe(25);
    expect(u.atMaxMinutesPerDay).toBe(30);
    expect(u.atMaxPct).toBeCloseTo((60 / (2 * 1440)) * 100, 5);
  });

  it('returns null without temp basals rather than reporting zeros', () => {
    const bolus: InsulinEvent = { iso: new Date(START).toISOString(), units: 2, kind: 'bolus' };
    expect(computeTempBasalUse({ insulin: [bolus], maxBasalRate: 3, now, windowDays: 2 })).toBeNull();
  });
});
