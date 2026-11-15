import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Section } from '@/components/Section/Section';
import {
  markAllRead,
  markRead,
  useAlertInbox,
  type InboxItem,
} from '@/data/alertInboxStore';
import { ALERT_CATEGORIES, type AlertCategory } from '@/lib/alerts/alertEngine';
import { formatClock } from '@/lib/alerts/riskWindows';
import { useFixLog } from '@/data/fixLogStore';
import { useCommitLog } from '@/data/commitLogStore';
import styles from './Inbox.module.css';

// The inbox: findings that arrived while you were not looking.
//
// Notifications are the delivery mechanism, not the record. This is the
// record — every finding the engines produced, kept until read, whether or not
// the phone was in a pocket when it fired.

const CATEGORY_LABEL: Record<AlertCategory, string> = Object.fromEntries(
  ALERT_CATEGORIES.map((c) => [c.id, c.label]),
) as Record<AlertCategory, string>;

export function Inbox() {
  const navigate = useNavigate();
  const items = useAlertInbox();
  const fixLog = useFixLog();
  const commits = useCommitLog();

  // Filing now happens in AppShell so findings accumulate under every route,
  // not only while this screen is mounted. The store dedupes on id, so the
  // inbox is a pure reader here.

  const unread = items.filter((i) => i.readIso == null);
  const staged = fixLog.filter((f) => f.status === 'staged').length;
  // Active commits, so this badge agrees with the ones on Insights and the Fix
  // Log rather than quietly counting reverted changes too.
  const activeCommitCount = commits.filter(
    (c) => c.outcome.status !== 'reverted',
  ).length;
  const codeChanges = commits.filter((c) => c.change.kind === 'absorption_window').length;

  const grouped = useMemo(() => {
    const out = new Map<string, InboxItem[]>();
    for (const item of items) {
      const key = dayKey(item.seenIso);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(item);
    }
    return [...out.entries()];
  }, [items]);

  return (
    <>
      <AppHeader
        title="Inbox"
        showBack
        rightAction={
          unread.length > 0 ? (
            <button type="button" className={styles.markAll} onClick={markAllRead}>
              Mark all read
            </button>
          ) : null
        }
      />
      <main className="screen">
        {/* ── where decisions land ── */}
        {staged > 0 || codeChanges > 0 ? (
          <Section
            label="Waiting on you"
            title="Changes you've staged"
            description="LoopStack never edits Loop. These are the changes you decided were worth making — settings go into Loop's own screens, source changes need a rebuild."
          >
            <div className={styles.routes}>
              <button
                type="button"
                className={styles.route}
                onClick={() => navigate('/app/fixlog')}
              >
                <span className={styles.routeCount}>{staged}</span>
                <span className={styles.routeCopy}>
                  <span className={styles.routeLabel}>In the Fix Log</span>
                  <span className={styles.routeDesc}>
                    Staged, not yet done anywhere
                  </span>
                </span>
                <span className={styles.cobChevron} aria-hidden>
                  →
                </span>
              </button>
              <button
                type="button"
                className={styles.route}
                onClick={() => navigate('/app/commitlog')}
              >
                <span className={styles.routeCount}>{activeCommitCount}</span>
                <span className={styles.routeCopy}>
                  <span className={styles.routeLabel}>Committed</span>
                  <span className={styles.routeDesc}>
                    Made in Loop, outcome tracked for 14 days
                  </span>
                </span>
                <span className={styles.cobChevron} aria-hidden>
                  →
                </span>
              </button>
            </div>
          </Section>
        ) : null}

        {/* ── findings ── */}
        {items.length === 0 ? (
          <Section label="Findings" title="Nothing yet">
            <p className={styles.empty}>
              Findings land here as the engines reach confidence — a recurring
              window, a reading that became trustworthy, a stream that went
              quiet. Nothing has crossed that line yet.
            </p>
          </Section>
        ) : (
          grouped.map(([day, dayItems]) => (
            // Label only. Passing the same string as both label and title
            // printed the day twice — "TODAY" in eyebrow caps, then "Today" at
            // 22px directly under it — on every group in the list.
            <Section key={day} label={day}>
              <div className={styles.items}>
                {dayItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.item} ${item.readIso == null ? styles.itemUnread : ''}`}
                    onClick={() => {
                      markRead(item.id);
                      if (item.route) navigate(item.route);
                    }}
                  >
                    <div className={styles.itemHead}>
                      <span className={styles.itemTitle}>
                        {item.readIso == null ? (
                          // aria-label on a bare <span> is not exposed — a
                          // generic element with no role is ignored, so the
                          // only unread marker in the list was invisible to
                          // VoiceOver.
                          <span className={styles.dot} role="img" aria-label="Unread" />
                        ) : null}
                        {item.title}
                      </span>
                      <span className={styles.itemWhen}>
                        {formatClock(new Date(item.seenIso))}
                      </span>
                    </div>
                    <p className={styles.itemBody}>{item.body}</p>
                    <span className={styles.itemCategory}>
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                    {item.route ? <span className={styles.itemLink}>See the hours ›</span> : null}
                  </button>
                ))}
              </div>
            </Section>
          ))
        )}
      </main>

    </>
  );
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
