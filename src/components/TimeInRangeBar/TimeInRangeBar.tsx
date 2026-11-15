import type { MetricDelta, TimeInRangeBands } from '@/data/types';
import styles from './TimeInRangeBar.module.css';

type Band = { key: keyof TimeInRangeBands; label: string; cls: string };

// Ordered low → high so the stacked bar reads bottom-of-range to top-of-range.
const BANDS: Band[] = [
  { key: 'veryLow', label: 'Very low', cls: styles.segVeryLow },
  { key: 'low', label: 'Low', cls: styles.segLow },
  { key: 'inRange', label: 'In range', cls: styles.segIn },
  { key: 'high', label: 'High', cls: styles.segHigh },
  { key: 'veryHigh', label: 'Very high', cls: styles.segVeryHigh },
];

type Props = {
  tir: TimeInRangeBands;
  delta?: MetricDelta;
  /** The in-range boundaries these bands were scored against — the user's own
   *  target from Profile → Targets. Labelling a fixed "70–180" while the bands
   *  were counted against something else is the one thing this must not do. */
  targetLowMgdl: number;
  targetHighMgdl: number;
  /** Urgent-low boundary from Profile → Targets. Defaults to consensus 54. */
  urgentLowMgdl?: number;
  /** What the delta chip is measured against, e.g. "the prior 7 days". */
  deltaCompare?: string;
};

export function TimeInRangeBar({
  tir,
  delta,
  targetLowMgdl,
  targetHighMgdl,
  urgentLowMgdl = 54,
  deltaCompare,
}: Props) {
  // The arrow is aria-hidden; without a label the chip reads as a bare "3".
  const deltaText = delta
    ? `Time in range ${delta.value > 0 ? 'up' : 'down'} ${Math.abs(delta.value)}%${
        deltaCompare ? ` vs ${deltaCompare}` : ''
      }`
    : '';
  // The high bands are consensus thresholds; the urgent-low line follows the
  // user's own setting, so the legend must read it rather than assume 54.
  const bandHint: Record<keyof TimeInRangeBands, string> = {
    veryLow: `under ${urgentLowMgdl}`,
    low: `${urgentLowMgdl}–${targetLowMgdl}`,
    inRange: `${targetLowMgdl}–${targetHighMgdl}`,
    high: `${targetHighMgdl}–250`,
    veryHigh: 'over 250',
  };

  return (
    <section className={styles.card} aria-label="Time in range">
      <div className={styles.head}>
        <span className={styles.label}>Time in range</span>
        {delta && delta.value !== 0 ? (
          <span
            className={`${styles.delta} ${styles[`delta_${delta.direction}`]}`}
            role="img"
            aria-label={deltaText}
            title={deltaText}
          >
            <span aria-hidden>{delta.value > 0 ? '↑' : '↓'}</span>
            {Math.abs(delta.value)}%
          </span>
        ) : null}
      </div>

      <div className={styles.headline}>
        <span className={styles.big}>{tir.inRange}</span>
        <span className={styles.bigUnit}>%</span>
        <span className={styles.target}>
          {targetLowMgdl}–{targetHighMgdl} mg/dL
        </span>
      </div>

      {/* A percentage is only comparable to Clarity, Loop, or a clinic report
          if the band matches. Scoring against a narrower band than the 70–180
          consensus makes this figure read low against every other report the
          user sees, with nothing on the card to explain the gap — and the
          Profile screen that sets it described the field as "what Loop is
          running", which invites entering a correction-range low here. Stated
          on the card so a screenshot of it explains itself. */}
      {targetLowMgdl !== 70 || targetHighMgdl !== 180 ? (
        <p className={styles.bandNote}>
          Your band. Standard reports score 70–180, so this is not directly
          comparable to Clarity or a clinic report.
        </p>
      ) : null}

      <div
        className={styles.bar}
        role="img"
        aria-label={`Target ${targetLowMgdl} to ${targetHighMgdl} mg/dL. Very low ${tir.veryLow}%, low ${tir.low}%, in range ${tir.inRange}%, high ${tir.high}%, very high ${tir.veryHigh}%`}
      >
        {BANDS.map((b) =>
          tir[b.key] > 0 ? (
            <div key={b.key} className={b.cls} style={{ width: `${tir[b.key]}%` }} />
          ) : null,
        )}
      </div>

      <div className={styles.legend}>
        {BANDS.map((b) => (
          <span key={b.key} className={styles.legendItem}>
            <span className={`${styles.dot} ${b.cls}`} />
            <span className={styles.legendLabel}>{b.label}</span>
            <span className={styles.legendHint}>{bandHint[b.key]}</span>
            <span className={styles.legendVal}>{tir[b.key]}%</span>
          </span>
        ))}
      </div>
    </section>
  );
}
