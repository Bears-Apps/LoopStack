import { useNavigate } from 'react-router-dom';
import { useAlertInbox } from '@/data/alertInboxStore';
import styles from './AppHeader.module.css';

// The bell, with an unread count.
//
// The badge is capped at 9+ rather than growing: past a handful the exact
// number stops meaning anything, and a three-digit badge on a health app reads
// as neglect rather than information.

export function InboxButton() {
  const navigate = useNavigate();
  const items = useAlertInbox();
  const unread = items.filter((i) => i.readIso == null).length;

  return (
    <button
      type="button"
      className={styles.iconBtn}
      aria-label={
        unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'
      }
      onClick={() => navigate('/app/inbox')}
    >
      <span className={styles.iconWrap}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 9A6 6 0 1 0 6 9c0 4.5-1.5 6-2 6.5h16c-.5-.5-2-2-2-6.5Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M10 19a2.2 2.2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
        {unread > 0 ? (
          <span className={styles.badge} aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}
