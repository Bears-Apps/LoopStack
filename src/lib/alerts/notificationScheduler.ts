import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type Weekday } from '@capacitor/local-notifications';
import type { PendingAlert } from './alertEngine';

// Delivery. Everything above this file decides WHAT to say; this decides
// whether the phone can say it, and puts it in the OS queue.
//
// Two rules shape the implementation:
//
//   • Nothing is scheduled without an explicit grant. The permission prompt is
//     only ever raised from a user action, never from a background refresh —
//     an iOS permission prompt can be shown once, and burning it on app launch
//     wastes the one chance to ask well.
//
//   • Scheduling is a REPLACE, not an append. Every refresh recomputes the
//     full set of alerts, so the previous set is cancelled first. Without that
//     a week of refreshes stacks a week of duplicate notifications for the
//     same Friday afternoon.

/** Notification ids are 32-bit ints on iOS; alert ids are strings. */
function numericId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  // Positive and inside the safe range iOS accepts.
  return Math.abs(hash) % 2_000_000_000;
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

export function notificationsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

export async function checkPermission(): Promise<PermissionState> {
  if (!notificationsAvailable()) return 'unavailable';
  try {
    const res = await LocalNotifications.checkPermissions();
    return normalize(res.display);
  } catch {
    return 'unavailable';
  }
}

/** Raise the OS prompt. Call ONLY from a user gesture. */
export async function requestPermission(): Promise<PermissionState> {
  if (!notificationsAvailable()) return 'unavailable';
  try {
    const res = await LocalNotifications.requestPermissions();
    return normalize(res.display);
  } catch {
    return 'unavailable';
  }
}

function normalize(display: string): PermissionState {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Replace every LoopStack notification with the current set.
 *
 * Returns how many were scheduled, or null when notifications are unavailable
 * or not granted — the caller surfaces that rather than failing silently.
 */
export async function syncScheduledAlerts(
  alerts: PendingAlert[],
): Promise<number | null> {
  if (!notificationsAvailable()) return null;

  try {
    if ((await checkPermission()) !== 'granted') return null;

    // Cancel what we previously queued. Only ours — `getPending` returns this
    // app's notifications, so there is nothing else to be careful about.
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }

    if (alerts.length === 0) return 0;

    const now = Date.now();
    // A weekly-slot alert has no single fire time — the OS resolves the next
    // occurrence — so it is exempt from the future-only filter that keeps
    // stale one-off alerts from being re-queued into the past.
    const schedulable = alerts.filter(
      (a) => a.weeklyOn != null || new Date(a.fireAtIso).getTime() > now,
    );

    await LocalNotifications.schedule({
      notifications: schedulable.map((a) => ({
        id: numericId(a.id),
        title: a.title,
        body: a.body,
        schedule: a.weeklyOn
          ? {
              // A true weekly slot, handed to the OS as a calendar match: it
              // fires every Tuesday at 7am whether or not the app has run
              // since. This is why the morning report needs no background
              // execution — iOS owns the recurrence.
              //
              // +1 because the plugin's Weekday enum is 1-based from Sunday
              // while Date.getDay() is 0-based. Everything inside this codebase
              // uses the 0-based form; the conversion lives here alone.
              on: {
                weekday: (a.weeklyOn.weekday + 1) as Weekday,
                hour: a.weeklyOn.hour,
                minute: a.weeklyOn.minute,
              },
              repeats: true,
              allowWhileIdle: true,
            }
          : {
              at: new Date(a.fireAtIso),
              // Weekly repeat for weekday patterns; everything else fires once
              // and is re-queued by the next refresh if it still applies.
              ...(a.repeatsWeekly ? { every: 'week' as const, allowWhileIdle: true } : {}),
            },
        extra: { category: a.category, alertId: a.id, route: a.route },
      })),
    });

    return schedulable.length;
  } catch {
    // A scheduling failure must never take the app down with it.
    return null;
  }
}

/**
 * Call `onTap` with the alert id and route of a notification the user taps.
 *
 * iOS holds a tap that launched the app until a listener is attached, so this
 * catches the cold-start case as well as taps while the app is running.
 */
export function onNotificationTap(onTap: (tap: { alertId: string | null; route: string | null }) => void): () => void {
  if (!notificationsAvailable()) return () => {};
  const handle = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const extra = (e.notification.extra ?? {}) as { alertId?: unknown; route?: unknown };
    onTap({
      alertId: typeof extra.alertId === 'string' ? extra.alertId : null,
      route: typeof extra.route === 'string' ? extra.route : null,
    });
  });
  return () => {
    void handle.then((h) => h.remove()).catch(() => {});
  };
}

/** Clear everything — used when the master switch is turned off. */
export async function cancelAllAlerts(): Promise<void> {
  if (!notificationsAvailable()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch {
    // nothing queued, or the plugin is gone — either way there is nothing to do
  }
}

/** A one-off confirmation so the user can see the permission actually works. */
export async function sendTestNotification(): Promise<boolean> {
  if (!notificationsAvailable()) return false;
  try {
    if ((await checkPermission()) !== 'granted') return false;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: numericId('loopstack_test'),
          title: 'Notifications are on',
          body: 'This is what a LoopStack heads-up looks like. Pattern notices only — never a dose.',
          schedule: { at: new Date(Date.now() + 3_000) },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}
