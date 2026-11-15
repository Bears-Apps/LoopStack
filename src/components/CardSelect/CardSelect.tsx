import styles from './CardSelect.module.css';

type Option<T extends string | number> = {
  value: T;
  label: string;
  hint?: string;
};

type Props<T extends string | number> = {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
};

export function CardSelect<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: Props<T>) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.card} ${active ? styles.active : ''}`}
            onClick={() => onChange(opt.value)}
          >
            <span className={styles.label}>{opt.label}</span>
            {opt.hint ? <span className={styles.hint}>{opt.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
