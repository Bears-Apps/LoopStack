import { describe, expect, it } from 'vitest';
import type { WorkoutEntry } from '@/data/sources/types';
import { computeWeekdayExercise } from './weekdayExercise';

// A Wednesday at noon.
const NOW = new Date(2026, 7, 12, 12, 0, 0);

/** Every `weekday` in the last `days`, at `hour`:`minute`. */
function every(weekday: number, hour: number, days: number, minute = 0): Date[] {
  const out: Date[] = [];
  const d = new Date(NOW);
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - days);
  for (; d < NOW; d.setDate(d.getDate() + 1)) if (d.getDay() === weekday) out.push(new Date(d));
  return out;
}

const hourBucket = (d: Date, minutes: number) => {
  const h = new Date(d);
  h.setMinutes(0, 0, 0);
  return { iso: h.toISOString(), minutes };
};

const workout = (start: Date, minutes: number, type: WorkoutEntry['type'] = 'running'): WorkoutEntry => ({
  id: `${type}-${start.toISOString()}`,
  type,
  startTime: start.toISOString(),
  endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
  durationMinutes: minutes,
});

describe('computeWeekdayExercise', () => {
  it('returns null when the source carries no activity at all', () => {
    expect(computeWeekdayExercise({ now: NOW })).toBeNull();
    expect(computeWeekdayExercise({ exerciseByHour: [], workouts: [], now: NOW })).toBeNull();
  });

  it('counts a weekday with no exercise as zero, so the figure is a usual day', () => {
    // Twelve weeks of a watch that records something every day at 7am, and a
    // 30-minute Tuesday 5pm session on only half the Tuesdays.
    const daily = Array.from({ length: 84 }, (_, i) => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - 84 + i);
      d.setHours(7, 0, 0, 0);
      return hourBucket(d, 5);
    });
    const tuesdays = every(2, 17, 84);
    const sessions = tuesdays.filter((_, i) => i % 2 === 0).map((d) => hourBucket(d, 30));
    const x = computeWeekdayExercise({ exerciseByHour: [...daily, ...sessions], now: NOW })!;
    const tue5pm = x.days[2].hours[17];
    expect(x.basis).toBe('exercise_minutes');
    expect(tue5pm.weeks).toBe(tuesdays.length);
    expect(tue5pm.weeksActive).toBe(sessions.length);
    // Half the Tuesdays at 30 minutes, half at zero.
    expect(tue5pm.minutes).toBe(Math.round((sessions.length * 30) / tuesdays.length));
    expect(tue5pm.reliable).toBe(true);
    // Nothing on a Thursday at 5pm.
    expect(x.days[4].hours[17].minutes).toBe(0);
    expect(x.days[4].hours[17].weeksActive).toBe(0);
  });

  it('splits a workout across the hours it spans, when there are no exercise minutes', () => {
    // Saturday rides from 8:50 for 45 minutes: 10 minutes of 8am, 35 of 9am.
    const rides = every(6, 8, 84, 50).map((d) => workout(d, 45, 'cycling'));
    const x = computeWeekdayExercise({ workouts: rides, now: NOW })!;
    const sat = x.days[6].hours;
    expect(x.basis).toBe('workouts');
    expect(sat[8].minutes).toBe(10);
    expect(sat[9].minutes).toBe(35);
    expect(sat[10].minutes).toBe(0);
    expect(sat[9].workoutType).toBe('cycling');
    expect(sat[9].weeksActive).toBe(rides.length);
  });

  it('takes minutes from exercise minutes and the label from workouts when it has both', () => {
    const runs = every(2, 17, 84);
    const x = computeWeekdayExercise({
      exerciseByHour: runs.map((d) => hourBucket(d, 25)),
      workouts: runs.map((d) => workout(d, 40)),
      now: NOW,
    })!;
    // Exercise minutes win: the workout's 40 is not added on top.
    expect(x.days[2].hours[17].minutes).toBe(25);
    expect(x.days[2].hours[17].workoutType).toBe('running');
  });

  it('collapses the same run logged by two apps', () => {
    const runs = every(2, 17, 84);
    const twice = runs.flatMap((d) => [workout(d, 40), { ...workout(new Date(d.getTime() + 60_000), 38), id: `dup-${d.toISOString()}` }]);
    const x = computeWeekdayExercise({ workouts: twice, now: NOW })!;
    expect(x.days[2].hours[17].minutes).toBe(40);
  });

  it('starts the sample at the first activity record, not twelve weeks back', () => {
    // Recording began four weeks ago: four Tuesdays, every one with a run.
    const runs = every(2, 17, 28);
    const x = computeWeekdayExercise({ exerciseByHour: runs.map((d) => hourBucket(d, 30)), now: NOW })!;
    expect(x.days[2].hours[17].weeks).toBe(runs.length);
    expect(x.days[2].hours[17].minutes).toBe(30);
  });

  it('marks hours with fewer than three weeks behind them as unreliable', () => {
    const runs = every(2, 17, 14);
    const x = computeWeekdayExercise({ exerciseByHour: runs.map((d) => hourBucket(d, 30)), now: NOW })!;
    expect(x.days[2].hours[17].weeks).toBeLessThan(3);
    expect(x.days[2].hours[17].reliable).toBe(false);
  });

  it('leaves out hours that have not finished yet', () => {
    // NOW is Wednesday noon: today's noon hour is still running.
    const x = computeWeekdayExercise({ exerciseByHour: every(3, 9, 84).map((d) => hourBucket(d, 20)), now: NOW })!;
    const wed = x.days[3].hours;
    expect(wed[11].weeks).toBe(wed[12].weeks + 1);
  });
});
