import { useSyncExternalStore } from 'react';
import type { PendingAlert } from '@/lib/alerts/alertEngine';

// The inbox behind the bell.
//
// Notifications are ephemeral by design — they arrive, they get swiped away,
// and the pattern they described is gone. That is fine for a reminder and
// wrong for a finding: "your 6h preset just reached confidence" is worth
// keeping until it has been read, whether or not the phone was in a pocket
// when it fired.
//
// So every alert the engine produces is also filed here, once, keyed by its
// stable id. The engine re-emits the same ids on every refresh — that is how
// scheduling replaces rather than duplicates — so the store dedupes on id and
// keeps the FIRST time it saw each one.

const STORAGE_KEY = 'loopstack:alertInbox:v1';

/** How many to keep. Past this the oldest read items are dropped. */
const MAX_ITEMS = 60;

export type InboxItem = {
  id: string;
  /** The finding this row stands for. Several alerts (different delivery lead
   *  times) can share one; the inbox keeps a single row per finding. */
  findingId?: string;
  category: PendingAlert['category'];
  title: string;
  body: string;
  /** When LoopStack first produced this finding. */
  seenIso: string;
  /** When the alert is/was scheduled to fire on the phone. */
  fireAtIso: string;
  readIso: string | null;
  /** Where tapping the row goes, when the finding has a screen of its own. */
  route?: string;
};

function load(): InboxItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InboxItem[]) : [];
  } catch {
    return [];
  }
}

let items: InboxItem[] = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable — in-memory state is still correct for the session.
  }
  for (const l of listeners) l();
}

/**
 * File any alerts not already in the inbox.
 *
 * Returns true when something new landed, so a caller can avoid a needless
 * re-render on the (very common) refresh that produced nothing new.
 */
export function fileAlerts(alerts: PendingAlert[], now = new Date()): boolean {
  // Keyed by finding, not by scheduled delivery. `findingId` defaults to `id`,
  // so anything that does not set one dedupes exactly as it always did — but a
  // recurring window, which emits one alert per lead time, now files once
  // instead of stacking two identical rows in the app's one proactive surface.
  // The set is added to as the batch is walked, so duplicates INSIDE a single
  // refresh collapse too, not just duplicates across refreshes.
  const known = new Set(items.map((i) => i.findingId ?? i.id));
  // Rows filed before alerts carried a route get one, so a heads-up already
  // sitting in the inbox opens its weekday like a new one does.
  const routes = new Map(alerts.filter((a) => a.route).map((a) => [a.findingId ?? a.id, a.route!]));
  let patched = false;
  items = items.map((i) => {
    const route = i.route ? undefined : routes.get(i.findingId ?? i.id);
    if (!route) return i;
    patched = true;
    return { ...i, route };
  });
  const fresh: PendingAlert[] = [];
  for (const a of alerts) {
    const key = a.findingId ?? a.id;
    if (known.has(key)) continue;
    known.add(key);
    fresh.push(a);
  }
  if (fresh.length === 0) {
    if (patched) emit();
    return false;
  }

  const nowIso = now.toISOString();
  items = [
    ...fresh.map((a) => ({
      id: a.id,
      findingId: a.findingId ?? a.id,
      category: a.category,
      title: a.title,
      body: a.body,
      seenIso: nowIso,
      fireAtIso: a.fireAtIso,
      readIso: null,
      route: a.route,
    })),
    ...items,
  ];

  // Trim, but never drop something still unread — an inbox that silently
  // discards the thing you have not looked at yet is worse than a long one.
  if (items.length > MAX_ITEMS) {
    const unread = items.filter((i) => i.readIso == null);
    const read = items.filter((i) => i.readIso != null);
    items = [...unread, ...read].slice(0, Math.max(MAX_ITEMS, unread.length));
  }

  emit();
  return true;
}

export function markRead(id: string): void {
  const nowIso = new Date().toISOString();
  items = items.map((i) => (i.id === id ? { ...i, readIso: i.readIso ?? nowIso } : i));
  emit();
}

export function markAllRead(): void {
  const nowIso = new Date().toISOString();
  items = items.map((i) => (i.readIso ? i : { ...i, readIso: nowIso }));
  emit();
}

export function clearInbox(): void {
  items = [];
  emit();
}

export function getInboxItems(): InboxItem[] {
  return items;
}

export function unreadCount(): number {
  return items.filter((i) => i.readIso == null).length;
}

export function useAlertInbox(): InboxItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getInboxItems,
    getInboxItems,
  );
}
