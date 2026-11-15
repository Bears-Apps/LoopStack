import { describe, expect, it } from 'vitest';
import { FULL_REFETCH_MS, HISTORY_FORMAT, incrementalFrom, loadHistory, mergeSpan, needsFullFetch, type CachedHistory } from './historyCache';

type Rec = { id: string; t: number; v: number };
const opts = (fromMs: number, windowStartMs = 0) => ({
  timeOf: (r: Rec) => r.t,
  keyOf: (r: Rec) => r.id,
  fromMs,
  windowStartMs,
});
const cache = (fullFetchedMs: number): CachedHistory<null> => ({
  format: HISTORY_FORMAT,
  sourceKey: 'x',
  fullFetchedMs,
  savedMs: fullFetchedMs,
  data: null,
});

describe('mergeSpan', () => {
  const cached: Rec[] = [
    { id: 'a', t: 10, v: 1 },
    { id: 'b', t: 20, v: 1 },
    { id: 'c', t: 30, v: 1 },
    { id: 'd', t: 40, v: 1 },
  ];

  it('keeps cached records before the overlap and takes the fresh read from it on', () => {
    const fresh: Rec[] = [
      { id: 'c', t: 30, v: 2 }, // edited inside the overlap
      { id: 'e', t: 50, v: 1 }, // new
    ];
    const out = mergeSpan(cached, fresh, opts(25));
    expect(out).toEqual([
      { id: 'a', t: 10, v: 1 },
      { id: 'b', t: 20, v: 1 },
      { id: 'c', t: 30, v: 2 },
      { id: 'e', t: 50, v: 1 },
    ]);
  });

  it('drops a cached record the fresh read no longer has inside the overlap', () => {
    // 'd' was deleted on the server; the fresh read from 25 does not return it.
    const out = mergeSpan(cached, [{ id: 'c', t: 30, v: 1 }], opts(25));
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('trims to the window and never duplicates a record seen on both sides', () => {
    const fresh: Rec[] = [{ id: 'b', t: 20, v: 9 }];
    const out = mergeSpan(cached, fresh, opts(35, 15));
    expect(out.map((r) => `${r.id}${r.v}`)).toEqual(['b9', 'c1']);
  });
});

describe('fetch planning', () => {
  it('reads the whole window with no cache, once a day, or after a clock change', () => {
    const now = 10 * FULL_REFETCH_MS;
    expect(needsFullFetch(null, now)).toBe(true);
    expect(needsFullFetch(cache(now - FULL_REFETCH_MS), now)).toBe(true);
    expect(needsFullFetch(cache(now - 3600_000), now)).toBe(false);
    expect(needsFullFetch(cache(now + 3600_000), now)).toBe(true);
  });

  it('starts an incremental read an overlap before the newest record, never before the window', () => {
    expect(incrementalFrom(1000, 100, 0)).toBe(900);
    expect(incrementalFrom(1000, 100, 950)).toBe(950);
    expect(incrementalFrom(null, 100, 0)).toBeNull();
  });

  it('fails soft where IndexedDB does not exist', async () => {
    expect(await loadHistory('nightscout', 'https://x')).toBeNull();
  });
});
