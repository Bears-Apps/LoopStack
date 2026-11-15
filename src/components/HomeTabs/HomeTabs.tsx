import styles from './HomeTabs.module.css';

// Three lenses on one screen, rather than one undifferentiated scroll.
//
// The home screen mixed a live reading, week-scale aggregates, therapy
// structure and today's activity in a single column, so every visit scrolled
// past four unrelated time-scales to reach any one of them. Tabs segment the
// ANALYSIS without deleting anything — which matters, because none of these
// tools were the problem; their arrangement was.
//
// What deliberately does NOT live in a tab: the glucose hero, carbs on board,
// and the staged-changes strip. Those answer "am I safe", "is something
// absorbing" and "does anything need me" — the three questions worth asking on
// every open — and hiding any of them behind a tap would be a regression, not
// an organisation. Only the parts you read occasionally are segmented.

export type HomeTab = 'overview' | 'treatment' | 'patterns';

export const HOME_TABS: { id: HomeTab; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'How control is going' },
  { id: 'treatment', label: 'Treatment', hint: 'What insulin and carbs went in' },
  { id: 'patterns', label: 'Patterns', hint: 'What repeats, and when' },
];

export function HomeTabs({
  tab,
  onChange,
}: {
  tab: HomeTab;
  onChange: (next: HomeTab) => void;
}) {
  return (
    <div className={styles.bar} role="tablist" aria-label="Home views">
      {HOME_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-label={`${t.label} — ${t.hint}`}
          className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
