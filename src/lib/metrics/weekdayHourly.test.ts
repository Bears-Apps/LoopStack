import { describe, expect, it } from 'vitest';
import { realLoopTherapy } from '@/data/loopTherapy';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import { computeDayHourGrid, PATTERN_SAMPLE_WEEKS } from './dayHourGrid';
import { computeWeekdayHourly, weekdayPatternPath } from './weekdayHourly';

// A Wednesday at noon.
const NOW = new Date(2026, 7, 12, 12, 0, 0);
const TARGET = { lowMgdl: 70, highMgdl: 180, urgentLowMgdl: 54 };
const THERAPY = { ...realLoopTherapy, insulinDurationHours: 6 };

/** `days` of 5-minute CGM ending at NOW, valued by `mgdlAt`. */
function cgm(days: number, mgdlAt: (d: Date) => number): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  for (let t = NOW.getTime() - days * 86_400_000; t < NOW.getTime(); t += 300_000) {
    out.push({ iso: new Date(t).toISOString(), mgdl: mgdlAt(new Date(t)) });
  }
  return out;
}

/** The same event at `hour` on every `weekday` in the last `days`. */
function every(weekday: number, hour: number, days: number): Date[] {
  const out: Date[] = [];
  const d = new Date(NOW);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - days);
  for (; d < NOW; d.setDate(d.getDate() + 1)) if (d.getDay() === weekday) out.push(new Date(d));
  return out;
}

describe('computeWeekdayHourly', () => {
  it('averages glucose by weekday hour, weighting each week equally', () => {
    // Tuesdays at 3pm sit at 60; everything else at 120.
    const glucose = cgm(84, (d) => (d.getDay() === 2 && d.getHours() === 15 ? 60 : 120));
    const w = computeWeekdayHourly({ glucose, insulin: [], carbs: [], therapy: THERAPY, target: TARGET, now: NOW });
    const tue = w.days[2];
    expect(tue.hours[15].glucoseMgdl).toBe(60);
    expect(tue.hours[15].lowPct).toBe(100);
    expect(tue.hours[14].glucoseMgdl).toBe(120);
    expect(tue.hours[15].reliable).toBe(true);
    expect(tue.weeksObserved).toBeGreaterThanOrEqual(12);
    // No treatments: no IOB or COB to report, rather than zeros.
    expect(tue.hours[15].iobU).toBeNull();
    expect(tue.hours[15].cobG).toBeNull();
  });

  it('only reads the last twelve weeks', () => {
    // Twenty weeks of history; Tuesdays 3pm were low only before the sample.
    const cutoff = NOW.getTime() - PATTERN_SAMPLE_WEEKS * 7 * 86_400_000;
    const glucose = cgm(140, (d) => (d.getDay() === 2 && d.getHours() === 15 && d.getTime() < cutoff ? 60 : 120));
    const w = computeWeekdayHourly({ glucose, insulin: [], carbs: [], therapy: THERAPY, target: TARGET, now: NOW });
    expect(w.sampleWeeks).toBe(12);
    expect(w.days[2].hours[15].glucoseMgdl).toBe(120);
    expect(w.days[2].hours[15].lowPct).toBe(0);
  });

  it('carries insulin and carbs on board into the hours after a Tuesday lunch', () => {
    const glucose = cgm(84, () => 120);
    const lunches = every(2, 12, 84);
    const insulin: InsulinEvent[] = lunches.map((d) => ({ iso: d.toISOString(), units: 4, kind: 'bolus' }));
    const carbs: CarbEntry[] = lunches.map((d) => ({ iso: d.toISOString(), grams: 60, absorptionHours: 3 }));
    const w = computeWeekdayHourly({ glucose, insulin, carbs, therapy: THERAPY, target: TARGET, now: NOW });
    const tue = w.days[2].hours;
    // Most of the dose is still on board in the first hour, less by the third.
    expect(tue[12].iobU!).toBeGreaterThan(3);
    expect(tue[14].iobU!).toBeLessThan(tue[12].iobU!);
    expect(tue[14].iobU!).toBeGreaterThan(0);
    // Carbs are gone once the absorption time has run.
    expect(tue[12].cobG!).toBeGreaterThan(30);
    expect(tue[16].cobG).toBe(0);
    // Nothing on board on a Thursday.
    expect(w.days[4].hours[12].iobU).toBe(0);
    expect(w.iobBasis).toBe('bolus_only');
  });

  it('nets temp basals against the schedule, so a zero temp reads below zero', () => {
    const glucose = cgm(84, () => 120);
    const insulin: InsulinEvent[] = every(4, 2, 84).map((d) => ({
      iso: d.toISOString(),
      units: 0,
      kind: 'basal_temp',
      rateUPerHr: 0,
      durationMin: 120,
    }));
    const w = computeWeekdayHourly({ glucose, insulin, carbs: [], therapy: THERAPY, target: TARGET, now: NOW });
    expect(w.days[4].hours[3].iobU!).toBeLessThan(0);
    expect(w.iobBasis).toBe('net');
  });
});

describe('computeDayHourGrid weeks', () => {
  it('drops readings older than the window', () => {
    const cutoff = NOW.getTime() - PATTERN_SAMPLE_WEEKS * 7 * 86_400_000;
    const glucose = cgm(140, (d) => (d.getDay() === 2 && d.getHours() === 15 && d.getTime() < cutoff ? 60 : 120));
    const all = computeDayHourGrid({ glucose, target: TARGET, now: NOW });
    const recent = computeDayHourGrid({ glucose, target: TARGET, now: NOW, weeks: PATTERN_SAMPLE_WEEKS });
    expect(all.days[2].hours[15].lowPct).toBeGreaterThan(0);
    expect(recent.days[2].hours[15].lowPct).toBe(0);
    expect(recent.weeksObserved).toBeLessThan(all.weeksObserved);
  });
});

describe('weekdayPatternPath', () => {
  it('names the weekday and, when given, the stretch', () => {
    expect(weekdayPatternPath({ weekday: 2 })).toBe('/app/weekday?day=2');
    expect(weekdayPatternPath({ weekday: 2, startHour: 15, endHour: 16 })).toBe('/app/weekday?day=2&from=15&to=16');
  });
});
