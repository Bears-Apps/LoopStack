import type { MetricsRange } from '@/data/types';
import { WEEKDAY_LABELS } from '@/lib/metrics/dayHourGrid';

// What the screen is looking at.
//
// Three controls used to answer one question and none of them said so. A range
// selector governed some cards and not others, a day stepper walked one day at
// a time, and the day-of-week view lived on its own screen entirely — so
// "how have my Tuesdays been lately" required knowing which of the three to
// reach for, and the answer was: none of them, it is a fourth screen.
//
// A scope is one object naming both halves of the question:
//
//   WHICH DAYS   today | every Tuesday | a contiguous span
//   HOW FAR BACK the window those days are drawn from
//
// The second half is the part worth having. Widening from 4 weeks of Tuesdays
// to 26 is not a display preference — it trades responsiveness for confidence,
// and which one you want depends on whether you are checking a routine or
// checking a change you just made. The picker says that rather than leaving it
// to be inferred from a number.

export type SampleScope =
  | { kind: 'today' }
  /** Every instance of one weekday inside `windowDays`. Non-contiguous. */
  | { kind: 'weekday'; weekday: number; windowDays: number }
  /** A contiguous span ending now. */
  | { kind: 'range'; range: MetricsRange }
  /** Explicit dates, inclusive, local days. */
  | { kind: 'dates'; startIso: string; endIso: string };

export const DEFAULT_SCOPE: SampleScope = { kind: 'range', range: '7d' };

/** Window presets for the weekday mode, in weeks. */
export const WEEKDAY_WINDOWS = [4, 12, 26] as const;

const DAY_MS = 24 * 3600_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The span a scope draws from. For `weekday` this is the OUTER window — the
 * days inside it are then filtered to that weekday, which is why a scope
 * cannot be reduced to a start and an end alone.
 */
export function scopeWindow(scope: SampleScope, now: Date): { startMs: number; endMs: number } {
  const endMs = now.getTime();
  switch (scope.kind) {
    case 'today':
      return { startMs: startOfDay(now).getTime(), endMs };
    case 'weekday':
      return { startMs: endMs - scope.windowDays * DAY_MS, endMs };
    case 'range': {
      const days =
        scope.range === 'today' ? 1 : parseInt(scope.range.replace('d', ''), 10) || 7;
      return { startMs: endMs - days * DAY_MS, endMs };
    }
    case 'dates': {
      const s = new Date(scope.startIso).getTime();
      const e = new Date(scope.endIso).getTime();
      // Tolerate a reversed pair rather than returning an empty window: a
      // date picker that lets you choose the end first should not silently
      // produce a screen with no data in it.
      return { startMs: Math.min(s, e), endMs: Math.max(s, e) + DAY_MS };
    }
  }
}

/** Does a timestamp belong to this scope's sample? */
export function scopeIncludes(scope: SampleScope, ms: number, now: Date): boolean {
  const { startMs, endMs } = scopeWindow(scope, now);
  if (ms < startMs || ms > endMs) return false;
  if (scope.kind === 'weekday') return new Date(ms).getDay() === scope.weekday;
  return true;
}

/** The pill label in the header. Short enough to sit beside the wordmark. */
export function scopeLabel(scope: SampleScope): string {
  switch (scope.kind) {
    case 'today':
      return 'Today';
    case 'weekday':
      return `${WEEKDAY_LABELS[scope.weekday]}s`;
    case 'range':
      return scope.range === 'today' ? 'Today' : `Last ${scope.range.replace('d', '')} days`;
    case 'dates': {
      const fmt = (iso: string) =>
        new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `${fmt(scope.startIso)} – ${fmt(scope.endIso)}`;
    }
  }
}

/**
 * What the sample actually resolved to, for the line under the picker.
 *
 * Deliberately reports COVERAGE rather than the request. A 26-week window over
 * eleven weeks of history is eleven weeks, and saying "26 weeks" there would be
 * the same class of error as labelling 90 days of readings "180 days" — the
 * mistake the metrics layer already had to be fixed for.
 */
export function describeScopeCoverage(
  scope: SampleScope,
  timestamps: number[],
  now: Date,
): string {
  const inScope = timestamps.filter((ms) => scopeIncludes(scope, ms, now));
  if (inScope.length === 0) return 'No readings in this sample yet.';

  const earliest = new Date(Math.min(...inScope));
  const since = earliest.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (scope.kind === 'weekday') {
    const days = new Set(inScope.map((ms) => startOfDay(new Date(ms)).toISOString()));
    const label = WEEKDAY_LABELS[scope.weekday];
    return days.size === 1
      ? `1 ${label} so far, since ${since}.`
      : `${days.size} ${label}s, back to ${since}.`;
  }
  if (scope.kind === 'today') return `${inScope.length} readings today.`;

  const days = new Set(inScope.map((ms) => startOfDay(new Date(ms)).toISOString()));
  return `${days.size} days of readings, back to ${since}.`;
}

/**
 * The contiguous window a scope reads aggregates from.
 *
 * Metrics are precomputed per MetricsRange, and a weekday scope still needs a
 * span to draw from — "Tuesdays over 12 weeks" reads its aggregates from the
 * 90-day bucket and filters to Tuesdays for the parts that can be filtered.
 * Rounding to the nearest available bucket rather than inventing one keeps a
 * single source of truth for every figure on the screen.
 */
export function scopeToRange(scope: SampleScope): MetricsRange {
  switch (scope.kind) {
    case 'today':
      return 'today';
    case 'range':
      return scope.range;
    case 'weekday':
    case 'dates': {
      const days =
        scope.kind === 'weekday'
          ? scope.windowDays
          : Math.round(
              Math.abs(
                new Date(scope.endIso).getTime() - new Date(scope.startIso).getTime(),
              ) / DAY_MS,
            );
      const buckets: [number, MetricsRange][] = [
        [1, 'today'], [7, '7d'], [14, '14d'], [30, '30d'], [90, '90d'], [180, '180d'],
      ];
      // Round UP to the first bucket that covers the span, so a sample is never
      // read from a window shorter than the one it asked for.
      return (buckets.find(([d]) => days <= d) ?? buckets[buckets.length - 1])[1];
    }
  }
}
