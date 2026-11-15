import { describe, expect, it } from 'vitest';
import {
  activityAt,
  activityFraction,
  iobAt,
  iobFraction,
  modelFromTherapy,
  netInsulinImpulses,
  type InsulinModel,
} from './insulinActivity';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { InsulinEvent } from '@/data/sources/types';

const MODEL: InsulinModel = { durationMinutes: 360, peakMinutes: 75 };

const therapy = {
  basalSchedule: [
    { startMinutes: 0, value: 1 },
    { startMinutes: 12 * 60, value: 2 },
  ],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

describe('exponential insulin curve', () => {
  it('starts with the whole dose on board and ends with none', () => {
    expect(iobFraction(0, MODEL)).toBe(1);
    expect(iobFraction(360, MODEL)).toBe(0);
    expect(iobFraction(500, MODEL)).toBe(0);
  });

  it('decays monotonically', () => {
    let prev = iobFraction(0, MODEL);
    for (let t = 5; t <= 360; t += 5) {
      const next = iobFraction(t, MODEL);
      expect(next).toBeLessThanOrEqual(prev + 1e-9);
      prev = next;
    }
  });

  it('peaks at the configured peak time', () => {
    const atPeak = activityFraction(75, MODEL);
    expect(activityFraction(40, MODEL)).toBeLessThan(atPeak);
    expect(activityFraction(120, MODEL)).toBeLessThan(atPeak);
  });

  it('integrates to the whole dose — this is what makes BGI comparable', () => {
    let sum = 0;
    for (let t = 0; t < 360; t += 0.5) sum += activityFraction(t, MODEL) * 0.5;
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });

  it('has no activity outside the duration', () => {
    expect(activityFraction(0, MODEL)).toBe(0);
    expect(activityFraction(360, MODEL)).toBe(0);
    expect(activityFraction(-10, MODEL)).toBe(0);
  });

  it('keeps the peak inside the curve when duration is short', () => {
    // A 2 h duration with a 75 min peak would put the peak past the midpoint
    // and invert the curve. The model must clamp instead.
    const short = modelFromTherapy({ ...therapy, insulinDurationHours: 2 } as LoopTherapy);
    expect(short.peakMinutes).toBeLessThan(60);
    expect(iobFraction(30, short)).toBeLessThan(1);
    expect(iobFraction(30, short)).toBeGreaterThan(0);
  });
});

describe('netting insulin against the basal schedule', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toISOString();

  it('takes boluses at face value', () => {
    const events: InsulinEvent[] = [{ iso: at(0), units: 3, kind: 'bolus' }];
    const imps = netInsulinImpulses(events, therapy);
    expect(imps).toHaveLength(1);
    expect(imps[0].units).toBe(3);
  });

  it('drops scheduled basal — it is the baseline, not a deviation', () => {
    const events: InsulinEvent[] = [
      { iso: at(0), units: 1, kind: 'basal_scheduled', rateUPerHr: 1, durationMin: 60 },
    ];
    // Rate equals schedule, so every slice nets to zero.
    expect(netInsulinImpulses(events, therapy)).toHaveLength(0);
  });

  it('counts only the difference when a temp basal runs high', () => {
    const local = new Date(2026, 0, 1, 3).toISOString(); // schedule = 1 U/hr
    const events: InsulinEvent[] = [
      { iso: local, units: 2, kind: 'basal_temp', rateUPerHr: 2, durationMin: 60 },
    ];
    const net = netInsulinImpulses(events, therapy).reduce((a, i) => a + i.units, 0);
    expect(net).toBeCloseTo(1, 6); // 2 U/hr for an hour against a 1 U/hr schedule
  });

  it('goes negative when a temp basal runs below schedule', () => {
    // Dropping the sign here would make every low-temp stretch read as an
    // unexplained rise — the single most consequential bug in this file.
    const local = new Date(2026, 0, 1, 3).toISOString();
    const events: InsulinEvent[] = [
      { iso: local, units: 0, kind: 'basal_temp', rateUPerHr: 0, durationMin: 60 },
    ];
    const net = netInsulinImpulses(events, therapy).reduce((a, i) => a + i.units, 0);
    expect(net).toBeCloseTo(-1, 6);
  });

  it('resolves the schedule per slice, so a temp spanning a change nets correctly', () => {
    // 11:00–13:00 local spans the noon step from 1 U/hr to 2 U/hr.
    const local = new Date(2026, 0, 1, 11).toISOString();
    const events: InsulinEvent[] = [
      { iso: local, units: 4, kind: 'basal_temp', rateUPerHr: 2, durationMin: 120 },
    ];
    const net = netInsulinImpulses(events, therapy).reduce((a, i) => a + i.units, 0);
    // Hour one: 2 vs 1 = +1. Hour two: 2 vs 2 = 0.
    expect(net).toBeCloseTo(1, 6);
  });

  it('returns impulses in time order', () => {
    const events: InsulinEvent[] = [
      { iso: at(5), units: 1, kind: 'bolus' },
      { iso: at(1), units: 2, kind: 'bolus' },
    ];
    const imps = netInsulinImpulses(events, therapy);
    expect(imps[0].ms).toBeLessThan(imps[1].ms);
  });

  it('ignores unparseable timestamps rather than emitting NaN impulses', () => {
    const events: InsulinEvent[] = [{ iso: 'not-a-date', units: 3, kind: 'bolus' }];
    expect(netInsulinImpulses(events, therapy)).toHaveLength(0);
  });
});

describe('activity and IOB across a dose history', () => {
  const t0 = Date.UTC(2026, 0, 1, 0);

  it('sums contributions from every dose still acting', () => {
    const imps = [
      { ms: t0, units: 2 },
      { ms: t0 + 60 * 60_000, units: 1 },
    ];
    const iob = iobAt(t0 + 90 * 60_000, imps, MODEL);
    expect(iob).toBeGreaterThan(0);
    expect(iob).toBeLessThan(3);
  });

  it('ignores doses in the future', () => {
    const imps = [{ ms: t0 + 60 * 60_000, units: 5 }];
    expect(iobAt(t0, imps, MODEL)).toBe(0);
    expect(activityAt(t0, imps, MODEL)).toBe(0);
  });

  it('clears once every dose is past its duration', () => {
    const imps = [{ ms: t0, units: 4 }];
    expect(iobAt(t0 + 7 * 3600_000, imps, MODEL)).toBe(0);
    expect(activityAt(t0 + 7 * 3600_000, imps, MODEL)).toBe(0);
  });

  it('carries negative IOB after a sustained low temp basal', () => {
    const imps = [{ ms: t0, units: -0.5 }];
    expect(iobAt(t0 + 30 * 60_000, imps, MODEL)).toBeLessThan(0);
  });
});
