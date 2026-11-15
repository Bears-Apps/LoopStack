// History kept on the device between launches.
//
// Every open used to re-read six months: 60,000 glucose samples across the
// HealthKit bridge, or ~53,000 entries and 12,000 treatments from Nightscout,
// before a single number reached the screen. Almost all of it was identical
// to what the previous open had read. Now each source keeps its raw history
// here, draws the dashboard from it straight away, and fetches only the
// stretch since the newest record it holds.
//
// Three rules keep the cached copy honest:
//   - An OVERLAP is re-read on every fetch, and the fresh read replaces the
//     cached records inside it. CGM backfill (a sensor reconnecting) and
//     edited treatments land in that span, so they are picked up, and a
//     record deleted there disappears.
//   - Once a day the source re-reads the whole window, so anything changed
//     further back than the overlap is corrected within a day.
//   - A cache from a different site, an older format, or a fetch that hit its
//     count cap is not merged into: the source falls back to a full read.
//
// Storage is IndexedDB: tens of thousands of records are far past what
// localStorage holds, and structured clone avoids a JSON round trip. Every
// call fails soft. A WebView without IndexedDB, or one that evicted it, simply
// reads the full history the way it always did.

const DB_NAME = 'loopstack-history';
const STORE = 'history';
const DB_VERSION = 1;

/** Bump when a source's cached shape changes; older entries are ignored. */
export const HISTORY_FORMAT = 1;

/** A full re-read at least this often, to pick up changes outside the overlap. */
export const FULL_REFETCH_MS = 24 * 3600_000;

export type CachedHistory<T> = {
  format: number;
  /** Identifies what the history was read from (a Nightscout URL, 'healthkit'). */
  sourceKey: string;
  /** When the whole window was last read in one go. */
  fullFetchedMs: number;
  savedMs: number;
  data: T;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function loadHistory<T>(key: string, sourceKey: string): Promise<CachedHistory<T> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result as CachedHistory<T> | undefined;
        resolve(v && v.format === HISTORY_FORMAT && v.sourceKey === sourceKey ? v : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveHistory<T>(key: string, value: CachedHistory<T>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearHistory(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Whether to read the whole window, or only since the cached history's end. */
export function needsFullFetch(cache: CachedHistory<unknown> | null, nowMs: number): boolean {
  return cache == null || nowMs - cache.fullFetchedMs >= FULL_REFETCH_MS || cache.fullFetchedMs > nowMs;
}

/**
 * Where an incremental read starts: the newest cached record, minus the
 * overlap, but never before the window. Null when there is nothing cached.
 */
export function incrementalFrom(newestMs: number | null, overlapMs: number, windowStartMs: number): number | null {
  if (newestMs == null || !Number.isFinite(newestMs)) return null;
  return Math.max(windowStartMs, newestMs - overlapMs);
}

/**
 * Cached records before `fromMs`, then everything the fresh read returned for
 * `fromMs` onward, trimmed to the window and sorted by time.
 *
 * The fresh read is authoritative for its span: a cached record at or after
 * `fromMs` is dropped even if the fresh read does not contain it, which is how
 * an edit or deletion inside the overlap reaches the cache. Records that share
 * a key across the boundary keep the fresh copy.
 */
export function mergeSpan<T>(
  cached: T[],
  fresh: T[],
  opts: { timeOf: (x: T) => number; keyOf: (x: T) => string; fromMs: number; windowStartMs: number },
): T[] {
  const { timeOf, keyOf, fromMs, windowStartMs } = opts;
  const freshKeys = new Set(fresh.map(keyOf));
  const kept = cached.filter((x) => {
    const t = timeOf(x);
    return t >= windowStartMs && t < fromMs && !freshKeys.has(keyOf(x));
  });
  const added = fresh.filter((x) => timeOf(x) >= windowStartMs);
  return [...kept, ...added].sort((a, b) => timeOf(a) - timeOf(b));
}
