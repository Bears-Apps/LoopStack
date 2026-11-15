import { useEffect, useState } from 'react';
import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { isSample, useRiskWindows } from '@/data/sources/hooks';
import {
  activeCategories,
  loadNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '@/data/notificationPrefs';
import { ALERT_CATEGORIES, type AlertCategory } from '@/lib/alerts/alertEngine';
import { formatClock } from '@/lib/alerts/riskWindows';
import {
  cancelAllAlerts,
  checkPermission,
  notificationsAvailable,
  requestPermission,
  sendTestNotification,
  type PermissionState,
} from '@/lib/alerts/notificationScheduler';
import { useAlertScheduler } from '@/lib/alerts/useAlertScheduler';
import styles from './NotificationSettings.module.css';

// Notifications, with the queue itself on display.
//
// The list at the bottom is the point. A notification setting that only offers
// switches asks a person to guess what turning one on will do to their week;
// showing the actual queued alerts — the same objects the scheduler hands to
// iOS — makes the choice concrete.

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadNotificationPrefs);
  const [permission, setPermission] = useState<PermissionState>('prompt');
  const [testSent, setTestSent] = useState(false);
  const windowsResult = useRiskWindows();
  const { alerts, scheduledCount } = useAlertScheduler();

  useEffect(() => {
    void checkPermission().then(setPermission);
  }, []);

  const persist = (next: NotificationPrefs) => {
    setPrefs(next);
    saveNotificationPrefs(next);
  };

  const enableNotifications = async () => {
    const result = await requestPermission();
    setPermission(result);
    if (result === 'granted') persist({ ...prefs, enabled: true });
  };

  const disableNotifications = async () => {
    persist({ ...prefs, enabled: false });
    await cancelAllAlerts();
  };

  const toggleCategory = (id: AlertCategory) => {
    persist({
      ...prefs,
      categories: { ...prefs.categories, [id]: !prefs.categories[id] },
    });
  };

  const runTest = async () => {
    const ok = await sendTestNotification();
    setTestSent(ok);
    if (ok) setTimeout(() => setTestSent(false), 4000);
  };

  const live = activeCategories(prefs);
  const unavailable = !notificationsAvailable();
  const windows = windowsResult.data ?? [];

  return (
    <>
      <Section
        label="Alerts"
        title="Notifications"
        description="Heads-up notices about patterns LoopStack has measured — a recurring window coming up, a reading that just became trustworthy. Never a dose, and never an instruction: what to do about any of it stays with you and your care team."
      >
        {unavailable ? (
          <p className={styles.note}>
            Notifications need the installed app — they cannot be delivered from
            a browser preview. Everything below still shows what would be
            scheduled on your phone.
          </p>
        ) : null}

        <div className={styles.masterRow}>
          <div className={styles.masterCopy}>
            <span className={styles.masterLabel}>Allow notifications</span>
            <span className={styles.masterState}>
              {permission === 'granted' && prefs.enabled
                ? scheduledCount != null
                  ? `On · ${scheduledCount} queued`
                  : 'On'
                : permission === 'denied'
                  ? 'Blocked in iOS Settings'
                  : 'Off'}
            </span>
          </div>
          {prefs.enabled && permission === 'granted' ? (
            <button type="button" className={styles.secondaryBtn} onClick={disableNotifications}>
              Turn off
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={enableNotifications}
              disabled={unavailable || permission === 'denied'}
            >
              Allow
            </button>
          )}
        </div>

        {permission === 'denied' ? (
          <p className={styles.warnNote}>
            iOS is blocking notifications for LoopStack. The switch here cannot
            override that — it has to be turned back on under iOS Settings →
            Notifications → LoopStack.
          </p>
        ) : null}

        {prefs.enabled && permission === 'granted' ? (
          <button type="button" className={styles.secondaryBtn} onClick={runTest}>
            {testSent ? 'Sent — check your lock screen' : 'Send a test notification'}
          </button>
        ) : null}
      </Section>

      <Section
        label="What to be told about"
        title="Alert types"
        description="Each one can be turned off on its own. They stay set even while notifications are off, so turning the master switch back on restores your choices rather than resetting them."
      >
        <div className={styles.categories}>
          {ALERT_CATEGORIES.map((c) => (
            <label key={c.id} className={styles.category}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={prefs.categories[c.id]}
                onChange={() => toggleCategory(c.id)}
              />
              <span className={styles.categoryCopy}>
                <span className={styles.categoryLabel}>
                  {c.label}
                  {prefs.enabled && !live[c.id] ? (
                    <span className={styles.mutedTag}>muted</span>
                  ) : null}
                </span>
                <span className={styles.categoryDesc}>{c.description}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section
        label="Detected"
        title="Recurring windows"
        description="Stretches that have repeatedly run low or high, counted in weeks rather than readings — one bad Friday is not a pattern. These are what the window alerts fire on, 2 hours and 1 hour ahead."
      >
        {windows.length === 0 ? (
          <p className={styles.note}>
            {windowsResult.loading
              ? 'Reading your history…'
              : 'No recurring windows yet. This needs at least three weeks of glucose history, and a stretch that repeats across separate weeks before it counts.'}
          </p>
        ) : (
          <div className={styles.windows}>
            {windows.map((w) => (
              <div key={w.id} className={styles.window}>
                <div className={styles.windowHead}>
                  <span className={styles.windowLabel}>{w.label}</span>
                  <span className={`${styles.kind} ${styles[`kind_${w.kind}`]}`}>
                    {w.kind === 'low' ? 'runs low' : 'runs high'}
                  </span>
                </div>
                <div className={styles.windowStats}>
                  <span>
                    <b>{w.occurrences}</b> of {w.weeksObserved} weeks
                  </span>
                  <span>
                    <b>{w.recurrencePct}%</b> recurrence
                  </span>
                  <span>
                    {w.kind === 'low' ? 'down to' : 'up to'} <b>{w.extremeMgdl}</b> mg/dL
                  </span>
                  <span className={w.confidence === 'good' ? styles.good : styles.limited}>
                    {w.confidence === 'good' ? 'alerting' : 'building'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {isSample(windowsResult) && windows.length > 0 ? (
          <SampleNote>Windows are computed from example data.</SampleNote>
        ) : null}
      </Section>

      {alerts.length > 0 ? (
        <Section
          label="Queue"
          title="Next up"
          description="Exactly what is scheduled, in the order it will arrive."
        >
          <div className={styles.queue}>
            {[...alerts]
              .sort((a, b) => a.fireAtIso.localeCompare(b.fireAtIso))
              .slice(0, 6)
              .map((a) => (
                <div key={a.id} className={styles.queued}>
                  <div className={styles.queuedHead}>
                    <span className={styles.queuedTitle}>{a.title}</span>
                    <span className={styles.queuedWhen}>{formatFireTime(a.fireAtIso)}</span>
                  </div>
                  <p className={styles.queuedBody}>{a.body}</p>
                </div>
              ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function formatFireTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = formatClock(d);
  if (sameDay) return `today ${time}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${time}`;
}
