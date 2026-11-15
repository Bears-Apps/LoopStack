import type { GlucoseReading } from '@/data/sources/types';
import type { TargetRange } from '@/data/loopTherapyStore';

// Recurring low/high windows, by weekday and hour.
//
// The existing trend views slice glucose by day-of-week OR by hour-of-day.
// Neither answers the question an alert needs: "does Friday at 3pm run low,
// specifically?" That is the day×hour cross-tab, and it is what this module
// builds.
//
// The unit of evidence is the WEEK, not the reading. A single bad Friday
// produces a dozen low readings, and counting readings would make one event
// look like a pattern. So each (weekday, hour) cell asks a binary question per
// week — "did a low happen in this hour that week?" — and a window only
// becomes a pattern when it recurs across separate weeks.
//
// Two shapes are detected, and the difference matters for how many alerts a
// person gets:
//   • an every-day window (most afternoons run low) — one alert covering the
//     whole week, because seven weekday alerts for one habit is noise
//   • a day-specific window (only Fridays) — flagged on its own, and only when
//     that weekday is materially worse than the same hour on other days
//
// Nothing here recommends a dose. It reports that a stretch has repeated, how
// often, and how confident that reading is.

/** Weeks of history needed before any window is reported. */
export const MIN_WEEKS_OBSERVED = 3;

/** Separate weeks a window must recur in to count as a pattern. */
export const MIN_OCCURRENCES = 3;

/** Share of observed weeks the window must appear in. */
const MIN_RECURRENCE_PCT = 60;

/** Readings an hour-cell needs in a week before that week can vote. Twelve is
 *  a full hour of CGM; six allows for a gap without inventing a week. */
const MIN_READINGS_PER_CELL_WEEK = 6;

/** How much worse a weekday must be than the same hour on other days before it
 *  is called day-specific rather than a general habit. */
const DAY_SPECIFIC_MARGIN_PCT = 30;

/** Readings below/above target in an hour before that hour counts as an event
 *  for the week. Two consecutive readings, not one stray value. */
const MIN_EVENT_READINGS = 2;

export type RiskKind = 'low' | 'high';

export type RiskWindow = {
  id: string;
  kind: RiskKind;
  /** 0–6 (Sun–Sat), or null for a window that recurs on every day. */
  weekday: number | null;
  /** Inclusive start hour, 0–23. */
  startHour: number;
  /** Exclusive end hour — a 15:00–17:00 window has startHour 15, endHour 17. */
  endHour: number;
  /** Weeks the window actually appeared in. */
  occurrences: number;
  /** Weeks of history it was measured against. */
  weeksObserved: number;
  /** occurrences ÷ weeksObserved, as a percentage. */
  recurrencePct: number;
  /** Worst reading seen inside the window, for context. */
  extremeMgdl: number;
  confidence: 'good' | 'limited';
  /** Human label: "Fridays around 3–5pm" / "Most days around 3–5pm". */
  label: string;
};

const DAY_NAMES = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

const ms = (iso: string) => new Date(iso).getTime();

