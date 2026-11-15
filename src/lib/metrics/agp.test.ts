import { describe, expect, it } from 'vitest';
import type { GlucoseReading } from '@/data/sources/types';
import { computeAgp, computeAgpProfiles, percentile } from './agp';

const MIN = 60_000;
const START = new Date(2026, 9, 1, 0, 0, 0).getTime();

/** `days` of 5-minute readings from START; value from (day, minuteOfDay). */
function cgm(days: number, value: (day: number, minute: number) => number | null): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  for (let d = 0; d < days; d++) {
    for (let m = 0; m < 24 * 60; m += 5) {
      const v = value(d, m);
      if (v != null) out.push({ iso: new Date(START + (d * 24 * 60 + m) * MIN).toISOString(), mgdl: v });
    }
  }
  return out;
}

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20], 50)).toBe(15);
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50);
  });
});

describe('computeAgp', () => {
  const now = new Date(START + 14 * 24 * 60 * MIN);

  it('gives 48 half-hour bins with ordered percentiles', () => {
    // Day d sits at 100 + 10·d all day: the spread across days is the spread.
    const agp = computeAgp({ glucose: cgm(14, (d) => 100 + 10 * d), now, windowDays: 14 });
    expect(agp.bins).toHaveLength(48);
    expect(agp.bins[0].minute).toBe(15);
    const b = agp.bins[20];
    expect(b.p5! <= b.p25! && b.p25! <= b.p50! && b.p50! <= b.p75! && b.p75! <= b.p95!).toBe(true);
    expect(b.p50).toBe(165);
    expect(agp.daysCovered).toBe(14);
  });

  it('follows the time-of-day shape', () => {
    const agp = computeAgp({ glucose: cgm(14, (_d, m) => (m >= 18 * 60 && m < 21 * 60 ? 220 : 110)), now, windowDays: 14 });
    const at = (h: number) => agp.bins.find((x) => x.minute === h * 60 + 15)!.p50;
    expect(at(19)).toBe(220);
    expect(at(3)).toBe(110);
  });

  it('wear counts occupied 5-minute slots, not readings', () => {
    // Half of every day missing.
    const half = computeAgp({ glucose: cgm(14, (_d, m) => (m < 12 * 60 ? 120 : null)), now, windowDays: 14 });
    expect(half.wearPct).toBeCloseTo(50, 0);
    // A duplicate writer does not push wear past the slots it fills.
    const full = cgm(14, () => 120);
    const doubled = computeAgp({ glucose: [...full, ...full], now, windowDays: 14 });
    expect(doubled.wearPct).toBeCloseTo(100, 0);
  });

  it('leaves thin bins empty instead of drawing from a handful', () => {
    // One day, readings only around midnight: the 00:15 bin (which wraps back
    // to 23:45) has 12; the 05:15 bin has none.
    const agp = computeAgp({ glucose: cgm(1, (_d, m) => (m < 60 || m >= 23 * 60 ? 120 : null)), now, windowDays: 14 });
    expect(agp.bins[0].p50).toBe(120);
    expect(agp.bins[10].p50).toBeNull();
  });

  it('computes every report period', () => {
    expect(Object.keys(computeAgpProfiles({ glucose: [], now }))).toEqual(['14d', '30d', '90d']);
  });
});
