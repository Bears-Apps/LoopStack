import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedHistory } from './historyCache';

// The device cache, end to end: a fake Nightscout site, an in-memory stand-in
// for IndexedDB, and the real source. The claim under test is the one that
// makes the cache safe — a refresh that reads only the new stretch and merges
// it produces exactly the dashboard a full six-month read would.

const store = new Map<string, CachedHistory<unknown>>();
vi.mock('./historyCache', async (orig) => {
  const real = await orig<typeof import('./historyCache')>();
  return {
    ...real,
    loadHistory: async (key: string, sourceKey: string) => {
      const v = store.get(key);
      return v && v.sourceKey === sourceKey ? v : null;
    },
    saveHistory: async (key: string, value: CachedHistory<unknown>) => {
      store.set(key, structuredClone(value));
    },
  };
});
vi.mock('./nightscoutConfig', () => ({ loadNightscoutConfig: () => ({ url: 'https://ns.test', token: '' }) }));

const { createNightscoutDataSource } = await import('./nightscoutDataSource');

const MIN = 60_000;
const START = new Date(2026, 9, 1, 0, 0, 0).getTime();

type Doc = Record<string, unknown> & { _id: string };
const site = { entries: [] as Doc[], treatments: [] as Doc[], devicestatus: [] as Doc[] };
const requests: string[] = [];

/** Fill the fake site with 5-minute CGM, three meals a day and Loop temps, up to `untilMs`. */
function grow(fromMs: number, untilMs: number) {
  for (let t = fromMs; t < untilMs; t += 5 * MIN) {
    const i = Math.round((t - START) / (5 * MIN));
    site.entries.push({ _id: `e${i}`, date: t, sgv: 100 + ((i * 37) % 90) });
    site.devicestatus.push({ _id: `d${i}`, created_at: new Date(t).toISOString(), loop: { enacted: {}, iob: { iob: 1 + (i % 5) / 10 } } });
    if (i % 6 === 0) {
      site.treatments.push({ _id: `tb${i}`, created_at: new Date(t).toISOString(), eventType: 'Temp Basal', rate: (i % 7) / 4, duration: 30 });
    }
    const h = new Date(t).getHours() * 60 + new Date(t).getMinutes();
    if (h === 8 * 60 || h === 13 * 60 || h === 19 * 60) {
      site.treatments.push({ _id: `c${i}`, created_at: new Date(t).toISOString(), eventType: 'Carb Correction', carbs: 40 + (i % 30), absorptionTime: 180 });
      site.treatments.push({ _id: `b${i}`, created_at: new Date(t - 10 * MIN).toISOString(), eventType: 'Bolus', insulin: 2 + (i % 4) / 2 });
    }
  }
}

function fakeFetch(url: string) {
  requests.push(url);
  const u = new URL(url);
  const count = Number(u.searchParams.get('count'));
  const pick = (docs: Doc[], time: (d: Doc) => number, from: number) =>
    docs.filter((d) => time(d) >= from).sort((a, b) => time(b) - time(a)).slice(0, count);
  let body: Doc[];
  if (u.pathname.includes('entries')) {
    body = pick(site.entries, (d) => d.date as number, Number(u.searchParams.get('find[date][$gte]') ?? 0));
  } else {
    const from = Date.parse(u.searchParams.get('find[created_at][$gte]') ?? '1970-01-01');
    const docs = u.pathname.includes('treatments') ? site.treatments : site.devicestatus;
    body = pick(docs, (d) => Date.parse(d.created_at as string), from);
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(structuredClone(body)) });
}

/** Run one refresh and let the background save land. */
async function refreshed(source: ReturnType<typeof createNightscoutDataSource>) {
  await source.refresh();
  await Promise.resolve();
  return source.getSnapshot();
}

describe('Nightscout device cache', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    store.clear();
    requests.length = 0;
    site.entries = [];
    site.treatments = [];
    site.devicestatus = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reads only the new stretch and still matches a full read exactly', async () => {
    const day1 = START + 20 * 24 * 60 * MIN;
    grow(START, day1);
    vi.setSystemTime(day1);
    const source = createNightscoutDataSource();
    await refreshed(source);
    expect(store.has('nightscout')).toBe(true);

    // Two hours later: new readings, a new meal, and one edited inside the overlap.
    const later = day1 + 2 * 60 * MIN;
    grow(day1, later);
    const edited = site.treatments.find((t) => t.carbs != null && Date.parse(t.created_at as string) > day1 - 12 * 60 * MIN)!;
    edited.carbs = 99;
    vi.setSystemTime(later);
    requests.length = 0;
    const incremental = await refreshed(source);

    // Glucose was asked for from 6 h before the newest cached reading, not 180 days.
    const entryReq = new URL(requests.find((r) => r.includes('/entries/') && r.includes('$gte'))!);
    expect(Number(entryReq.searchParams.get('find[date][$gte]'))).toBe(day1 - 5 * MIN - 6 * 60 * MIN);

    // A source with no cache at the same moment reads everything.
    store.clear();
    const full = await refreshed(createNightscoutDataSource());

    expect(incremental.recentGlucose.data).toEqual(full.recentGlucose.data);
    expect(incremental.recentCarbs.data).toEqual(full.recentCarbs.data);
    expect(incremental.recentCarbs.data!.some((c) => c.grams === 99)).toBe(true);
    expect(incremental.metrics.data).toEqual(full.metrics.data);
    expect(incremental.loopMode.data).toEqual(full.loopMode.data);
    expect(incremental.autotune.data).toEqual(full.autotune.data);
    expect(incremental.dayHourGrid.data).toEqual(full.dayHourGrid.data);
    expect(incremental.currentLoopIob.data).toEqual(full.currentLoopIob.data);
  });

  it('shows the cached dashboard before the network answers', async () => {
    const day1 = START + 10 * 24 * 60 * MIN;
    grow(START, day1);
    vi.setSystemTime(day1);
    await refreshed(createNightscoutDataSource());

    // A new launch: the network never answers, the cache still draws the screen.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const source = createNightscoutDataSource();
    const seen: boolean[] = [];
    source.subscribe(() => seen.push(source.getSnapshot().metrics.data != null));
    void source.refresh();
    await vi.waitFor(() => expect(seen).toContain(true));
    expect(source.getSnapshot().recentGlucose.data!.length).toBe(site.entries.length);
  });
});
