import { describe, expect, it } from 'vitest';
import { balance, findPatterns, hourRows, type PatternInputs } from './patterns';
import { SYNTHETIC } from './synthetic';
import { morningValue } from './derive';

const S = SYNTHETIC;
const inputs: PatternInputs = {
  days: S.DAYS,
  sched: S.SCHED,
  state: S.STATE,
  rate: (d, h) => morningValue(S.DAYS.indexOf(d), h),
  hourlyGlucose: S.HOURLY_G,
  weekdayOf: (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d.split(' ')[0]),
  workoutDays: S.RUN_DAYS,
  workoutHour: S.RUN_TIME?.start ?? null,
};

describe('What Loop did, as patterns', () => {
  const p = findPatterns(inputs);
  it('leads with the morning: temp basals below schedule 6–8am', () => {
    expect(p[0]).toMatchObject({ kind: 'below', start: 6, end: 8, established: true, of: 14 });
    expect(p[0].seen).toBeGreaterThanOrEqual(11);
    expect(p[0].netUph).toBeLessThan(-0.3);
    expect(p[0].netRange[0]).toBeLessThanOrEqual(p[0].netUph);
  });
  it('counts a day that lost only the night for the morning and evening stretches', () => {
    expect(p[0].days.find((d) => d.day === 'Sun 8')!.status).not.toBe('nodata');
  });
  it('finds the evening above schedule, rated over the days that showed it', () => {
    const m = p.find((x) => x.kind === 'above')!;
    expect(m).toMatchObject({ start: 19, end: 21, seen: 7, of: 14, established: true });
    expect(m.netUph).toBeGreaterThan(0.12);
  });
  it('holds back the Friday 0 U/hr stretch as not enough yet, with its workouts noted', () => {
    const z = p.find((x) => x.kind === 'zero')!;
    expect(z).toMatchObject({ start: 15, weekday: 5, seen: 2, of: 2, established: false, workouts: 2 });
    expect(p.indexOf(z)).toBe(p.length - 1);
  });
  it('builds the expanded window two hours either side', () => {
    expect(p[0].window.map((w) => w.hour)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(p[0].window.every((w) => w.glucose != null)).toBe(true);
  });
  it('balances below and above against the schedule, beyond tolerance only', () => {
    const b = balance(inputs);
    expect(b.days).toBe(14);
    expect(b.below).toBeGreaterThan(b.above);
    expect(b.net).toBeCloseTo(b.delivered - b.scheduled, 0);
  });
  it('gives every hour for the full table', () => {
    const rows = hourRows(inputs);
    expect(rows).toHaveLength(24);
    expect(rows[0].nodata).toBe(1);
    expect(rows[6].below).toBeGreaterThanOrEqual(11);
  });
});
