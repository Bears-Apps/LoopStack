import type { MetricsRange } from '@/data/types';
import { metricsRangeLabels } from '@/data/metrics';
import styles from './TimeRangeSelector.module.css';

const ORDER: MetricsRange[] = ['today', '7d', '14d', '30d', '90d', '180d'];

type Props = {
  value: MetricsRange;
  onChange: (range: MetricsRange) => void;
};

export function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className={styles.track} role="tablist" aria-label="Metrics time range">
      {ORDER.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.seg} ${active ? styles.segActive : ''}`}
            onClick={() => onChange(r)}
          >
            {metricsRangeLabels[r]}
          </button>
        );
      })}
    </div>
  );
}
