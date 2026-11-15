import { useEffect, useRef, useState } from 'react';
import {
  useCurrentGlucose,
  useAutosens,
  useAutotune,
  useAbsorptionInsights,
  useBasalInsights,
  useRecentGlucose,
  useRiskWindows,
  useDayHourGrid,
  useSettingsReview,
} from '@/data/sources/hooks';
import { loadNotificationPrefs } from '@/data/notificationPrefs';
import { detectNewlyReadable } from '@/data/alertStateStore';
import { buildAlerts, collectConfidenceSignals, type PendingAlert } from './alertEngine';
import { syncScheduledAlerts } from './notificationScheduler';

// Keeps the OS notification queue in step with what the engines currently say.
//
// Runs whenever the analysis changes, which is exactly when the answer might
// have changed too — a new week of data can create a risk window, close one,
// or move a reading into confidence.
//
// The scheduling side effect is deliberately kept out of the data sources.
// Sources compute; this decides what to do about it. That separation is why
// `buildAlerts` stays a pure function that tests can drive without a phone.

/** Don't re-schedule more often than this. Refreshes can arrive in bursts, and
 *  each sync cancels and re-queues the whole set. A change inside the interval
 *  is synced when it ends rather than dropped: dropping it is how the heads-ups
 *  went missing. The first sync of a launch ran against the empty snapshot,
 *  cancelling every weekly heads-up and morning report already queued; the
 *  grid arrived seconds later, inside the interval, and was never synced, so
 *  the OS queue kept the empty set until something else changed a minute on. */
const MIN_SYNC_INTERVAL_MS = 60_000;

export type AlertSchedulerState = {
  /** What would be scheduled right now, whether or not the OS accepted it. */
  alerts: PendingAlert[];
  /** How many the OS actually queued; null when unavailable or not granted. */
  scheduledCount: number | null;
};

export function useAlertScheduler(): AlertSchedulerState {
  const riskWindows = useRiskWindows();
  const settings = useSettingsReview();
  const absorption = useAbsorptionInsights();
  const basal = useBasalInsights();
  const autosens = useAutosens();
  const autotune = useAutotune();
  const glucose = useRecentGlucose();
  const dayHourGrid = useDayHourGrid();
  const current = useCurrentGlucose();

  const [state, setState] = useState<AlertSchedulerState>({
    alerts: [],
    scheduledCount: null,
  });
  const lastSyncRef = useRef(0);
  const pendingRef = useRef<PendingAlert[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const prefs = loadNotificationPrefs();
    // Built from the CATEGORY switches alone, ignoring the master switch, so
    // the settings screen can show what would arrive before permission is
    // granted. Only the scheduling below is gated on the master switch —
    // asking someone to allow notifications without showing what they are
    // agreeing to is the thing this preview exists to avoid.
    const enabled = prefs.categories;

    // Confidence transitions are only meaningful once the analysis has
    // actually produced something; checking against a still-loading snapshot
    // would record "nothing is readable" as the baseline and then announce
    // everything a second later.
    const analysisReady = settings.data != null || absorption.data != null;
    const newlyReadable = analysisReady
      ? detectNewlyReadable(
          collectConfidenceSignals({
            settings: settings.data,
            absorption: absorption.data,
            riskWindows: riskWindows.data ?? [],
          }),
        )
      : [];

    const readings = glucose.data ?? [];
    const alerts = buildAlerts({
      riskWindows: riskWindows.data ?? [],
      newlyReadable,
      basal: basal.data,
      autosens: autosens.data,
      autotune: autotune.data,
      latestGlucoseIso: readings.length > 0 ? readings[readings.length - 1].iso : null,
      enabled,
      now: new Date(),
      dayHourGrid: dayHourGrid.data,
      reportAt: prefs.reportAt,
    });

    setState((prev) => ({ ...prev, alerts }));

    if (!prefs.enabled) return;
    // Nothing reaches the OS until the analysis has loaded. Every sync
    // replaces the whole queue, so syncing the empty launch snapshot cancels
    // the weekly heads-ups and queues a false "stopped receiving glucose".
    // A source that failed outright still syncs, so data health can say so.
    const ready = dayHourGrid.data != null || glucose.error != null || current.error != null;
    if (!ready) return;

    pendingRef.current = alerts;
    const flush = () => {
      timerRef.current = null;
      const next = pendingRef.current;
      if (!next) return;
      pendingRef.current = null;
      lastSyncRef.current = Date.now();
      void syncScheduledAlerts(next).then((count) => {
        if (mountedRef.current) setState({ alerts: next, scheduledCount: count });
      });
    };
    const wait = MIN_SYNC_INTERVAL_MS - (Date.now() - lastSyncRef.current);
    if (wait <= 0) flush();
    else if (!timerRef.current) timerRef.current = setTimeout(flush, wait);
  }, [
    riskWindows.data,
    settings.data,
    absorption.data,
    basal.data,
    autosens.data,
    autotune.data,
    glucose.data,
    glucose.error,
    current.error,
    // The morning report and the heads-ups are built from the grid.
    dayHourGrid.data,
  ]);

  return state;
}
