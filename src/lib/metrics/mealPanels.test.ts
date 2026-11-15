import { describe, expect, it } from 'vitest';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import { computeMealPanels } from './mealPanels';

const MIN = 60_000;
const START = new Date(2026, 9, 1, 0, 0, 0).getTime();
const at = (day: number, h: number, m = 0) => START + (day * 24 * 60 + h * 60 + m) * MIN;
const iso = (t: number) => new Date(t).toISOString();

/** 10 days of CGM: flat 110, rising 80 mg/dL over the first hour after each dinner, back by 4h. */
function setup(opts: { dinnerDays: number[]; leadMin: number }) {
  const glucose: GlucoseReading[] = [];
  const carbs: CarbEntry[] = [];
  const insulin: InsulinEvent[] = [];
  const dinners = opts.dinnerDays.map((d) => at(d, 18, 30));
  for (let t = START; t < at(10, 0); t += 5 * MIN) {
    let v = 110;
    for (const m of dinners) {
      const since = (t - m) / MIN;
      if (since > 0 && since <= 60) v += (80 * since) / 60;
      else if (since > 60 && since <= 180) v += 80 - (80 * (since - 60)) / 120;
    }
    glucose.push({ iso: iso(t), mgdl: Math.round(v) });
  }
  for (const m of dinners) {
    carbs.push({ iso: iso(m), grams: 60, absorptionHours: 3 });
    insulin.push({ iso: iso(m - opts.leadMin * MIN), units: 4, kind: 'bolus' });
  }
  // A 5 g snack at lunch is not a meal.
  carbs.push({ iso: iso(at(2, 12)), grams: 5, absorptionHours: 2 });
  return { glucose, carbs, insulin, now: new Date(at(10, 0)) };
}

describe('computeMealPanels', () => {
  it('reads pre-meal, 2-hour change, 3–4 h value and lead time per window', () => {
    const p = computeMealPanels({ ...setup({ dinnerDays: [0, 1, 2, 3, 4], leadMin: 15 }), windowDays: 10 });
    const dinner = p.panels.find((x) => x.id === 'dinner')!;
    expect(dinner.meals).toBe(5);
    expect(dinner.medianPreMgdl).toBe(110);
    // At 2 h the rise has come halfway back: +40.
    expect(dinner.medianRise2hMgdl).toBe(40);
    expect(dinner.riseUnderGoalPct).toBe(100);
    expect(dinner.median3to4hMgdl).toBe(110);
    expect(dinner.medianLeadMin).toBe(15);
    expect(dinner.medianCarbsG).toBe(60);
    // 5 of 10 days with data have a dinner entry.
    expect(dinner.loggedDaysPct).toBe(50);
    expect(p.daysWithData).toBe(10);
  });

  it('ignores snacks under 10 g and windows without entries', () => {
    const p = computeMealPanels({ ...setup({ dinnerDays: [0], leadMin: 0 }), windowDays: 10 });
    const lunch = p.panels.find((x) => x.id === 'lunch')!;
    expect(lunch.meals).toBe(0);
    expect(lunch.medianRise2hMgdl).toBeNull();
    expect(lunch.loggedDaysPct).toBe(0);
  });

  it('reports a bolus after the entry as negative lead time', () => {
    const p = computeMealPanels({ ...setup({ dinnerDays: [0, 1, 2], leadMin: -10 }), windowDays: 10 });
    expect(p.panels.find((x) => x.id === 'dinner')!.medianLeadMin).toBe(-10);
  });

  it('counts the first meal of the window only, once per day', () => {
    const s = setup({ dinnerDays: [0, 1], leadMin: 0 });
    s.carbs.push({ iso: iso(at(0, 20)), grams: 30, absorptionHours: 2 });
    const dinner = computeMealPanels({ ...s, windowDays: 10 }).panels.find((x) => x.id === 'dinner')!;
    expect(dinner.meals).toBe(2);
  });
});
