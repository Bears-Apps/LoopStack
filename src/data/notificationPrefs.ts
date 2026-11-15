import { ALERT_CATEGORIES, DEFAULT_REPORT_TIME, type AlertCategory } from '@/lib/alerts/alertEngine';

// Notification preferences, on device.
//
// Two separate things are stored, and conflating them is the usual bug:
//
//   • the OS permission — granted once, owned by iOS, and never something the
//     app can assume or re-grant itself
//   • the per-category switches — the user's choice about WHAT is worth a
//     buzz, which stays meaningful even while permission is denied
//
// Everything starts OFF. A health app that begins pushing notifications the
// moment it is installed has decided something on the user's behalf that is
// theirs to decide.

const STORAGE_KEY = 'loopstack:notificationPrefs:v1';

export type NotificationPrefs = {
  /** The master switch, flipped by the "Allow notifications" flow. */
  enabled: boolean;
  categories: Record<AlertCategory, boolean>;
  /**
   * Local time the morning report lands. Stored rather than hardcoded because
   * the right hour is personal — it wants to arrive before the day it
   * describes has started, and when that is depends on the person.
   */
  reportAt: { hour: number; minute: number };
};

export function defaultPrefs(): NotificationPrefs {
  const categories = {} as Record<AlertCategory, boolean>;
  // Every category on by default *once the master switch is turned on* — the
  // master switch is the consent, and being asked twice for the same thing is
  // its own kind of friction.
  for (const c of ALERT_CATEGORIES) categories[c.id] = true;
  return { enabled: false, categories, reportAt: { ...DEFAULT_REPORT_TIME } };
}

export function loadNotificationPrefs(): NotificationPrefs {
  const base = defaultPrefs();
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    const categories = { ...base.categories };
    for (const c of ALERT_CATEGORIES) {
      const stored = parsed.categories?.[c.id];
      if (typeof stored === 'boolean') categories[c.id] = stored;
    }
    // A stored time is only honoured if it is a real clock time; a corrupted
    // value would otherwise schedule the report at an hour that never comes.
    const at = parsed.reportAt;
    const reportAt =
      at &&
      Number.isInteger(at.hour) && at.hour >= 0 && at.hour <= 23 &&
      Number.isInteger(at.minute) && at.minute >= 0 && at.minute <= 59
        ? { hour: at.hour, minute: at.minute }
        : { ...DEFAULT_REPORT_TIME };
    return { enabled: parsed.enabled === true, categories, reportAt };
  } catch {
    return base;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
}

/** Which categories are actually live: master switch AND the per-category one. */
export function activeCategories(
  prefs: NotificationPrefs,
): Record<AlertCategory, boolean> {
  const out = {} as Record<AlertCategory, boolean>;
  for (const c of ALERT_CATEGORIES) {
    out[c.id] = prefs.enabled && prefs.categories[c.id];
  }
  return out;
}
