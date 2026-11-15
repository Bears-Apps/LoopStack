import { describe, it, expect } from 'vitest';
import { computeDayHourGrid } from '@/lib/metrics/dayHourGrid';
import {
  buildDayReport,
  reportNotificationBody,
  MIN_WEEKS_FOR_REPORT,
} from './dayReport';
import type { GlucoseReading, WorkoutEntry } from '@/data/sources/types';
import type { TargetRange } from '@/data/loopTherapyStore';

const TARGET: TargetRange = { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 };
const NOW = new Date('2026-05-05T23:00:00'); // a Tuesday evening

/**
 * Build `weeks` worth of one weekday, where `shape` maps hour → mg/dL.
 * Eight readings an hour so every hour clears the voting threshold.
 */
function weekdayReadings(
  weekday: number,
  weeks: number,
  shape: Record<number, number>,
  jitter = 0,
): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  // Walk back from NOW to find instances of the weekday.
  const cursor = new Date(NOW);
  cursor.setHours(0, 0, 0, 0);
  let found = 0;
  while (found < weeks) {
    if (cursor.getDay() === weekday) {
      for (const [h, mgdl] of Object.entries(shape)) {
        for (let k = 0; k < 8; k += 1) {
          const d = new Date(cursor);
          d.setHours(Number(h), k * 7, 0, 0);
          if (d > NOW) continue;
          out.push({
            iso: d.toISOString(),
            mgdl: mgdl + (jitter ? ((found + k) % 3) * jitter : 0),
          });
        }
      }
      found += 1;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}

const gridFor = (glucose: GlucoseReading[], extra = {}) =>
  computeDayHourGrid({ glucose, target: TARGET, now: NOW, ...extra });

describe('buildDayReport', () => {
  /**
   * The user's own example: steady around 80 by 8am, 120 by 9, 150 by 10.
   * Three separate numbers on their own; one climb when read together.
   */
  it('reports a morning climb as a single stretch', () => {
    const glucose = weekdayReadings(2, 6, { 7: 85, 8: 80, 9: 120, 10: 150, 11: 145 });
    const report = buildDayReport(gridFor(glucose), 2);

    expect(report.building).toBe(false);
    expect(report.label).toBe('Tuesday');
    const climb = report.signals.find((s) => s.kind === 'climb');
    expect(climb).toBeDefined();
    expect(climb!.startHour).toBe(8);
    expect(climb!.endHour).toBe(10);
    expect(climb!.fromMgdl).toBe(80);
    expect(climb!.toMgdl).toBe(150);
    // One stretch, not three adjacent facts.
    expect(report.signals.filter((s) => s.kind === 'climb')).toHaveLength(1);
  });

  it('annotates a stretch with the workout that overlaps it', () => {
    const glucose = weekdayReadings(2, 6, { 8: 80, 9: 120, 10: 150 });
    // A ride every Tuesday at 9.
    const workouts: WorkoutEntry[] = [];
    const cursor = new Date(NOW);
    cursor.setHours(0, 0, 0, 0);
    let found = 0;
    while (found < 6) {
      if (cursor.getDay() === 2) {
        const s = new Date(cursor); s.setHours(9, 0, 0, 0);
        const e = new Date(cursor); e.setHours(9, 45, 0, 0);
        workouts.push({
          id: `w${found}`, type: 'cycling',
          startTime: s.toISOString(), endTime: e.toISOString(), durationMinutes: 45,
        });
        found += 1;
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    const report = buildDayReport(gridFor(glucose, { workouts }), 2);
    const climb = report.signals.find((s) => s.kind === 'climb');
    expect(climb!.exercise).not.toBeNull();
    expect(climb!.exercise!.type).toBe('cycling');
    expect(climb!.line).toMatch(/cycling/i);
  });

  it('flags an hour that reliably runs high', () => {
    const glucose = weekdayReadings(4, 6, { 14: 230, 15: 240, 16: 235 });
    const report = buildDayReport(gridFor(glucose), 4);
    const high = report.signals.find((s) => s.kind === 'high');
    expect(high).toBeDefined();
    expect(high!.startHour).toBe(14);
    expect(high!.endHour).toBe(16);
    expect(high!.line).toMatch(/runs high/);
  });

  it('flags an hour that reliably runs low, and leads with it', () => {
    const glucose = weekdayReadings(1, 6, { 9: 55, 10: 58, 15: 230 });
    const report = buildDayReport(gridFor(glucose), 1);
    // A low outranks a high — it is the one that needs attention first.
    expect(report.signals[0].kind).toBe('low');
    expect(report.headline).toMatch(/runs low/);
  });

  it('says nothing when the day is unremarkable', () => {
    const glucose = weekdayReadings(3, 6, { 8: 110, 9: 115, 10: 112, 11: 118 });
    const report = buildDayReport(gridFor(glucose), 3);
    expect(report.signals).toHaveLength(0);
    expect(report.headline).toMatch(/steady/i);
  });

  describe('evidence discipline', () => {
    it(`will not describe a weekday with fewer than ${MIN_WEEKS_FOR_REPORT} of them on record`, () => {
      const glucose = weekdayReadings(2, 2, { 8: 80, 9: 120, 10: 150 });
      const report = buildDayReport(gridFor(glucose), 2);
      expect(report.building).toBe(true);
      expect(report.signals).toHaveLength(0);
      expect(report.headline).toMatch(/not enough/i);
    });

    /**
     * One dramatic Tuesday is not a Tuesday pattern. The week is the unit of
     * evidence: readings from a single day cannot outvote the weeks around it.
     */
    it('does not let one extreme week create a pattern', () => {
      const normal = weekdayReadings(2, 6, { 8: 110, 9: 112, 10: 115 });
      // One Tuesday that spiked hard, at the same hours.
      const spikeDay = new Date(NOW);
      spikeDay.setDate(spikeDay.getDate() - 7);
      const spike: GlucoseReading[] = [];
      for (const h of [8, 9, 10]) {
        for (let k = 0; k < 8; k += 1) {
          const d = new Date(spikeDay);
          d.setHours(h, k * 7, 0, 0);
          spike.push({ iso: d.toISOString(), mgdl: 300 });
        }
      }
      const report = buildDayReport(gridFor([...normal, ...spike]), 2);
      // The median across weeks absorbs the one bad week rather than reporting it.
      expect(report.signals.find((s) => s.kind === 'high')).toBeUndefined();
    });

    it('does not bridge a gap with an hour nothing observed', () => {
      // 9am has only two readings a week — below the voting threshold — so it
      // cannot join 8 and 10 into one climb.
      const glucose = weekdayReadings(2, 6, { 8: 80, 10: 150 });
      const sparse: GlucoseReading[] = [];
      const cursor = new Date(NOW);
      cursor.setHours(0, 0, 0, 0);
      let found = 0;
      while (found < 6) {
        if (cursor.getDay() === 2) {
          for (let k = 0; k < 2; k += 1) {
            const d = new Date(cursor);
            d.setHours(9, k * 10, 0, 0);
            sparse.push({ iso: d.toISOString(), mgdl: 120 });
          }
          found += 1;
        }
        cursor.setDate(cursor.getDate() - 1);
      }
      const grid = gridFor([...glucose, ...sparse]);
      const nine = grid.days[2].hours[9];
      expect(nine.reliable).toBe(false);
      expect(nine.medianMgdl).toBeNull();
    });
  });

  describe('safety — this is a notification surface, not the meal sheet', () => {
    it('never puts a dose or an instruction in the report', () => {
      const cases = [
        buildDayReport(gridFor(weekdayReadings(2, 6, { 8: 80, 9: 120, 10: 150 })), 2),
        buildDayReport(gridFor(weekdayReadings(1, 6, { 9: 55, 10: 58 })), 1),
        buildDayReport(gridFor(weekdayReadings(4, 6, { 14: 240, 15: 250 })), 4),
        buildDayReport(gridFor(weekdayReadings(3, 6, { 8: 110, 9: 112 })), 3),
        buildDayReport(gridFor(weekdayReadings(2, 1, { 8: 80 })), 2),
      ];
      const BANNED = [
        /\b\d+(\.\d+)?\s*(u|units)\b/i,
        /\btake\b/i,
        /\bpre-?bolus/i,
        /\b(increase|decrease|raise|lower|reduce)\b[^.]{0,20}\b(basal|bolus|insulin|dose)/i,
        /\bcorrect(ion)?\b[^.]{0,15}\bwith\b/i,
        /\byou should\b/i,
        /\bextra insulin\b/i,
      ];
      for (const report of cases) {
        const copy = [report.headline, reportNotificationBody(report), ...report.signals.map((s) => s.line)].join(' ');
        for (const pattern of BANNED) {
          expect(pattern.test(copy), `"${copy}" matched ${pattern}`).toBe(false);
        }
      }
    });
  });

  it('keeps the notification body to the top signals', () => {
    const glucose = weekdayReadings(2, 6, { 6: 55, 9: 240, 10: 245, 14: 60, 20: 250 });
    const report = buildDayReport(gridFor(glucose), 2);
    expect(report.signals.length).toBeGreaterThan(2);
    const body = reportNotificationBody(report);
    // At most two sentences reach the lock screen.
    expect(body.split('. ').length).toBeLessThanOrEqual(3);
  });
});
