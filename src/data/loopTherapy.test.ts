import { describe, expect, it } from 'vitest';
import {
  carbRatioAt,
  dailyBasalTotal,
  formatScheduleTime,
  isfAt,
  minutesOfDay,
  rangeAt,
  realLoopTherapy,
  valueAt,
} from './loopTherapy';

const at = (h: number, m = 0) => {
  const d = new Date('2026-07-23T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
};

describe('valueAt', () => {
  const schedule = [
    { startMinutes: 0, value: 1 },
    { startMinutes: 360, value: 2 }, // 6:00
    { startMinutes: 780, value: 3 }, // 13:00
  ];

  it('returns the entry active at the given time', () => {
    expect(valueAt(schedule, 0)).toBe(1);
    expect(valueAt(schedule, 359)).toBe(1);
    expect(valueAt(schedule, 360)).toBe(2); // boundary is inclusive of the start
    expect(valueAt(schedule, 800)).toBe(3);
    expect(valueAt(schedule, 24 * 60 - 1)).toBe(3);
  });

  it('is safe on an empty schedule', () => {
    expect(valueAt([], 500)).toBe(0);
  });
});

describe('sample carb ratio schedule', () => {
  it('resolves the three bands by clock time', () => {
    expect(carbRatioAt(realLoopTherapy, at(2))).toBe(12); // overnight
    expect(carbRatioAt(realLoopTherapy, at(13, 30))).toBe(13); // midday
    expect(carbRatioAt(realLoopTherapy, at(19))).toBe(12); // evening
  });

  it('crosses the 11:00 AM boundary correctly', () => {
    expect(carbRatioAt(realLoopTherapy, at(10, 59))).toBe(12);
    expect(carbRatioAt(realLoopTherapy, at(11, 0))).toBe(13);
  });
});

describe('sample ISF schedule', () => {
  it('resolves each band by clock time', () => {
    expect(isfAt(realLoopTherapy, at(0))).toBe(50);
    expect(isfAt(realLoopTherapy, at(7))).toBe(45);
    expect(isfAt(realLoopTherapy, at(16))).toBe(55); // afternoon band
    expect(isfAt(realLoopTherapy, at(23))).toBe(50);
  });
});

describe('rangeAt (correction range)', () => {
  it('resolves the band that applies at a time', () => {
    expect(rangeAt(realLoopTherapy.correctionRange, minutesOfDay(at(7, 30)))).toEqual({
      low: 100,
      high: 115,
    });
    expect(rangeAt(realLoopTherapy.correctionRange, minutesOfDay(at(0)))).toEqual({
      low: 100,
      high: 110,
    });
  });
});

describe('dailyBasalTotal', () => {
  it('integrates the schedule over the day', () => {
    // 0.85×3 + 0.95×4 + 0.8×5 + 0.7×5 + 0.8×4 + 0.9×3
    expect(dailyBasalTotal(realLoopTherapy)).toBeCloseTo(19.75, 2);
  });
});

describe('formatScheduleTime', () => {
  it('formats minutes as a 12-hour clock label', () => {
    expect(formatScheduleTime(0)).toBe('12:00 AM');
    expect(formatScheduleTime(13 * 60 + 30)).toBe('1:30 PM');
    expect(formatScheduleTime(12 * 60)).toBe('12:00 PM');
    expect(formatScheduleTime(23 * 60)).toBe('11:00 PM');
  });
});
