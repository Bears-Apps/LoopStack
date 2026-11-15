import { describe, expect, it } from 'vitest';
import type { GlucoseReading } from '@/data/sources/types';
import { computeHypoReport, computeHypoReports, detectHypoEvents, median } from './hypoEvents';

const MIN = 60_000;
// A Monday, local time.
const DAY0 = new Date(2026, 9, 5, 0, 0, 0).getTime();

/** 5-minute readings from `startMs`, one value per entry. */
function series(startMs: number, values: number[]): { t: number; mgdl: number }[] {
  return values.map((mgdl, i) => ({ t: startMs + i * 5 * MIN, mgdl }));
}
const asReadings = (s: { t: number; mgdl: number }[]): GlucoseReading[] => s.map((r) => ({ iso: new Date(r.t).toISOString(), mgdl: r.mgdl }));
const at = (h: number, m = 0, day = 0) => DAY0 + day * 24 * 60 * MIN + (h * 60 + m) * MIN;

describe('detectHypoEvents', () => {
  it('needs 15 consecutive minutes below to count', () => {
    // Two readings below = 10 minutes: not an event.
    expect(detectHypoEvents(series(at(14), [90, 65, 64, 90, 90, 90, 90]), 70)).toHaveLength(0);
    // Three readings below = 15 minutes: an event.
    const e = detectHypoEvents(series(at(14), [90, 65, 64, 63, 90, 90, 90, 90]), 70);
    expect(e).toHaveLength(1);
    expect(e[0].durationMin).toBe(15);
    expect(e[0].nadirMgdl).toBe(63);
    expect(e[0].overnight).toBe(false);
  });

  it('a bounce above for under 15 minutes does not split one low into two', () => {
    const e = detectHypoEvents(series(at(14), [65, 64, 63, 72, 74, 66, 65, 64, 90, 90, 90, 90]), 70);
    expect(e).toHaveLength(1);
    expect(e[0].durationMin).toBe(40);
  });

  it('15 minutes back above ends the event; the next low is a new one', () => {
    const e = detectHypoEvents(series(at(14), [65, 64, 63, 90, 90, 90, 65, 64, 63, 90, 90, 90]), 70);
    expect(e).toHaveLength(2);
  });

  it('classes events by the hour they start: 00–06 is overnight', () => {
    const e = detectHypoEvents(series(at(5, 50), [65, 64, 63, 62, 61, 90, 90, 90]), 70);
    expect(e[0].overnight).toBe(true);
  });

  it('closes an open event at a data gap instead of bridging it', () => {
    const s = [...series(at(14), [65, 64, 63]), ...series(at(16), [65, 64, 63, 90, 90, 90])];
    expect(detectHypoEvents(s, 70)).toHaveLength(2);
  });
});

describe('computeHypoReport', () => {
  it('splits day and overnight, rates per week of data held, and reads overnight TBR', () => {
    // Two days of flat 120 with one night low and one afternoon low.
    const day = (d: number) => Array.from({ length: 288 }, (_, i) => ({ t: at(0, 0, d) + i * 5 * MIN, mgdl: 120 }));
    const s = [...day(0), ...day(1)];
    for (const r of s) {
      const h = new Date(r.t).getHours() + new Date(r.t).getMinutes() / 60;
      if (r.t < at(0, 0, 1) && h >= 3 && h < 3.5) r.mgdl = 60; // night, 30 min under 65, also under urgent 62
      if (r.t >= at(0, 0, 1) && h >= 15 && h < 15.25) r.mgdl = 64; // day, 15 min under 65 only
    }
    const now = new Date(at(0, 0, 2));
    const rep = computeHypoReport({ glucose: asReadings(s), target: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 62 }, now, windowDays: 14 });
    expect(rep.daysCovered).toBe(2);
    expect(rep.low.all.count).toBe(2);
    expect(rep.low.overnight.count).toBe(1);
    expect(rep.low.day.count).toBe(1);
    expect(rep.low.all.perWeek).toBeCloseTo(7, 5);
    expect(rep.low.overnight.medianDurationMin).toBe(30);
    expect(rep.urgentLow.all.count).toBe(1);
    expect(rep.urgentLow.thresholdMgdl).toBe(62);
    // 6 of 144 overnight readings below 65.
    expect(rep.overnight.readings).toBe(144);
    expect(rep.overnight.lowPct).toBeCloseTo((6 / 144) * 100, 5);
  });

  it('reports no events, not invented ones, with no data', () => {
    const rep = computeHypoReport({ glucose: [], target: { lowMgdl: 70, highMgdl: 180 }, now: new Date(at(0)), windowDays: 14 });
    expect(rep.low.all).toEqual({ count: 0, perWeek: 0, medianDurationMin: null, lowestMgdl: null });
    expect(rep.overnight.readings).toBe(0);
  });

  it('computes every report period', () => {
    const all = computeHypoReports({ glucose: [], target: { lowMgdl: 70, highMgdl: 180 }, now: new Date(at(0)) });
    expect(Object.keys(all)).toEqual(['14d', '30d', '90d']);
    expect(all['90d'].windowDays).toBe(90);
  });

  it('median handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('day coverage on a rolling window', () => {
  it('never reports more days than the window holds', () => {
    // 30 days ending 2pm touch 31 calendar dates; every 5 minutes has a reading.
    const now = new Date(2026, 9, 30, 14, 0, 0);
    const glucose = Array.from({ length: 30 * 288 }, (_, i) => ({ iso: new Date(now.getTime() - i * 5 * 60_000).toISOString(), mgdl: 110 }));
    const r = computeHypoReport({ glucose, target: { lowMgdl: 70, highMgdl: 180, urgentLowMgdl: 54 }, now, windowDays: 30 });
    expect(r.daysCovered).toBe(30);
  });
});
