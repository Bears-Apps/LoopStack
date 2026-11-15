import { describe, expect, it } from 'vitest';
import { computeDayHourGrid } from '@/lib/metrics/dayHourGrid';
import type { RiskWindow } from './riskWindows';
import { buildHeadsUps, findTrendStretches, HEADS_UP_MIN_PCT } from './trendHeadsUp';

// A Wednesday at noon.
const NOW = new Date(2026, 7, 12, 12, 0, 0);
const TARGET = { lowMgdl: 70, highMgdl: 180, urgentLowMgdl: 54 };

/**
 * Six weeks of full-day CGM at 120, with `share` of the readings in the given
 * weekday-hours replaced by `mgdl`.
 */
function grid(spots: { weekday: number; hours: number[]; mgdl: number; share: number }[]) {
  const glucose: { iso: string; mgdl: number }[] = [];
  const day = new Date(NOW);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 42);
  for (; day < NOW; day.setDate(day.getDate() + 1)) {
    for (let h = 0; h < 24; h += 1) {
      const spot = spots.find((s) => s.weekday === day.getDay() && s.hours.includes(h));
      for (let k = 0; k < 12; k += 1) {
        const t = new Date(day);
        t.setHours(h, k * 5, 0, 0);
        if (t >= NOW) continue;
        const out = spot && k < Math.round(spot.share * 12);
        glucose.push({ iso: t.toISOString(), mgdl: out ? spot!.mgdl : 120 });
      }
    }
  }
  return computeDayHourGrid({ glucose, target: TARGET, now: NOW });
}

describe('findTrendStretches', () => {
  it(`counts an hour at ${HEADS_UP_MIN_PCT}% of readings out of range, lows and highs alike`, () => {
    // 2 of 12 readings = 17%: over the bar. 1 of 12 = 8%: under it.
    const g = grid([
      { weekday: 2, hours: [15, 16], mgdl: 60, share: 2 / 12 },
      { weekday: 2, hours: [9], mgdl: 220, share: 2 / 12 },
      { weekday: 2, hours: [20], mgdl: 220, share: 1 / 12 },
    ]);
    const s = findTrendStretches(g, 2);
    expect(s.map((x) => [x.kind, x.startHour, x.endHour])).toEqual([
      ['low', 15, 16],
      ['high', 9, 9],
    ]);
    expect(s[0].sharePct).toBeGreaterThanOrEqual(HEADS_UP_MIN_PCT);
    expect(s[0].weeks).toBeGreaterThanOrEqual(3);
  });

  it('stays quiet on a weekday with nothing over the bar', () => {
    expect(findTrendStretches(grid([]), 3)).toEqual([]);
  });
});

describe('buildHeadsUps', () => {
  it('fires two hours before the stretch, on its weekday, weekly', () => {
    const h = buildHeadsUps({ grid: grid([{ weekday: 2, hours: [15, 16], mgdl: 60, share: 0.5 }]) });
    expect(h).toHaveLength(1);
    expect(h[0].fireOn).toEqual({ weekday: 2, hour: 13, minute: 0 });
    expect(h[0].title).toBe('Tuesdays 3pm–5pm often runs low');
    expect(h[0].body).toContain('under 70 mg/dL');
  });

  it('announces an early-morning stretch the evening before', () => {
    const h = buildHeadsUps({ grid: grid([{ weekday: 0, hours: [1], mgdl: 60, share: 0.5 }]) });
    expect(h[0].fireOn).toEqual({ weekday: 6, hour: 23, minute: 0 });
  });

  it('caps each weekday at three, lows first', () => {
    const h = buildHeadsUps({
      grid: grid([
        { weekday: 4, hours: [7], mgdl: 220, share: 0.9 },
        { weekday: 4, hours: [11], mgdl: 220, share: 0.8 },
        { weekday: 4, hours: [15], mgdl: 220, share: 0.7 },
        { weekday: 4, hours: [19], mgdl: 60, share: 0.2 },
      ]),
    });
    expect(h).toHaveLength(3);
    expect(h[0].kind).toBe('low');
    expect(h.map((x) => x.startHour)).toEqual([19, 7, 11]);
  });

  it('leaves a stretch to the recurring-window alert that already covers it', () => {
    const g = grid([{ weekday: 5, hours: [15], mgdl: 60, share: 0.5 }]);
    const w: RiskWindow = {
      id: 'low_5_15_16', kind: 'low', weekday: 5, startHour: 15, endHour: 16, occurrences: 5,
      weeksObserved: 6, recurrencePct: 83, extremeMgdl: 52, confidence: 'good', label: 'Fridays around 3pm',
    };
    expect(buildHeadsUps({ grid: g, alreadyAlerted: [w] })).toHaveLength(0);
    expect(buildHeadsUps({ grid: g, alreadyAlerted: [{ ...w, kind: 'high' }] })).toHaveLength(1);
  });
});
