import { resolveConfidence } from '@/lib/confidence';
import type { ConfidenceLevel, ConfidenceScore } from '@/data/types';
import styles from './ConfidenceRing.module.css';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  level: ConfidenceLevel;
  score?: ConfidenceScore;
  size?: Size;
  showLabel?: boolean;      // micro-label underneath ("Learning" / "Ready")
  showPercent?: boolean;    // percent inside the ring
  ariaLabel?: string;
};

const SIZE_PX: Record<Size, number> = { sm: 36, md: 48, lg: 64 };
const STROKE_PX: Record<Size, number> = { sm: 4, md: 5, lg: 6 };
const FONT_PX: Record<Size, number> = { sm: 11, md: 13, lg: 16 };

export function ConfidenceRing({
  level,
  score,
  size = 'md',
  showLabel = false,
  showPercent = true,
  ariaLabel,
}: Props) {
  const { percent, tier, label, color } = resolveConfidence(level, score);
  const dim = SIZE_PX[size];
  const stroke = STROKE_PX[size];
  const r = (dim - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;

  return (
    <div
      className={`${styles.wrap} ${styles[`size_${size}`]}`}
      role="img"
      aria-label={ariaLabel ?? `Confidence ${percent}% — ${label}`}
    >
      <div
        className={styles.ringBox}
        style={{ width: dim, height: dim }}
      >
        <svg
          className={styles.ring}
          width={dim}
          height={dim}
          viewBox={`0 0 ${dim} ${dim}`}
        >
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            stroke="var(--ink-200)"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
          />
        </svg>
        {showPercent ? (
          <span
            className={styles.percent}
            style={{ fontSize: `${FONT_PX[size]}px`, color }}
          >
            {percent}
            <span className={styles.percentSign}>%</span>
          </span>
        ) : null}
      </div>
      {showLabel ? (
        <span
          className={`${styles.microLabel} ${styles[`tier_${tier}`]}`}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
