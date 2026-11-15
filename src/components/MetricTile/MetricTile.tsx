import type { MetricDelta } from '@/data/types';
import styles from './MetricTile.module.css';

type Props = {
  label: string;
  value: string | number;
  unit?: string;
  delta?: MetricDelta;
  deltaSuffix?: string;   // e.g. "%" or " mg/dL" appended to the delta number
  sublabel?: string;
  emphasis?: boolean;     // brand-soft treatment for a headline tile
  /** What the delta is measured against, e.g. "the prior 7 days". Read out
   *  with the chip and shown on long-press/hover — a bare "↓5" states a
   *  magnitude without ever naming the period it is a change from. */
  deltaCompare?: string;
  children?: React.ReactNode; // optional footer (e.g. a split bar)
};

export function MetricTile({
  label,
  value,
  unit,
  delta,
  deltaSuffix = '',
  sublabel,
  emphasis = false,
  deltaCompare,
  children,
}: Props) {
  // The arrow is aria-hidden, so without this the chip read as a bare number
  // to VoiceOver: "5" for a 5 mg/dL fall, with no direction and no reference.
  const deltaText = delta
    ? `${label} ${delta.value > 0 ? 'up' : 'down'} ${Math.abs(delta.value)}${
        deltaSuffix || (unit ? ` ${unit}` : '')
      }${deltaCompare ? ` vs ${deltaCompare}` : ''}`
    : '';

  return (
    <div className={`${styles.tile} ${emphasis ? styles.emphasis : ''}`}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {delta && delta.value !== 0 ? (
          <span
            className={`${styles.delta} ${styles[`delta_${delta.direction}`]}`}
            role="img"
            aria-label={deltaText}
            title={deltaText}
          >
            <span aria-hidden>{delta.value > 0 ? '↑' : '↓'}</span>
            {Math.abs(delta.value)}{deltaSuffix}
          </span>
        ) : null}
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {sublabel ? <span className={styles.sublabel}>{sublabel}</span> : null}
      {children ? <div className={styles.footer}>{children}</div> : null}
    </div>
  );
}
