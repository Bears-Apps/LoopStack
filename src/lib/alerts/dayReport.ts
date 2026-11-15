import type { DayHourGrid, HourCell } from '@/lib/metrics/dayHourGrid';
import { WEEKDAY_LABELS } from '@/lib/metrics/dayHourGrid';
import { formatHour } from './riskWindows';

// The morning report: what today usually does, and only the parts worth knowing.
//
// A full hour-by-hour readout of a weekday is 24 lines, most of them saying
// nothing happened. Nobody reads that at 7am, and a report nobody reads is
// worse than no report because it trains the notification to be dismissed. So
// this reports the EXCEPTIONS: the stretches that reliably run high, run low,
// or climb hard, plus whatever the app knows was happening at the time.
//
// What it is not: a dose. The report says "Tuesdays climb from 80 at 8am to
// 150 by 10, and you are usually riding at 9" — the reading of that, and any
// decision that follows, belongs to the person and their care team. This is a
// notification surface, so the meal-strategy carve-out in principles.md #5
// does not apply here: no unit quantities, no instructions, at all.

/** A stretch of the day worth mentioning. */
export type DaySignal = {
  kind: 'climb' | 'fall' | 'high' | 'low';
  startHour: number;
  endHour: number;
  /** Median glucose at the start and end of the stretch. */
  fromMgdl: number;
  toMgdl: number;
  /** Weeks of evidence behind the weakest hour in the stretch. */
  weeksVoted: number;
  /** Exercise overlapping the stretch, when there is any. */
  exercise: { minutes: number; weeks: number; type: string | null } | null;
  /** Median carbs logged across the stretch. */
  carbsG: number;
  line: string;
};

export type DayReport = {
  weekday: number;
  label: string;
  /** Distinct weeks of this weekday behind the report. */
  weeksObserved: number;
  signals: DaySignal[];
  /** One-line summary for the notification body. */
  headline: string;
  /** True when there was not enough history to say anything. */
  building: boolean;
};

/** Change across a stretch that makes it a climb or a fall worth naming. */
export const NOTABLE_SWING_MGDL = 40;

/** Share of an hour spent above the high bound before it is "runs high". */
export const NOTABLE_HIGH_PCT = 30;

/** Share below the low bound before it is "runs low". Lower, because a low
 *  matters at a smaller share than a high does. */
export const NOTABLE_LOW_PCT = 15;

/**
 * Longest stretch a climb or fall may span.
 *
 * Glucose drifting down across seven hours is technically one monotonic run,
 * and reporting it as "2pm–9pm usually drifts down" is useless: it describes
 * most of the afternoon and points at no moment in particular. A heads-up has
 * to name a stretch short enough to do something about, so a long run is
 * reduced to its steepest window of this length.
 */
export const MAX_STRETCH_HOURS = 4;

/** Weeks of this weekday needed before the report says anything at all. */
export const MIN_WEEKS_FOR_REPORT = 3;

/** Hours the morning report covers. Overnight is its own problem. */
export const REPORT_START_HOUR = 5;
export const REPORT_END_HOUR = 23;

function exerciseFor(cells: HourCell[]): DaySignal['exercise'] {
  const withMovement = cells.filter((c) => c.exerciseMinutes > 0 || c.weeksWithWorkout > 0);
  if (withMovement.length === 0) return null;
  const minutes = withMovement.reduce((a, c) => a + c.exerciseMinutes, 0);
  const weeks = Math.max(...withMovement.map((c) => c.weeksWithWorkout));
  const type = withMovement.map((c) => c.workoutType).find((t) => t != null) ?? null;
  if (minutes === 0 && weeks === 0) return null;
  return { minutes: Math.round(minutes), weeks, type };
}

function describeExercise(ex: DaySignal['exercise']): string {
  if (!ex) return '';
  if (ex.type && ex.weeks > 0) {
    return ` — you're usually ${ex.type.toLowerCase()}ing then (${ex.weeks} of the last weeks)`;
  }
  if (ex.minutes > 0) return ` — usually ~${ex.minutes} min of movement in there`;
  return '';
}

/**
 * Find the stretches worth reporting for one weekday.
 *
 * Contiguous hours are merged so a three-hour climb reads as one stretch rather
 * than three adjacent facts. Only hours with enough weeks behind them take
 * part: an unreliable hour breaks a run rather than joining it, because
 * bridging a gap with a cell nothing has observed would invent the middle of
 * the story.
 */
