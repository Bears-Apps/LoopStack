import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { useDayHourGrid } from '@/data/sources/hooks';
import { isSample } from '@/data/sources/hooks';
import { WEEKDAY_LABELS, type HourCell } from '@/lib/metrics/dayHourGrid';
import { buildDayReport, REPORT_START_HOUR, REPORT_END_HOUR } from '@/lib/alerts/dayReport';
import { formatHour } from '@/lib/alerts/riskWindows';
import { weekdayPatternPath } from '@/lib/metrics/weekdayHourly';
import styles from './DayReportTab.module.css';

// One weekday, hour by hour — the screen the morning notification opens into.
//
// The notification carries the two lines that fit on a lock screen; this is
// where the rest of it lives, and where a day can be looked at before it
// happens rather than after. Picking a weekday is the whole interaction: the
// strip is both the control and the answer to "which day am I looking at".
//
// Deliberately NOT a dosing screen. It describes what this weekday has done,
// with how many weeks stand behind each claim, and stops there.

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Bar colour follows the same in-range thresholds every other chart uses. */
function barColor(cell: HourCell): string {
  if (!cell.reliable || cell.inRangePct == null) return 'var(--ink-200)';
  if ((cell.lowPct ?? 0) >= 15) return 'var(--range-low)';
  if (cell.inRangePct >= 70) return 'var(--range-in)';
  if (cell.inRangePct >= 50) return 'var(--range-high)';
  return 'var(--range-low)';
}

export function DayReportTab() {
  const gridResult = useDayHourGrid();
  const grid = gridResult.data;
  const [weekday, setWeekday] = useState(() => new Date().getDay());

  const day = grid?.days.find((d) => d.weekday === weekday);
  const report = grid ? buildDayReport(grid, weekday) : null;

  const hours = (day?.hours ?? []).filter(
    (h) => h.hour >= REPORT_START_HOUR && h.hour <= REPORT_END_HOUR,
  );
  // One scale for every bar, so a tall bar means a high number rather than
  // "the tallest thing in its own row" — the per-row scaling mistake.
  const peak = Math.max(180, ...hours.map((h) => h.medianMgdl ?? 0));

  return (
    <Section
      label="Day of week"
      title={`What ${WEEKDAY_LABELS[weekday]}s usually do`}
      description="Built from every instance of this weekday in the last 12 weeks. Each hour needs several weeks behind it before it says anything — a faded bar has too little to be worth reading."
    >
      {isSample(gridResult) ? (
        <SampleNote>Example history until Apple Health has enough weeks.</SampleNote>
      ) : null}

      {/* The weekday strip: control and context in one row. */}
      <div className={styles.strip} role="tablist" aria-label="Day of week">
        {LETTERS.map((letter, i) => {
          const active = i === weekday;
          const isToday = i === new Date().getDay();
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={WEEKDAY_LABELS[i]}
              className={`${styles.day} ${active ? styles.dayActive : ''} ${
                isToday ? styles.dayToday : ''
              }`}
              onClick={() => setWeekday(i)}
            >
              {letter}
            </button>
          );
        })}
      </div>

      {report?.building ? (
        <p className={styles.building}>{report.headline}</p>
      ) : (
        <>
          {/* Signals first — the takeaway before the chart, as everywhere else. */}
          {report && report.signals.length > 0 ? (
            <ul className={styles.signals}>
              {report.signals.map((s, i) => (
                <li key={i} className={`${styles.signal} ${styles[`signal_${s.kind}`]}`}>
                  {s.line}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.building}>{report?.headline}</p>
          )}

          <div className={styles.chart}>
            {hours.map((h) => (
              <div key={h.hour} className={styles.col}>
                <div className={styles.track}>
                  <div
                    className={`${styles.bar} ${h.reliable ? '' : styles.barFaint}`}
                    style={{
                      height: `${Math.max(2, ((h.medianMgdl ?? 0) / peak) * 100)}%`,
                      background: barColor(h),
                    }}
                    title={
                      h.reliable
                        ? `${formatHour(h.hour)}: usually ${h.medianMgdl} mg/dL, ${h.weeksVoted} weeks`
                        : `${formatHour(h.hour)}: not enough weeks yet`
                    }
                  />
                  {h.weeksWithWorkout > 0 || h.exerciseMinutes > 0 ? (
                    <span className={styles.move} aria-hidden title="Usually active this hour">
                      •
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className={styles.axis}>
            {[6, 9, 12, 15, 18, 21].map((h) => (
              <span key={h}>{formatHour(h)}</span>
            ))}
          </div>
          <p className={styles.scaleNote}>
            Each bar is the median across {day?.weeksObserved ?? 0}{' '}
            {WEEKDAY_LABELS[weekday]}s. A dot marks an hour you are usually active.
            Faded bars have fewer than three weeks behind them.
          </p>
          <Link className={styles.hoursLink} to={weekdayPatternPath({ weekday })}>
            Glucose, insulin and carbs by hour ›
          </Link>
        </>
      )}
    </Section>
  );
}
