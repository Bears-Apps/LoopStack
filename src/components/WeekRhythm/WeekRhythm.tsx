import { SampleTag } from '@/components/SampleTag/SampleTag';
import type { DayRhythm } from '@/lib/metrics/timeTrends';
import type { MetricsRange } from '@/data/types';
import styles from './WeekRhythm.module.css';

type Props = {
  days: DayRhythm[];
  /** Drives the heading and the takeaway's wording. */
  range?: MetricsRange;
  sample?: boolean;
  /**
   * The dashboard's own time-in-range figure for this window.
   *
   * The takeaway used to compute its own average — an unweighted mean of each
   * day's already-rounded percentage — while the card three above it pooled
   * every reading in the window. Both were correct as written and they
   * disagreed on screen: the header read 85% while this strip said 91%, which
   * is what "the time in range isn't aligning" reported.
   *
   * Mean-of-daily-means diverges from a pooled percentage whenever days carry
   * unequal reading counts, and today's partial day counted as a full day's
   * vote here while barely moving the pooled figure. Rather than pick the
   * better estimator, the sentence now quotes the one number the screen
   * already shows, so the two cannot drift apart again. The rings stay
   * per-day, which is what they are for.
   */
  pooledInRangePct?: number;
};

// A ring's fill color follows the same TIR thresholds the Hourly/Day tabs use,
// so "green day" means the same thing everywhere. Semantic, never the brand
// accent — a day is not an action.
function ringColor(tir: number): string {
  if (tir >= 70) return 'var(--range-in)';
  if (tir >= 50) return 'var(--range-high)';
  return 'var(--range-low)';
}

const RADIUS = 13;
const CIRC = 2 * Math.PI * RADIUS;

function Ring({ day }: { day: DayRhythm }) {
  const empty = day.tirPct == null;
  const tir = day.tirPct ?? 0;
  const color = empty ? 'var(--ink-200)' : ringColor(tir);
  const dash = empty ? 0 : (CIRC * tir) / 100;

  return (
    <svg viewBox="0 0 32 32" className={styles.ring} aria-hidden>
      <circle cx="16" cy="16" r={RADIUS} fill="none" stroke="var(--ink-200)" strokeWidth="3.5" />
      {!empty ? (
        <circle
          cx="16"
          cy="16"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRC - dash + 1}`}
          transform="rotate(-90 16 16)"
        />
      ) : null}
      <text
        x="16"
        y="19.5"
        textAnchor="middle"
        className={styles.ringText}
        fill={empty ? 'var(--ink-300)' : 'var(--ink-900)'}
      >
        {empty ? '·' : tir}
      </text>
    </svg>
  );
}

const RANGE_HEADING: Record<MetricsRange, string> = {
  today: 'Today',
  '3d': 'Last 3 days',
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '180d': 'Last 180 days',
};

/**
 * One plain sentence over the strip — the "takeaway before the data" rule.
 * Wording follows the window: a weekday can only be named when a mark is
 * actually one day, so wider windows name the weakest stretch by its date.
 */
function takeaway(
  days: DayRhythm[],
  range: MetricsRange,
  pooledInRangePct?: number,
): string {
  const done = days.filter((d) => d.tirPct != null);
  const heading = RANGE_HEADING[range].toLowerCase();
  if (done.length === 0) return `No readings in the ${heading} yet.`;

  // Quote the dashboard's figure when we have it; fall back to the day-mean
  // only when this strip renders without one (sample fixtures, tests).
  const avg =
    pooledInRangePct != null
      ? Math.round(pooledInRangePct)
      : Math.round(done.reduce((a, d) => a + (d.tirPct ?? 0), 0) / done.length);
  const daily = (days[0]?.spanDays ?? 1) === 1;
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // A completed segment that clearly dragged the window down, when there is one.
  const past = done.filter((d) => !d.isToday);
  const worst = past.length > 0
    ? past.reduce((w, d) => ((d.tirPct ?? 0) < (w.tirPct ?? 0) ? d : w))
    : null;

  const coveredDays = done.reduce((a, d) => a + (d.spanDays ?? 1), 0);
  const base =
    done.length === 1
      ? `${avg}% in range so far.`
      : daily
        ? `${avg}% in range over ${coveredDays} days.`
        : `${avg}% in range over the ${heading}.`;
  // "Averaging" was accurate for a mean of daily scores and would misdescribe
  // the pooled figure, which weights every reading equally rather than every
  // day — so the verb is gone rather than reused.

  if (worst && (worst.tirPct ?? 0) <= avg - 15) {
    const who = daily
      ? weekdays[new Date(worst.dateIso).getDay() === 0 ? 6 : new Date(worst.dateIso).getDay() - 1]
      : `The stretch from ${worst.label}`;
    return daily
      ? `${base} ${who} slipped to ${worst.tirPct}%.`
      : `${base} ${who} slipped to ${worst.tirPct}%.`;
  }
  return base;
}

export function WeekRhythm({ days, range = '7d', sample = false, pooledInRangePct }: Props) {
  const done = days.filter((d) => d.tirPct != null).length;

  return (
    <section className={styles.card} aria-label={`${RANGE_HEADING[range]} rhythm`}>
      <div className={styles.head}>
        <span className={styles.kicker}>{RANGE_HEADING[range]}</span>
        {/* The shared tag, not a local copy of it. This card drew its own
            solid-bordered pill while every other surface used the dashed
            SampleTag — two visual treatments for one claim teaches the reader
            that they mean two different things. */}
        {sample ? <SampleTag /> : null}
      </div>

      <p className={styles.takeaway}>{takeaway(days, range, pooledInRangePct)}</p>

      <div
        className={styles.week}
        role="img"
        aria-label={
          done === 0
            ? `No readings in the ${RANGE_HEADING[range].toLowerCase()} yet`
            : days
                .filter((d) => d.tirPct != null)
                .map((d) => `${d.label} ${d.tirPct}% in range`)
                .join(', ')
        }
      >
        {days.map((d) => (
          <div
            key={d.index}
            className={`${styles.day} ${d.isToday ? styles.today : ''} ${
              d.isFuture ? styles.future : ''
            }`}
          >
            <Ring day={d} />
            <span className={styles.dayLabel}>{d.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
