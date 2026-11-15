import { useNavigate } from 'react-router-dom';
import { Wordmark } from '@/components/Wordmark/Wordmark';
import styles from './AppHeader.module.css';

type Props = {
  title?: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
  /** Sits between the wordmark and the actions. Used for the sample scope
   *  pill, which replaced a static date label — the date never changed within
   *  a session, while the scope is the one thing on the header worth reading. */
  centerAction?: React.ReactNode;
  dateLabel?: string;
};

export function AppHeader({ title, showBack = false, rightAction, centerAction, dateLabel }: Props) {
  const navigate = useNavigate();

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {showBack ? (
          <button
            className={styles.backBtn}
            aria-label="Back"
            onClick={() => navigate(-1)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M12.5 4L6.5 10L12.5 16"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <Wordmark size="sm" />
        )}
      </div>

      <div className={styles.center}>
        {title ? <span className={styles.title}>{title}</span> : null}
      </div>

      <div className={styles.right}>
        {centerAction}
        {dateLabel ? <span className={styles.date}>{dateLabel}</span> : null}
        {rightAction}
      </div>
    </header>
  );
}
