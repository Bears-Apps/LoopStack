import { describe, expect, it } from 'vitest';
import { dur, mealResponses, curveBands, lowDepth, depthOf } from './meals';

const MIN = 60_000;
const T0 = new Date(2026, 10, 10, 12, 0).getTime();
// Glucose 110, rising 1 mg/dL a minute to 170 at +60, back down 0.5 a minute to 110 at +180.
const g = (m: number) => (m < 0 ? 110 : m <= 60 ? 110 + m : m <= 180 ? 170 - (m - 60) * 0.5 : 110);

describe('meal response', () => {
  const glucose = Array.from({ length: 100 }, (_, i) => ({ at: T0 - 60 * MIN + i * 5 * MIN, mgdl: g(i * 5 - 60) }));
  const meals = mealResponses({
    carbs: [{ at: T0, grams: 60, absorptionMin: 240, name: '🌯 Burrito bowl' }],
    boluses: [{ at: T0 + 2 * MIN, units: 6 }],
    glucose,
    iob: [{ at: T0, u: 0.4 }, { at: T0 + 30 * MIN, u: 5.8 }],
  }, T0 - 24 * 60 * MIN, T0 + 24 * 60 * MIN);

  it('reads the rise, the peak and when glucose came back', () => {
    const m = meals.recent[0];
    expect(m.startMgdl).toBe(110);
    expect(m.peakMgdl).toBe(170);
    expect(m.peakAfterMin).toBe(60);
    expect(m.riseMgdl).toBe(60);
    expect(m.observedMin).toBe(140); // back within 20 of the start: 130 at +140
    expect(m.enteredMin).toBe(240);
    expect(m.bolusU).toBe(6);
    expect(m.iobAtEntryU).toBe(0.4);
    expect(m.iobPeakU).toBe(5.8);
  });

  it('calls the outcome over the observed window', () => {
    const m = meals.recent[0];
    expect(m.lowMgdl).toBe(110);
    expect(m.highMgdl).toBe(170);
    expect(m.outcome).toBe('in');
    expect(meals.groups[0].outcomes).toEqual({ in: 1, high: 0, low: 0 });
  });

  it('a low anywhere in the window outranks a high', async () => {
    const { outcomeOf } = await import('./meals');
    expect(outcomeOf(64, 220)).toBe('low');
    expect(outcomeOf(90, 181)).toBe('high');
    expect(outcomeOf(70, 180)).toBe('in');
  });

  it('groups repeats by name', () => {
    expect(meals.groups).toEqual([expect.objectContaining({ name: '🌯 Burrito bowl', n: 1, medianRiseMgdl: 60, medianObservedMin: 140 })]);
  });

  it('formats durations', () => {
    expect(dur(45)).toBe('45m');
    expect(dur(150)).toBe('2h 30m');
    expect(dur(240)).toBe('4h');
    expect(dur(null)).toBe('—');
  });
});

describe('a food’s median curve', () => {
  const c = (...gs: number[]) => ({ curve: gs.map((g, i) => [i * 10, g] as const) });
  it('takes the median and middle half at each minute', () => {
    const b = curveBands([c(100, 140), c(110, 160), c(120, 180), c(130, 200)]);
    expect(b[0]).toEqual({ t: 0, p25: 108, p50: 115, p75: 123, n: 4 });
    expect(b[1].p50).toBe(170);
  });
  it('stops where too few meals are still reading', () => {
    const b = curveBands([c(100, 140, 150), c(110, 160)], 2);
    expect(b.map((x) => x.t)).toEqual([0, 10]);
  });
});

describe('how low a food went', () => {
  const c = (...gs: number[]) => ({ curve: gs.map((g, i) => [i * 10, g] as const) });
  it('bands by depth: 70 and 60 and 55 edges', () => {
    expect(['none', 'watch', 'watch', 'low', 'low', 'severe'].join()).toBe([70, 69, 60, 59, 55, 54].map(depthOf).join());
  });
  it('reads the deepest any time reached, and how many times reached it', () => {
    expect(lowDepth([c(120, 140, 130)])).toMatchObject({ level: 'none', of: 1 });
    expect(lowDepth([c(120, 66), c(110, 62), c(100, 130)])).toMatchObject({ level: 'watch', lowest: 62, times: 2, of: 3 });
    expect(lowDepth([c(120, 66), c(110, 57), c(90, 52)])).toMatchObject({ level: 'severe', lowest: 52, times: 1, of: 3 });
  });
});
