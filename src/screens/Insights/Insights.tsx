import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { InboxButton } from '@/components/AppHeader/InboxButton';
import { isSample, useTimeTrends } from '@/data/sources/hooks';
import { BasalHub } from './BasalHub';
import { TuningHub } from './TuningHub';
import { AbsorptionHub } from './AbsorptionHub';
import { DayReportTab } from './DayReportTab';
import { TrendTab } from './TrendTab';
import styles from './Insights.module.css';

type InsightTab = 'basal' | 'tuning' | 'absorption' | 'day' | 'hourly';

const TABS: Array<{ id: InsightTab; label: string }> = [
  { id: 'basal', label: 'Basal' },
  { id: 'tuning', label: 'Tuning' },
  { id: 'absorption', label: 'Absorption' },
  { id: 'day', label: 'Day of week' },
  { id: 'hourly', label: 'Hourly' },
];

const DEFAULT_TAB: InsightTab = 'basal';

function isInsightTab(value: string | null): value is InsightTab {
  return value != null && TABS.some((t) => t.id === value);
}

export function Insights() {
  // Basal leads: Insights should open on insight, not on configuration. The
  // Loop settings mirror moved to Profile, where it is editable rather than
  // read-only.
  //
  // Which tab is open lives in the URL rather than in component state. Six
  // tabs behind one nav item were unreachable from anywhere else in the app,
  // and any trip out to the Fix Log and back reset the screen to Basal — so a
  // tab four across was something you re-found by hand every single time.
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: InsightTab = isInsightTab(rawTab) ? rawTab : DEFAULT_TAB;
  const setTab = useCallback(
    (next: InsightTab) => {
      setParams(
        (prev: URLSearchParams) => {
          const p = new URLSearchParams(prev);
          if (next === DEFAULT_TAB) p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        // Replace, so Back leaves Insights rather than walking the tabs the
        // user just flicked through.
        { replace: true },
      );
    },
    [setParams],
  );
  const trendsResult = useTimeTrends();
  const timeTrends = trendsResult.data;

  return (
    <>
      <AppHeader title="Insights" rightAction={<InboxButton />} />
      <main className="screen">
        <InsightTabBar tab={tab} onChange={setTab} />

        <div
          className={styles.tabPanel}
          role="tabpanel"
          id="insights-panel"
          aria-labelledby={`insights-tab-${tab}`}
        >
        {tab === 'basal' ? <BasalHub /> : null}

        {tab === 'tuning' ? <TuningHub /> : null}

        {tab === 'absorption' ? <AbsorptionHub /> : null}

        {/* The day tab is now the weekday report rather than seven bars.
            byDayOfWeek collapsed a whole day into one number, which cannot
            answer "when on Tuesdays" — the question the tab's own description
            was already implying. */}
        {tab === 'day' ? <DayReportTab /> : null}

        {tab === 'hourly' ? (
          <TrendTab
            title="Hour of day"
            description="The clock-time shape of your control. Because your carb ratio, ISF, and basal are all scheduled, a weak hour here is directly actionable."
            buckets={timeTrends?.byHourOfDay ?? []}
            targetLowMgdl={timeTrends?.targetLowMgdl ?? 70}
            targetHighMgdl={timeTrends?.targetHighMgdl ?? 180}
            layout="columns"
            sample={isSample(trendsResult)}
            loading={trendsResult.loading}
          />
        ) : null}

        </div>
      </main>
    </>
  );
}

/**
 * Five tabs, four of which fit.
 *
 * The bar scrolls, and nothing said so: at 375pt it cut off cleanly after
 * the fourth tab with the pill's rounded right edge flush against it, which
 * reads as a complete, closed control. "Day of week" and "Hourly" were two
 * whole insight views with no evidence on screen that they existed.
 *
 * Two additions, both conventional: an edge fade wherever there is more to
 * reach, and the selected tab scrolled into view so keyboard and restored
 * selections do not land off-screen. The bar itself is unchanged.
 */
function InsightTabBar({
  tab,
  onChange,
}: {
  tab: InsightTab;
  onChange: (next: InsightTab) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const syncEdges = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 });
  }, []);

  useEffect(() => {
    syncEdges();
    window.addEventListener('resize', syncEdges);
    return () => window.removeEventListener('resize', syncEdges);
  }, [syncEdges]);

  useEffect(() => {
    const el = trackRef.current;
    const active = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    syncEdges();
  }, [tab, syncEdges]);

  return (
    <div
      className={`${styles.tabBarWrap} ${edges.start ? styles.fadeStart : ''} ${
        edges.end ? styles.fadeEnd : ''
      }`}
    >
      <div
        ref={trackRef}
        className={styles.tabBar}
        role="tablist"
        aria-label="Insights views"
        onScroll={syncEdges}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
