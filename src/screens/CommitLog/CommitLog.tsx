import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Section } from '@/components/Section/Section';
import { revertCommit, useCommitLog } from '@/data/commitLogStore';
import type {
  CommitLogItem,
  CommitOutcomeStatus,
  FixLogSourceKind,
} from '@/data/types';
import { ChangeHandoff } from '@/components/ChangeHandoff/ChangeHandoff';
import { handoffForCommit } from '@/lib/loop/changeSurface';
import styles from './CommitLog.module.css';

const sourceLabel: Record<FixLogSourceKind, string> = {
  insight: 'Insight',
  memory: 'Memory',
  manual: 'Manual',
};

const outcomeLabel: Record<CommitOutcomeStatus, string> = {
  tracking: 'Tracking',
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  reverted: 'Reverted',
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 6e4);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

type CommitCardProps = {
  item: CommitLogItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onRevert: (id: string) => void;
};

function CommitCard({ item, expanded, onToggle, onRevert }: CommitCardProps) {
  const reverted = item.outcome.status === 'reverted';
  const trackingPct = Math.min(
    100,
    Math.round((item.outcome.daysElapsed / item.outcome.trackingWindowDays) * 100),
  );

  return (
    <article
      className={`${styles.card} ${reverted ? styles.cardReverted : ''}`}
    >
      <header className={styles.cardHead}>
        <div className={styles.cardMeta}>
          <span className={styles.hash}>{item.shortHash}</span>
          <span className={styles.metaDot} aria-hidden>·</span>
          <span className={styles.sourceChip}>{sourceLabel[item.source]}</span>
          <span className={styles.metaDot} aria-hidden>·</span>
          <span className={styles.time}>{formatRelative(item.committedIso)}</span>
        </div>
        <span
          className={`${styles.outcomeBadge} ${styles[`outcome_${item.outcome.status}`]}`}
        >
          {outcomeLabel[item.outcome.status]}
        </span>
      </header>

      <h3 className={styles.cardTitle}>{item.title}</h3>

      <div className={styles.change}>
        <div className={styles.changeRow}>
          <span className={styles.changeLabel}>{item.change.label}</span>
          <span className={styles.changeArrow} aria-hidden>→</span>
          <span className={styles.changeProposed}>{item.change.proposedValue}</span>
        </div>
        <div className={styles.changeCurrent}>
          Was: {item.change.currentValue}
        </div>
      </div>

      <div
        className={`${styles.outcomeBlock} ${styles[`outcomeBlock_${item.outcome.status}`]}`}
      >
        {item.outcome.status === 'tracking' ? (
          <>
            <div className={styles.outcomeHead}>
              <span className={styles.outcomeTitle}>Tracking outcome</span>
              <span className={styles.outcomeDays}>
                Day {item.outcome.daysElapsed} of {item.outcome.trackingWindowDays}
              </span>
            </div>
            <div className={styles.trackBar}>
              <div
                className={styles.trackFill}
                style={{ width: `${trackingPct}%` }}
              />
            </div>
            <p className={styles.outcomeSummary}>{item.outcome.summary}</p>
          </>
        ) : (
          <>
            <div className={styles.outcomeHead}>
              <span className={styles.outcomeTitle}>
                {outcomeLabel[item.outcome.status]}
              </span>
              <span className={styles.outcomeDays}>
                After {item.outcome.trackingWindowDays}d
              </span>
            </div>
            {(item.outcome.tirDeltaPct != null ||
              item.outcome.hypoEventsDelta != null) &&
            item.outcome.status !== 'reverted' ? (
              <div className={styles.metrics}>
                {item.outcome.tirDeltaPct != null ? (
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Time in range</span>
                    <span className={styles.metricValue}>
                      {item.outcome.tirDeltaPct >= 0 ? '+' : ''}
                      {item.outcome.tirDeltaPct.toFixed(1)}%
                    </span>
                  </div>
                ) : null}
                {item.outcome.hypoEventsDelta != null ? (
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Hypo events</span>
                    <span className={styles.metricValue}>
                      {item.outcome.hypoEventsDelta >= 0 ? '+' : ''}
                      {item.outcome.hypoEventsDelta}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className={styles.outcomeSummary}>{item.outcome.summary}</p>
          </>
        )}
      </div>

      <button
        type="button"
        className={styles.whyToggle}
        onClick={() => onToggle(item.id)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide reasoning' : 'Why this?'}
        <span className={styles.whyToggleChevron} aria-hidden>
          {expanded ? '▴' : '▾'}
        </span>
      </button>

      {expanded ? (
        <div className={styles.reasoning}>
          <p className={styles.explanation}>{item.explanation}</p>
          {item.rationale.length > 0 ? (
            <ul className={styles.rationaleList}>
              {item.rationale.map((line, i) => (
                <li key={`${item.id}-r${i}`}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ChangeHandoff kind={item.change.kind} handoff={handoffForCommit(item)} />

      {!reverted ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.revertBtn}
            onClick={() => onRevert(item.id)}
          >
            Revert
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function CommitLog() {
  const items = useCommitLog();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const active = useMemo(
    () => items.filter((x) => x.outcome.status !== 'reverted'),
    [items],
  );
  const reverted = useMemo(
    () => items.filter((x) => x.outcome.status === 'reverted'),
    [items],
  );

  const summary = useMemo(() => {
    const stats = {
      tracking: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      reverted: 0,
    };
    for (const c of items) stats[c.outcome.status] += 1;
    return stats;
  }, [items]);

  const toggle = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <AppHeader title="Commit Log" showBack />
      <main className="screen">
        <div className={styles.intro}>
          <p className={styles.introText}>
            Every change you've implemented in Loop, with its outcome tracked for 14
            days. Revert anything that doesn't pan out — the inverse gets staged back
            in Fix Log.
          </p>
          <Link to="/app/fixlog" className={styles.fixLogLink}>
            <span aria-hidden>←</span>
            <span>Fix Log</span>
          </Link>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{items.length}</span>
            <span className={styles.statLabel}>Total</span>
          </div>
          <div className={`${styles.stat} ${styles.stat_tracking}`}>
            <span className={styles.statValue}>{summary.tracking}</span>
            <span className={styles.statLabel}>Tracking</span>
          </div>
          <div className={`${styles.stat} ${styles.stat_positive}`}>
            <span className={styles.statValue}>{summary.positive}</span>
            <span className={styles.statLabel}>Positive</span>
          </div>
          <div className={`${styles.stat} ${styles.stat_reverted}`}>
            <span className={styles.statValue}>{summary.reverted}</span>
            <span className={styles.statLabel}>Reverted</span>
          </div>
        </div>

        <Section
          label="History"
          title={`${active.length} active commit${active.length === 1 ? '' : 's'}`}
          description="Newest first. Outcomes evaluate after the 14-day tracking window closes."
        >
          {active.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyTitle}>No commits yet.</div>
              <div className={styles.emptyBody}>
                Implement a change from the Fix Log and it'll land here with a fresh
                14-day tracking window.
              </div>
            </div>
          ) : (
            active.map((item) => (
              <CommitCard
                key={item.id}
                item={item}
                expanded={expanded.has(item.id)}
                onToggle={toggle}
                onRevert={revertCommit}
              />
            ))
          )}
        </Section>

        {reverted.length > 0 ? (
          <Section
            label="Archive"
            title="Reverted"
            description="Rolled back — the inverse was staged in Fix Log at revert time."
          >
            {reverted.map((item) => (
              <CommitCard
                key={item.id}
                item={item}
                expanded={expanded.has(item.id)}
                onToggle={toggle}
                onRevert={revertCommit}
              />
            ))}
          </Section>
        ) : null}
      </main>
    </>
  );
}
