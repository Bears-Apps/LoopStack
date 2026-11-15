import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import { localDayKey, median, windowed } from '@/lib/metrics/hypoEvents';

// Meal panels: breakfast, lunch and dinner read the way an AID clinic reads
// them. For each window, the first carb entry of the day is the meal, and the
// panel reports:
//   - glucose going in (pre-meal),
//   - the 2-hour change (the AID consensus goal is a rise under 60 mg/dL),
//   - where glucose sits 3–4 hours later, after the bolus has mostly acted,
//   - how often the window has a carb entry at all (an unlogged meal is the
//     first thing to rule out before reading a ratio), and
//   - bolus lead time: minutes from the bolus to the carb entry.
//
// Observations only. A large rise points at timing, carb ratio or absorption
// time as things to review together; it is not a ratio to change.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Snacks under this do not count as the window's meal. */
const MIN_MEAL_GRAMS = 10;
/** A reading counts for "at time t" within this many minutes. */
const NEAR_MINUTES = 10;
/** The AID consensus post-meal goal: a 2-hour rise under this. */
export const RISE_GOAL_MGDL = 60;
/** A bolus counts as the meal's bolus from 60 minutes before to 30 after. */
const BOLUS_BEFORE_MIN = 60;
const BOLUS_AFTER_MIN = 30;

export type MealWindowId = 'breakfast' | 'lunch' | 'dinner';
export const MEAL_WINDOWS: { id: MealWindowId; label: string; fromHour: number; toHour: number }[] = [
  { id: 'breakfast', label: 'Breakfast', fromHour: 5, toHour: 11 },
  { id: 'lunch', label: 'Lunch', fromHour: 11, toHour: 16 },
  { id: 'dinner', label: 'Dinner', fromHour: 16, toHour: 22 },
];

export type MealPanel = {
  id: MealWindowId;
  label: string;
  fromHour: number;
  toHour: number;
  /** Meals found (first ≥10 g entry of the window each day). */
  meals: number;
  /** Of the days with CGM data, the share with a carb entry in this window. */
  loggedDaysPct: number;
  medianCarbsG: number | null;
  medianPreMgdl: number | null;
  /** Median of (2 h value − pre-meal value), over meals with both readings. */
  medianRise2hMgdl: number | null;
  /** Share of read meals whose 2-hour rise stayed under RISE_GOAL_MGDL. */
  riseUnderGoalPct: number | null;
  /** Median of each meal's mean glucose 3–4 hours after the entry. */
  median3to4hMgdl: number | null;
  /** Median minutes the bolus came before the carb entry (negative = after). */
  medianLeadMin: number | null;
  /** Meals with a pre-meal and a 2-hour reading. */
  readMeals: number;
};

export type MealPanels = {
  windowDays: number;
  daysWithData: number;
  panels: MealPanel[];
};

export function computeMealPanels(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  /** Boluses (other insulin kinds are ignored). */
  insulin: InsulinEvent[];
  now: Date;
  windowDays: number;
}): MealPanels {
  const end = input.now.getTime();
  const start = end - input.windowDays * DAY;
  // Glucose is read a little past the window's start and up to now, so a
  // meal at the window's edge still has its pre-meal reading.
  const readings = windowed(input.glucose, input.now, input.windowDays + 1);
  const times = readings.map((r) => r.t);
  const days = new Set(readings.filter((r) => r.t >= start).map((r) => localDayKey(r.t)));

  /** Nearest reading to t within ±NEAR_MINUTES, by binary search. */
  const near = (t: number): number | null => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    let best: number | null = null;
    let bestD = NEAR_MINUTES * MIN + 1;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= times.length) continue;
      const d = Math.abs(times[i] - t);
      if (d < bestD) {
        bestD = d;
        best = readings[i].mgdl;
      }
    }
    return best;
  };
  const meanBetween = (from: number, to: number): number | null => {
    const xs = readings.filter((r) => r.t >= from && r.t <= to).map((r) => r.mgdl);
    return xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  const carbs = input.carbs
    .map((c) => ({ t: Date.parse(c.iso), grams: c.grams }))
    .filter((c) => Number.isFinite(c.t) && c.t >= start && c.t <= end && c.grams >= MIN_MEAL_GRAMS)
    .sort((a, b) => a.t - b.t);
  const boluses = input.insulin
    .filter((i) => i.kind === 'bolus' && i.units > 0)
    .map((i) => Date.parse(i.iso))
    .filter(Number.isFinite);

  const panels = MEAL_WINDOWS.map((w): MealPanel => {
    // First qualifying entry per day within the window's hours.
    const firstByDay = new Map<string, { t: number; grams: number }>();
    for (const c of carbs) {
      const h = new Date(c.t).getHours();
      if (h < w.fromHour || h >= w.toHour) continue;
      const key = localDayKey(c.t);
      if (!firstByDay.has(key)) firstByDay.set(key, c);
    }
    const meals = [...firstByDay.values()];
    const pre: number[] = [];
    const rise: number[] = [];
    const late: number[] = [];
    const lead: number[] = [];
    for (const m of meals) {
      // Pre-meal: the reading at the entry, or failing that just before it.
      const p = near(m.t) ?? near(m.t - NEAR_MINUTES * MIN);
      const two = near(m.t + 120 * MIN);
      if (p != null) pre.push(p);
      if (p != null && two != null) rise.push(two - p);
      // Only once the 4-hour mark has passed: an unfinished meal is not a reading.
      if (m.t + 240 * MIN <= end) {
        const v = meanBetween(m.t + 180 * MIN, m.t + 240 * MIN);
        if (v != null) late.push(v);
      }
      // The bolus closest to the entry, within the window around it.
      let best: number | null = null;
      for (const b of boluses) {
        const d = m.t - b;
        if (d > BOLUS_BEFORE_MIN * MIN || d < -BOLUS_AFTER_MIN * MIN) continue;
        if (best == null || Math.abs(d) < Math.abs(best)) best = d;
      }
      if (best != null) lead.push(best / MIN);
    }
    const round = (x: number | null) => (x == null ? null : Math.round(x));
    return {
      id: w.id,
      label: w.label,
      fromHour: w.fromHour,
      toHour: w.toHour,
      meals: meals.length,
      loggedDaysPct: days.size ? (Math.min(meals.length, days.size) / days.size) * 100 : 0,
      medianCarbsG: round(median(meals.map((m) => m.grams))),
      medianPreMgdl: round(median(pre)),
      medianRise2hMgdl: round(median(rise)),
      riseUnderGoalPct: rise.length ? (rise.filter((r) => r < RISE_GOAL_MGDL).length / rise.length) * 100 : null,
      median3to4hMgdl: round(median(late)),
      medianLeadMin: round(median(lead)),
      readMeals: rise.length,
    };
  });

  // Capped: a mid-day rolling window touches windowDays + 1 calendar dates.
  return { windowDays: input.windowDays, daysWithData: Math.min(input.windowDays, days.size), panels };
}
