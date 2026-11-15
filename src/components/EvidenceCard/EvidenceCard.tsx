import { useState } from 'react';
import styles from './EvidenceCard.module.css';

type Props = {
  title: string;
  summary: string;
  body: React.ReactNode;
  defaultOpen?: boolean;
};

export function EvidenceCard({ title, summary, body, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className={styles.headerText}>
          <span className={styles.title}>{title}</span>
          <span className={styles.summary}>{summary}</span>
        </div>
        <span className={`${styles.chevron} ${open ? styles.open : ''}`} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? <div className={styles.body}>{body}</div> : null}
    </div>
  );
}
