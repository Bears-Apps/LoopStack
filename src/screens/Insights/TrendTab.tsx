import { SampleNote } from '@/components/SampleTag/SampleTag';
import type { TrendBucket } from '@/lib/metrics/timeTrends';
import { worstBucket } from '@/lib/metrics/timeTrends';
import styles from './Insights.module.css';

type Props = {
  title: string;
  description: string;
  buckets: TrendBucket[];
  targetLowMgdl: number;
  targetHighMgdl: number;
  /** Rows read best for 7 days; columns for 24 hours. */
  layout: 'rows' | 'columns';
  sample: boolean;
  loading: boolean;
};

// A bucket needs this many readings before its bar is drawn at full strength;
// below it the bar is muted so thin data does not read as a confident trend.
const MIN_READINGS = 12;

function barColor(inRangePct: number): string {
  if (inRangePct >= 70) return 'var(--range-in)';
  if (inRangePct >= 50) return 'var(--range-high)';
  return 'var(--range-low)';
}

export function TrendTab({
  title,
  description,
  buckets,
  targetLowMgdl,
  targetHighMgdl,
  layout,
  sample,
  loading,
}: Props) {
  const hasData = buckets.some((b) => b.readingCount > 0);

  if (!hasData) {
    return (
      <section className={styles.trendCard}>
        <h2 className={styles.trendTitle}>{title}</h2>
        <p className={styles.trendEmpty}>
          {loading
            ? 'Reading your glucose history…'
            : 'No glucose history yet — trends appear once a connected source has readings.'}
        </p>
      </section>
    );
  }

  const worst = worstBucket(buckets, MIN_READINGS);

  return (
    <section className={styles.trendCard}>
      <div className={styles.trendHead}>
        <h2 className={styles.trendTitle}>{title}</h2>
        <p className={styles.trendDesc}>{description}</p>
      </div>

      {worst ? (
        <p className={styles.trendCallout}>
          <strong>{worst.label}</strong> runs lowest in range at{' '}
          <strong>{worst.inRangePct}%</strong>
          {worst.highPct >= worst.lowPct
            ? ` — mostly time high (${worst.highPct}%).`
            : ` — mostly time low (${worst.lowPct}%).`}{' '}
          Worth checking your settings for that window.
        </p>
      ) : null}

      <div className={layout === 'columns' ? styles.trendColumns : styles.trendRows}>
        {buckets.map((b) => (
          <BucketMark
            key={b.key}
            bucket={b}
            layout={layout}
            faded={b.readingCount < MIN_READINGS}
            highlight={worst?.key === b.key}
          />
        ))}
      </div>

      <p className={styles.trendScale}>
        Bar = % of readings in {targetLowMgdl}–{targetHighMgdl} mg/dL. Faded bars
        have too few readings to trust yet.
        {layout === 'rows'
          ? ' The right-hand figure is that day’s average glucose, in mg/dL.'
          : ''}
      </p>

      {sample ? <SampleNote>Trend figures are example data.</SampleNote> : null}
    </section>
  );
}

function BucketMark({
  bucket,
  layout,
  faded,
  highlight,
}: {
  bucket: TrendBucket;
  layout: 'rows' | 'columns';
  faded: boolean;
  highlight: boolean;
}) {
  const pct = bucket.readingCount > 0 ? bucket.inRangePct : 0;
  const color = barColor(bucket.inRangePct);
  const label = `${bucket.label}: ${
    bucket.readingCount > 0 ? `${bucket.inRangePct}% in range, avg ${bucket.avgMgdl}` : 'no data'
  }`;

  if (layout === 'columns') {
    return (
      // aria-label needs a role to be exposed on a generic element.
      <div
        className={`${styles.colItem} ${highlight ? styles.colItemHi : ''}`}
        title={label}
        role="img"
        aria-label={label}
      >
        <div className={styles.colTrack}>
          <div
            className={styles.colFill}
            style={{
              height: `${pct}%`,
              background: color,
              opacity: faded ? 0.35 : 1,
            }}
          />
        </div>
        <span className={styles.colLabel}>{bucket.label}</span>
      </div>
    );
  }

  return (
    <div
      className={`${styles.rowItem} ${highlight ? styles.rowItemHi : ''}`}
      title={label}
      role="img"
      aria-label={label}
    >
      <span className={styles.rowLabel}>{bucket.label}</span>
      <span className={styles.rowTrack}>
        <span
          className={styles.rowFill}
          style={{ width: `${pct}%`, background: color, opacity: faded ? 0.35 : 1 }}
        />
      </span>
      <span className={styles.rowValue}>
        {bucket.readingCount > 0 ? `${bucket.inRangePct}%` : '—'}
      </span>
      <span className={styles.rowAvg}>
        {bucket.avgMgdl != null ? `${bucket.avgMgdl}` : ''}
      </span>
    </div>
  );
}
