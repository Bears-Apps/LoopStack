import type { WorkoutEntry } from '@/data/sources/types';
import { dedupeWorkouts } from '@/lib/activity/activityEvents';
import { MIN_WEEKS_PER_CELL, PATTERN_SAMPLE_WEEKS } from './dayHourGrid';

// How much each weekday hour usually moves: the exercise lane under the
// weekday-hours charts.
//
// A routine low is often a routine workout. Tuesday 7pm runs low because
// Tuesday 5pm is a run, and the glucose chart alone cannot say so. This puts
// the run on the same time axis as the low.
//
// Kept apart from weekdayHourly.ts on purpose. Exercise is Apple Health's to
// own (Nightscout carries none of it), while glucose, insulin and carbs can
// come from Nightscout. Folding exercise into that view would leave anyone on
// the combined source with no exercise at all, because the combined source
// takes the weekday view whole from Nightscout. As its own field it follows
// the activity stream to whichever source owns activity.
//
// Same unit as the rest of the weekday view: THE WEEK. Each hour is the mean,
// across every instance of that weekday in the sample, of the minutes moved in
// that hour. A Tuesday with no exercise counts as zero rather than being left
// out, so "18 min" means a usual Tuesday at 5pm, not a Tuesday on which you
// happened to run. How often it happens is reported next to it.
//
// The sample starts at the first activity record, not twelve weeks back: an
// account that only began recording a month ago has four Tuesdays, not twelve
// Tuesdays of which eight were idle. Apple Health cannot tell an idle hour from
// a day the Watch stayed on the charger, so both count as zero.

export type HourExercise = {
  hour: number;
  /** Mean minutes of exercise in this hour across every instance of the weekday. */
  minutes: number;
  /** Instances of the weekday where this hour had at least a minute of exercise. */
  weeksActive: number;
  /** Instances of the weekday behind this hour. */
  weeks: number;
  reliable: boolean;
  /** Most common logged workout overlapping this hour, when there is one. */
  workoutType: string | null;
};

export type WeekdayExerciseDay = {
  weekday: number;
  hours: HourExercise[];
};

export type WeekdayExercise = {
  days: WeekdayExerciseDay[];
  sampleWeeks: number;
  /**
   * 'exercise_minutes': Apple's exercise minutes, which count brisk movement as
   * well as logged workouts. 'workouts': logged workouts only, because the
   * source had no exercise minutes (no Watch, say).
   */
  basis: 'exercise_minutes' | 'workouts';
  fromIso: string;
  toIso: string;
};

const HOUR_MS = 3600_000;

/** Local hour start, as a stable key. */
function hourKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
}

function mode(xs: string[]): string | null {
  if (xs.length === 0) return null;
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * The usual exercise for each weekday hour. Null when the source carries no
 * activity at all, so the screen can say "needs Apple Health" rather than draw
 * a flat line that reads as "you never move".
 */
export function computeWeekdayExercise(input: {
  /** Hourly exercise minutes, as produced by the hour-bucketed HealthKit read. */
  exerciseByHour?: { iso: string; minutes: number }[];
  workouts?: WorkoutEntry[];
  now: Date;
  weeks?: number;
}): WeekdayExercise | null {
  const nowMs = input.now.getTime();
  const sampleWeeks = input.weeks ?? PATTERN_SAMPLE_WEEKS;
  const windowStartMs = nowMs - sampleWeeks * 7 * 24 * HOUR_MS;

  const minuteRecords = (input.exerciseByHour ?? [])
    .map((e) => ({ ms: new Date(e.iso).getTime(), minutes: e.minutes }))
    .filter((e) => Number.isFinite(e.ms) && Number.isFinite(e.minutes) && e.ms >= windowStartMs && e.ms < nowMs);
  const workouts = dedupeWorkouts(input.workouts ?? [])
    .map((w) => ({ startMs: new Date(w.startTime).getTime(), endMs: Math.min(new Date(w.endTime).getTime(), nowMs), type: w.type }))
    .filter((w) => w.endMs > w.startMs && w.endMs > windowStartMs && w.startMs < nowMs);

  if (minuteRecords.length === 0 && workouts.length === 0) return null;
  const basis: WeekdayExercise['basis'] = minuteRecords.length > 0 ? 'exercise_minutes' : 'workouts';

  // Minutes and workout types per local clock hour.
  const minutesAt = new Map<string, number>();
  const typesAt = new Map<string, string[]>();
  const add = (d: Date, minutes: number) => {
    const k = hourKey(d);
    minutesAt.set(k, Math.min(60, (minutesAt.get(k) ?? 0) + minutes));
  };
  if (basis === 'exercise_minutes') {
    for (const e of minuteRecords) if (e.minutes > 0) add(new Date(e.ms), e.minutes);
  }
  for (const w of workouts) {
    // A workout is a span: a 45-minute ride from 8:50 is ten minutes of 8am
    // and thirty-five of 9am.
    const startMs = Math.max(w.startMs, windowStartMs);
    const first = new Date(startMs);
    first.setMinutes(0, 0, 0);
    for (let h = first.getTime(); h < w.endMs; h += HOUR_MS) {
      const d = new Date(h);
      const overlap = (Math.min(w.endMs, h + HOUR_MS) - Math.max(startMs, h)) / 60_000;
      if (overlap <= 0) continue;
      if (basis === 'workouts') add(d, overlap);
      const k = hourKey(d);
      const list = typesAt.get(k) ?? [];
      list.push(w.type);
      typesAt.set(k, list);
    }
  }

  // The sample runs from the first activity record, floored to its local day.
  const firstMs = Math.min(
    minuteRecords.reduce((m, e) => Math.min(m, e.ms), Infinity),
    workouts.reduce((m, w) => Math.min(m, w.startMs), Infinity),
  );
  const coverageStart = new Date(Math.max(windowStartMs, firstMs));
  coverageStart.setHours(0, 0, 0, 0);
  const coverageStartMs = Math.max(coverageStart.getTime(), windowStartMs);

  // [weekday][hour] accumulators over every completed instance of that hour.
  const acc = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ instances: 0, total: 0, active: 0, types: [] as string[] })),
  );
  const day = new Date(coverageStart);
  while (day.getTime() < nowMs) {
    for (let hour = 0; hour < 24; hour += 1) {
      const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
      // Only hours that are wholly inside the sample and already over.
      if (d.getTime() < coverageStartMs || d.getTime() + HOUR_MS > nowMs) continue;
      const k = hourKey(d);
      const minutes = minutesAt.get(k) ?? 0;
      const cell = acc[d.getDay()][hour];
      cell.instances += 1;
      cell.total += minutes;
      if (minutes >= 1) cell.active += 1;
      const types = typesAt.get(k);
      if (types) cell.types.push(...types);
    }
    day.setDate(day.getDate() + 1);
  }

  const days: WeekdayExerciseDay[] = acc.map((hours, weekday) => ({
    weekday,
    hours: hours.map((c, hour) => ({
      hour,
      minutes: c.instances ? Math.round(c.total / c.instances) : 0,
      weeksActive: c.active,
      weeks: c.instances,
      reliable: c.instances >= MIN_WEEKS_PER_CELL,
      workoutType: mode(c.types),
    })),
  }));

  return {
    days,
    sampleWeeks,
    basis,
    fromIso: new Date(coverageStartMs).toISOString(),
    toIso: input.now.toISOString(),
  };
}
