// What you've chosen to track among the suggestions, kept on this Mac only.
// tracked: watching it build confidence · staged: in your next build
// dismissed: hidden. Each load records the grade it read that day, which is
// the confidence history a card shows.
import { useEffect, useState } from 'react';
import type { Confidence } from '@/lib/metabolism/autotune';

export type TrackState = 'tracked' | 'staged' | 'dismissed';
/** branch: its own patch with a switch in the Feature library · code: folded into one proposals patch. */
export type BuildAs = 'branch' | 'code';
export interface Reading { date: string; confidence: Confidence; reading: number | null }
export interface Tracked { id: string; state: TrackState; since: string; buildAs: BuildAs; history: Reading[] }

const KEY = 'loopstack.tracked';
const MAX_HISTORY = 60;

function read(): Record<string, Tracked> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function write(v: Record<string, Tracked>) {
  try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: this session only */ }
}

const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** Adds today's reading to every tracked item's history, once a day per item. Pure, for testing. */
export function recordReadings(all: Record<string, Tracked>, today: string, now: { id: string; confidence: Confidence; reading: number | null }[]): Record<string, Tracked> {
  const next = { ...all };
  for (const r of now) {
    const t = next[r.id];
    if (!t || t.state === 'dismissed') continue;
    const last = t.history[t.history.length - 1];
    if (last && last.date === today) continue;
    next[r.id] = { ...t, history: [...t.history, { date: today, confidence: r.confidence, reading: r.reading }].slice(-MAX_HISTORY) };
  }
  return next;
}

export function useTracked() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const all = read();
  const set = (id: string, patch: Partial<Tracked> & { state?: TrackState }, today: string, first?: Reading) => {
    const cur = read();
    const prev = cur[id];
    cur[id] = prev ? { ...prev, ...patch } : { id, state: patch.state ?? 'tracked', since: today, buildAs: patch.buildAs ?? 'code', history: first ? [first] : [] };
    write(cur);
    notify();
  };
  return {
    all,
    track: (id: string, today: string, first: Reading) => set(id, { state: 'tracked' }, today, first),
    stage: (id: string, today: string, first: Reading) => set(id, { state: 'staged' }, today, first),
    unstage: (id: string, today: string) => set(id, { state: 'tracked' }, today),
    dismiss: (id: string, today: string) => set(id, { state: 'dismissed' }, today),
    forget: (id: string) => { const cur = read(); delete cur[id]; write(cur); notify(); },
    buildAs: (id: string, as: BuildAs, today: string) => set(id, { buildAs: as }, today),
    record: (today: string, now: { id: string; confidence: Confidence; reading: number | null }[]) => {
      const cur = read();
      const next = recordReadings(cur, today, now);
      if (JSON.stringify(next) !== JSON.stringify(cur)) { write(next); notify(); }
    },
  };
}

// ------------------------------------------------------------ the Suggestions nav badge
// New: suggestions you haven't seen, haven't tracked and haven't hidden.
// Reached confidence: tracked readings that now pass the build gate (SAFE-5a)
// and haven't been announced yet. Opening Suggestions clears both.
const SEEN_KEY = 'loopstack.suggestionsSeen';
interface Seen { ids: string[]; ready: string[] }
function readSeen(): Seen {
  try {
    const v = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? 'null');
    return v && Array.isArray(v.ids) && Array.isArray(v.ready) ? v : { ids: [], ready: [] };
  } catch {
    return { ids: [], ready: [] };
  }
}
function writeSeen(v: Seen) {
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
  notify();
}

/** The two counts behind the badge. Pure, for testing. */
export function badgeCounts(all: { id: string; ready: boolean }[], tracked: Record<string, Tracked>, seen: Seen) {
  const ids = new Set(seen.ids);
  const ready = new Set(seen.ready);
  const fresh = all.filter((s) => !tracked[s.id] && !ids.has(s.id)).length;
  const reached = all.filter((s) => tracked[s.id]?.state === 'tracked' && s.ready && !ready.has(s.id)).length;
  return { fresh, reached, total: fresh + reached };
}

/** The badge counts, live. `items` is every suggestion with whether it passes the build gate now. */
export function useSuggestionsBadge(items: { id: string; ready: boolean }[]) {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return badgeCounts(items, read(), readSeen());
}

/** Opening Suggestions: everything listed is seen, and every tracked reading that's ready has been announced. */
export function markSuggestionsSeen(items: { id: string; ready: boolean }[]) {
  const cur = readSeen();
  const next = { ids: [...new Set([...cur.ids, ...items.map((s) => s.id)])], ready: [...new Set([...cur.ready, ...items.filter((s) => s.ready).map((s) => s.id)])] };
  if (next.ids.length !== cur.ids.length || next.ready.length !== cur.ready.length) writeSeen(next);
}
