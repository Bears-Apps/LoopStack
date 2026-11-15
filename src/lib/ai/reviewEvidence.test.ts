import { describe, expect, it } from 'vitest';
import { emptyResult, freshResult, type DataSnapshot, type InsulinEvent } from '@/data/sources/types';
import { realLoopTherapy } from '@/data/loopTherapy';
import { buildReviewEvidence, reviewHandoff, reviewMealLabels, reviewTempBasal } from './reviewEvidence';

const now = new Date('2026-10-04T22:00:00Z');
const mealMs = Date.parse('2026-10-03T12:00:00Z');
const iso = (offsetMinutes: number) => new Date(mealMs + offsetMinutes * 60_000).toISOString();
const therapy = { ...realLoopTherapy, basalSchedule: [{ startMinutes: 0, value: 1 }] };
function snapshot(): DataSnapshot {
  return { recentGlucose: freshResult(Array.from({ length: 36 }, (_, i) => ({ iso: iso(i * 5), mgdl: i === 3 ? 61 : 100 + i })), now.toISOString(), 'computed'),
    recentCarbs: freshResult([{ iso: iso(0), grams: 50, label: 'Rice bowl', absorptionHours: 3 }], now.toISOString(), 'computed'),
    recentInsulin: freshResult([{ iso: iso(-15), units: 2, kind: 'bolus' }], now.toISOString(), 'computed'),
    recentWorkouts: emptyResult(),
  } as DataSnapshot;
}
function report(s = snapshot()) {
  return buildReviewEvidence({ snapshot: s, source: 'combined', insulinSource: 'nightscout',
    request: { question: 'Compare rice', topic: 'meal', mealLabel: 'Rice bowl', days: 30 },
    therapy, target: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 }, now });
}

describe('retrospective evidence integrity', () => {
  it('uses written names, never icons or generic entries, and normalizes exact labels', () => {
    expect(reviewMealLabels([{ iso: iso(0), grams: 20, absorptionHours: 3, label: '🥜' },
      { iso: iso(0), grams: 20, absorptionHours: 3, label: 'Meal' },
      { iso: iso(0), grams: 20, absorptionHours: 3, label: 'Rice bowl' }])).toEqual(['Rice bowl']);
    const s = snapshot(); s.recentCarbs.data!.push({ iso: iso(-24 * 60), grams: 40, absorptionHours: 3, label: 'Rice salad' });
    expect(report(s).meals).toHaveLength(1);
  });
  it('reports observed bolus separately from unknown basal and glucose peak from absorption', () => {
    const e = report(); expect(e.meals[0].bolusInWindowU).toBe(2);
    expect(e.meals[0].tempBasalAboveCurrentScheduleU).toBeNull();
    expect(e.meals[0].glucoseCoveragePct).toBe(100);
    expect(e.glucoseCoveragePct).toBeLessThan(1); // elapsed span cannot masquerade as full coverage
    expect(e.insulinSource).toBe('nightscout');
  });
  it('preserves combo meal context and exact components', () => {
    const s = snapshot(); s.recentCarbs.data!.push({ iso: iso(60), grams: 20, absorptionHours: 3, label: 'Fruit' });
    const m = report(s).meals[0]; expect(m.grams).toBe(70); expect(m.entries).toBe(2);
    expect(m.componentLabels).toEqual(['Rice bowl', 'Fruit']);
    expect(m.caveats.some(c => c.startsWith('Combo'))).toBe(true);
  });
  it('returns last THREE sittings newest first instead of three raw carb entries', () => {
    const s = snapshot(); s.recentCarbs.data = Array.from({ length: 5 }, (_, i) => ({ iso: iso(-i * 24 * 60), grams: 50, label: 'Rice bowl', absorptionHours: 3 }));
    const meals = report(s).meals; expect(meals).toHaveLength(3); expect(meals[0].iso).toBe(iso(0)); expect(meals[2].iso).toBe(iso(-2 * 24 * 60));
  });
  it('does not claim zero delivery when insulin is absent', () => {
    const s = snapshot(); s.recentInsulin = emptyResult();
    expect(report(s).meals[0].bolusInWindowU).toBeNull();
  });
  it('discloses stale/sample/error fields and prevents mixed real/sample promotion', () => {
    const s = snapshot(); s.recentInsulin.origin = 'sample'; s.recentInsulin.isStale = true;
    s.recentInsulin.error = new Error('secret URL token'); const e = report(s);
    expect(e.sample).toBe(true); expect(e.status.some(x => x.includes('stale'))).toBe(true);
    expect(reviewHandoff(e)).not.toContain('secret URL token');
  });
  it('deduplicates glucose time slots without inventing sensor coverage', () => {
    const s = snapshot(); s.recentGlucose.data!.push(...s.recentGlucose.data!);
    expect(report(s).meals[0].glucoseSamples).toBe(36);
  });
  it('flags missing starting glucose and truncated meal windows', () => {
    const s = snapshot(); s.recentGlucose.data = s.recentGlucose.data!.slice(10);
    s.recentCarbs.data!.push({ iso: iso(150), grams: 40, label: 'Dinner', absorptionHours: 3 });
    // Within two hours chains; 150 minutes is a NEW sitting and truncates the first.
    const m = report(s).meals[0]; expect(m.startMgdl).toBeNull(); expect(m.completeWindow).toBe(false);
  });
});

describe('temp basal accounting for historical review', () => {
  const temp = (minute: number, rate: number, duration: number): InsulinEvent => ({ iso: iso(minute), units: 0, kind: 'basal_temp', rateUPerHr: rate, durationMin: duration });
  it('does not resume an older temp after a replacement expires', () => {
    const b = reviewTempBasal([temp(0, 3, 120), temp(30, 1, 10)], therapy, mealMs, mealMs + 120 * 60_000);
    expect(b.above).toBe(1); expect(b.minutes).toBe(40); expect(b.below).toBe(0);
  });
  it('integrates partial intervals and reports a suspension as below schedule', () => {
    const b = reviewTempBasal([temp(0, 0, 30)], therapy, mealMs + 30_000, mealMs + 60_000);
    expect(b.below).toBe(0.01); expect(b.above).toBe(0);
  });
  it('unknown rate/duration invalidates a net-insulin comparison', () => {
    const b = reviewTempBasal([temp(0, 2, 30), { iso: iso(15), units: 0.1, kind: 'basal_temp' }], therapy, mealMs, mealMs + 60 * 60_000);
    expect(b.above).toBeNull(); expect(b.unknown).toBe(true);
  });
});