/** Monday-first week index, so a weekend pattern is not split across two weeks. */
function weekKey(d: Date): string {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

/** Wall-clock time as a person reads it: "8:50am", "3pm". */
export function formatClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatHour(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

type Cell = {
  /** week key -> { readings, events } */
  weeks: Map<string, { readings: number; events: number; extreme: number }>;
};

function emptyCell(): Cell {
  return { weeks: new Map() };
}

export function computeRiskWindows(input: {
  glucose: GlucoseReading[];
  target: TargetRange;
  now: Date;
}): RiskWindow[] {
  const { target, now } = input;
  const low = target.lowMgdl;
  const high = target.highMgdl;

  // [kind][weekday][hour]
  const cells: Record<RiskKind, Cell[][]> = {
    low: Array.from({ length: 7 }, () => Array.from({ length: 24 }, emptyCell)),
    high: Array.from({ length: 7 }, () => Array.from({ length: 24 }, emptyCell)),
  };

  const allWeeks = new Set<string>();

  for (const r of input.glucose) {
    const t = ms(r.iso);
    if (!Number.isFinite(t) || !Number.isFinite(r.mgdl)) continue;
    const d = new Date(t);
    if (d > now) continue;

    const wk = weekKey(d);
    allWeeks.add(wk);
    const day = d.getDay();
    const hour = d.getHours();

    for (const kind of ['low', 'high'] as RiskKind[]) {
      const cell = cells[kind][day][hour];
      let entry = cell.weeks.get(wk);
      if (!entry) {
        entry = { readings: 0, events: 0, extreme: kind === 'low' ? 999 : 0 };
        cell.weeks.set(wk, entry);
      }
      entry.readings += 1;
      const isEvent = kind === 'low' ? r.mgdl < low : r.mgdl > high;
      if (isEvent) {
        entry.events += 1;
        entry.extreme =
          kind === 'low' ? Math.min(entry.extreme, r.mgdl) : Math.max(entry.extreme, r.mgdl);
      }
    }
  }

  const weeksObserved = allWeeks.size;
  if (weeksObserved < MIN_WEEKS_OBSERVED) return [];

  const windows: RiskWindow[] = [];

  for (const kind of ['low', 'high'] as RiskKind[]) {
    // Per (weekday, hour): how many weeks had an event, out of weeks with
    // enough readings to vote at all.
    const hit: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const voted: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const extreme: number[][] = Array.from({ length: 7 }, () =>
      new Array(24).fill(kind === 'low' ? 999 : 0),
    );

    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        for (const wk of cells[kind][day][hour].weeks.values()) {
          if (wk.readings < MIN_READINGS_PER_CELL_WEEK) continue;
          voted[day][hour] += 1;
          if (wk.events >= MIN_EVENT_READINGS) {
            hit[day][hour] += 1;
            extreme[day][hour] =
              kind === 'low'
                ? Math.min(extreme[day][hour], wk.extreme)
                : Math.max(extreme[day][hour], wk.extreme);
          }
        }
      }
    }

    // ── every-day windows first ──
    // An hour where the pattern shows up on most days is one habit, not seven.
    const everyDayHours = new Set<number>();
    for (let hour = 0; hour < 24; hour += 1) {
      const daysWithPattern = countDaysWithPattern(hit, voted, hour);
      if (daysWithPattern >= 5) everyDayHours.add(hour);
    }

    for (const run of runsOf(everyDayHours)) {
      const stats = aggregateAcrossDays(hit, voted, extreme, run, kind);
      if (stats.occurrences < MIN_OCCURRENCES) continue;
      windows.push(
        makeWindow({
          kind,
          weekday: null,
          startHour: run[0],
          endHour: run[run.length - 1] + 1,
          occurrences: stats.occurrences,
          weeksObserved,
          extremeMgdl: stats.extreme,
        }),
      );
    }

    // ── day-specific windows ──
    for (let day = 0; day < 7; day += 1) {
      const flagged = new Set<number>();
      for (let hour = 0; hour < 24; hour += 1) {
        if (everyDayHours.has(hour)) continue; // already covered week-wide
        const v = voted[day][hour];
        if (v < MIN_WEEKS_OBSERVED) continue;
        const pct = (hit[day][hour] / v) * 100;
        if (hit[day][hour] < MIN_OCCURRENCES || pct < MIN_RECURRENCE_PCT) continue;

        // Materially worse than the same hour on the other six days, or it is
        // a general habit wearing a weekday's name.
        const otherPct = otherDaysPct(hit, voted, day, hour);
        if (pct - otherPct < DAY_SPECIFIC_MARGIN_PCT) continue;

        flagged.add(hour);
      }

      for (const run of runsOf(flagged)) {
        const occurrences = Math.max(...run.map((h) => hit[day][h]));
        const ext =
          kind === 'low'
            ? Math.min(...run.map((h) => extreme[day][h]))
            : Math.max(...run.map((h) => extreme[day][h]));
        windows.push(
          makeWindow({
            kind,
            weekday: day,
            startHour: run[0],
            endHour: run[run.length - 1] + 1,
            occurrences,
            weeksObserved,
            extremeMgdl: ext,
          }),
        );
      }
    }
  }

  // Most-recurring first — the scheduler takes the top few.
  return windows.sort((a, b) => b.recurrencePct - a.recurrencePct || b.occurrences - a.occurrences);
}

function countDaysWithPattern(hit: number[][], voted: number[][], hour: number): number {
  let days = 0;
  for (let day = 0; day < 7; day += 1) {
    const v = voted[day][hour];
    if (v < 2) continue;
    if ((hit[day][hour] / v) * 100 >= MIN_RECURRENCE_PCT) days += 1;
  }
  return days;
}

function otherDaysPct(hit: number[][], voted: number[][], day: number, hour: number): number {
  let h = 0;
  let v = 0;
  for (let d = 0; d < 7; d += 1) {
    if (d === day) continue;
    h += hit[d][hour];
    v += voted[d][hour];
  }
  return v > 0 ? (h / v) * 100 : 0;
}

function aggregateAcrossDays(
  hit: number[][],
  voted: number[][],
  extreme: number[][],
  run: number[],
  kind: RiskKind,
): { occurrences: number; extreme: number } {
  // Weeks in which the window fired on ANY day — the honest count for a
  // pattern described as "most days".
  let occurrences = 0;
  let ext = kind === 'low' ? 999 : 0;
  for (const hour of run) {
    for (let day = 0; day < 7; day += 1) {
      if (voted[day][hour] === 0) continue;
      occurrences = Math.max(occurrences, hit[day][hour]);
      ext =
        kind === 'low'
          ? Math.min(ext, extreme[day][hour])
          : Math.max(ext, extreme[day][hour]);
    }
  }
  return { occurrences, extreme: ext };
}

/** Consecutive hours, grouped into runs. Wrapping midnight is not merged — an
 *  overnight pattern reads better as two windows than as "23:00–02:00". */
function runsOf(hours: Set<number>): number[][] {
  const sorted = [...hours].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last && h === last[last.length - 1] + 1) last.push(h);
    else runs.push([h]);
  }
  return runs;
}

function makeWindow(x: {
  kind: RiskKind;
  weekday: number | null;
  startHour: number;
  endHour: number;
  occurrences: number;
  weeksObserved: number;
  extremeMgdl: number;
}): RiskWindow {
  const recurrencePct = Math.round((x.occurrences / x.weeksObserved) * 100);
  const when = x.weekday == null ? 'Most days' : DAY_NAMES[x.weekday];
  const span =
    x.endHour - x.startHour === 1
      ? `around ${formatHour(x.startHour)}`
      : `around ${formatHour(x.startHour)}–${formatHour(x.endHour)}`;

  return {
    id: `${x.kind}_${x.weekday ?? 'all'}_${x.startHour}_${x.endHour}`,
    kind: x.kind,
    weekday: x.weekday,
    startHour: x.startHour,
    endHour: x.endHour,
    occurrences: x.occurrences,
    weeksObserved: x.weeksObserved,
    recurrencePct: Math.min(100, recurrencePct),
    extremeMgdl: Math.round(x.extremeMgdl),
    confidence: x.occurrences >= 4 && x.weeksObserved >= 4 ? 'good' : 'limited',
    label: `${when} ${span}`,
  };
}