export function buildDayReport(grid: DayHourGrid, weekday: number): DayReport {
  const day = grid.days.find((d) => d.weekday === weekday);
  const label = WEEKDAY_LABELS[weekday] ?? 'Today';

  if (!day || day.weeksObserved < MIN_WEEKS_FOR_REPORT) {
    return {
      weekday,
      label,
      weeksObserved: day?.weeksObserved ?? 0,
      signals: [],
      building: true,
      headline: `Not enough ${label}s on record yet to describe one.`,
    };
  }

  const inScope = day.hours.filter(
    (h) => h.hour >= REPORT_START_HOUR && h.hour <= REPORT_END_HOUR && h.reliable,
  );

  const signals: DaySignal[] = [];

  // ── sustained highs and lows ──────────────────────────────────────────────
  for (const kind of ['low', 'high'] as const) {
    const isNotable = (h: HourCell) =>
      kind === 'low'
        ? (h.lowPct ?? 0) >= NOTABLE_LOW_PCT
        : (h.highPct ?? 0) >= NOTABLE_HIGH_PCT;

    let run: HourCell[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0];
      const last = run[run.length - 1];
      const ex = exerciseFor(run);
      const weeks = Math.min(...run.map((c) => c.weeksVoted));
      const share = Math.round(
        run.reduce((a, c) => a + ((kind === 'low' ? c.lowPct : c.highPct) ?? 0), 0) / run.length,
      );
      const span =
        first.hour === last.hour
          ? formatHour(first.hour)
          : `${formatHour(first.hour)}–${formatHour(last.hour + 1)}`;
      signals.push({
        kind,
        startHour: first.hour,
        endHour: last.hour,
        fromMgdl: first.medianMgdl ?? 0,
        toMgdl: last.medianMgdl ?? 0,
        weeksVoted: weeks,
        exercise: ex,
        carbsG: Math.round(run.reduce((a, c) => a + c.carbsG, 0)),
        line:
          kind === 'low'
            ? `${span} runs low — about ${share}% of readings under ${grid.targetLowMgdl}, in ${weeks} weeks of ${label}s${describeExercise(ex)}.`
            : `${span} runs high — about ${share}% of readings over ${grid.targetHighMgdl}, in ${weeks} weeks of ${label}s${describeExercise(ex)}.`,
      });
      run = [];
    };

    for (let hour = REPORT_START_HOUR; hour <= REPORT_END_HOUR; hour += 1) {
      const cell = day.hours[hour];
      if (cell.reliable && isNotable(cell)) run.push(cell);
      else flush();
    }
    flush();
  }

  // ── sustained climbs and falls ────────────────────────────────────────────
  // Walk the reliable hours and accumulate consecutive movement in one
  // direction. This is what turns "80 at 8, 120 at 9, 150 at 10" into a single
  // "climbs 70 points between 8 and 11" rather than three separate numbers.
  let i = 0;
  while (i < inScope.length) {
    let j = i;
    let total = 0;
    let dir = 0;
    while (j + 1 < inScope.length && inScope[j + 1].hour === inScope[j].hour + 1) {
      const step = (inScope[j + 1].medianMgdl ?? 0) - (inScope[j].medianMgdl ?? 0);
      const stepDir = Math.sign(step);
      if (stepDir === 0) break;
      if (dir === 0) dir = stepDir;
      else if (stepDir !== dir) break;
      total += step;
      j += 1;
    }
    if (Math.abs(total) >= NOTABLE_SWING_MGDL && j > i) {
      // Reduce a long run to its steepest MAX_STRETCH_HOURS window, so the
      // report names the part that actually moves rather than the whole
      // afternoon it happens to sit inside.
      let run = inScope.slice(i, j + 1);
      if (run.length > MAX_STRETCH_HOURS) {
        let best = 0;
        let bestDelta = 0;
        for (let k = 0; k + MAX_STRETCH_HOURS <= run.length; k += 1) {
          const d = Math.abs(
            (run[k + MAX_STRETCH_HOURS - 1].medianMgdl ?? 0) - (run[k].medianMgdl ?? 0),
          );
          if (d > bestDelta) { bestDelta = d; best = k; }
        }
        run = run.slice(best, best + MAX_STRETCH_HOURS);
        // The trimmed window must still be a real swing on its own.
        if (bestDelta < NOTABLE_SWING_MGDL) { i = j; continue; }
      }
      const start2 = run[0];
      const end = run[run.length - 1];
      const ex = exerciseFor(run);
      const weeks = Math.min(...run.map((c) => c.weeksVoted));
      signals.push({
        kind: total > 0 ? 'climb' : 'fall',
        startHour: start2.hour,
        endHour: end.hour,
        fromMgdl: start2.medianMgdl ?? 0,
        toMgdl: end.medianMgdl ?? 0,
        weeksVoted: weeks,
        exercise: ex,
        carbsG: Math.round(run.reduce((a, c) => a + c.carbsG, 0)),
        line: `${formatHour(start2.hour)}–${formatHour(end.hour + 1)}: usually ${
          total > 0 ? 'climbs' : 'drifts down'
        } from about ${start2.medianMgdl} to ${end.medianMgdl}${describeExercise(ex)}.`,
      });
      i = j;
    } else {
      i += 1;
    }
  }

  // A dip gets reported once. The fall into a low window and the climb back out
  // of it are the same event as the low itself, and listing all three reads as
  // three findings when it is one — so a swing that substantially overlaps an
  // already-reported high or low is dropped. The window is the better
  // description because it says how often it happens, not just that it moved.
  const windows = signals.filter((s) => s.kind === 'low' || s.kind === 'high');
  const overlapHours = (a: DaySignal, b: DaySignal) =>
    Math.max(0, Math.min(a.endHour, b.endHour) - Math.max(a.startHour, b.startHour) + 1);
  const kept = signals.filter((s) => {
    if (s.kind === 'low' || s.kind === 'high') return true;
    const span = s.endHour - s.startHour + 1;
    return !windows.some((w) => overlapHours(s, w) >= Math.ceil(span / 2));
  });
  signals.length = 0;
  signals.push(...kept);

  // Strongest first: a low outranks a high, which outranks a swing, and within
  // a kind the one with more weeks behind it leads.
  const rank = { low: 0, high: 1, climb: 2, fall: 3 } as const;
  signals.sort((a, b) => rank[a.kind] - rank[b.kind] || b.weeksVoted - a.weeksVoted);

  const headline =
    signals.length === 0
      ? `${label}s look steady across the day — nothing that repeats.`
      : signals[0].line;

  return {
    weekday,
    label,
    weeksObserved: day.weeksObserved,
    signals,
    building: false,
    headline,
  };
}

/** Notification body: the top couple of signals, kept short enough to read. */
export function reportNotificationBody(report: DayReport): string {
  if (report.building) return report.headline;
  if (report.signals.length === 0) return report.headline;
  return report.signals
    .slice(0, 2)
    .map((s) => s.line)
    .join(' ');
}
