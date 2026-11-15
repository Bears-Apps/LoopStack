import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedHistory } from './historyCache';

// The Apple Health source with its plugins stubbed: what it reads, in what
// order, and that a cached-plus-incremental refresh matches a full read.

const MIN = 60_000;
const START = new Date(2026, 9, 1, 0, 0, 0).getTime();

const store = new Map<string, CachedHistory<unknown>>();
vi.mock('./historyCache', async (orig) => {
  const real = await orig<typeof import('./historyCache')>();
  return {
    ...real,
    loadHistory: async (key: string) => store.get(key) ?? null,
    saveHistory: async (key: string, value: CachedHistory<unknown>) => void store.set(key, structuredClone(value)),
  };
});

const health = { glucose: [] as { startDate: string; endDate: string; value: number }[] };
const glucoseReads: { startDate: string; limit: number }[] = [];
/** When set, long glucose reads wait on this — to observe the fast phase. */
let holdLong: Promise<void> | null = null;

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => ({}) }));
vi.mock('@capgo/capacitor-health', () => ({
  Health: {
    isAvailable: async () => ({ available: true }),
    requestAuthorization: async () => ({}),
    readSamples: async (o: { dataType: string; startDate: string; endDate: string; limit: number; ascending: boolean }) => {
      if (o.dataType !== 'bloodGlucose') return { samples: [] };
      glucoseReads.push({ startDate: o.startDate, limit: o.limit });
      if (o.limit > 500 && holdLong) await holdLong;
      const from = Date.parse(o.startDate);
      const to = Date.parse(o.endDate);
      const rows = health.glucose.filter((g) => Date.parse(g.startDate) >= from && Date.parse(g.startDate) <= to);
      return { samples: o.ascending ? rows : [...rows].reverse() };
    },
    queryWorkouts: async () => ({ workouts: [] }),
    queryAggregated: async () => ({ samples: [] }),
  },
}));
vi.mock('./healthDiabetesPlugin', () => ({
  HealthDiabetes: {
    requestAuthorization: async () => ({}),
    readInsulin: async () => ({ samples: [] }),
    readCarbs: async () => ({ samples: [] }),
    readBoluses: async () => ({ samples: [] }),
    aggregateInsulinByDay: async () => ({ days: [] }),
  },
}));

const { createHealthKitDataSource } = await import('./healthKitDataSource');

function grow(fromMs: number, untilMs: number) {
  for (let t = fromMs; t < untilMs; t += 5 * MIN) {
    const i = Math.round((t - START) / (5 * MIN));
    const iso = new Date(t).toISOString();
    health.glucose.push({ startDate: iso, endDate: iso, value: 90 + ((i * 29) % 120) });
  }
}

describe('Apple Health source', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    store.clear();
    health.glucose = [];
    glucoseReads.length = 0;
    holdLong = null;
  });

  it('shows the current reading before the six-month read finishes', async () => {
    const now = START + 14 * 24 * 60 * MIN;
    grow(START, now);
    vi.setSystemTime(now);
    let release!: () => void;
    holdLong = new Promise((r) => (release = r));
    const source = createHealthKitDataSource();
    const done = source.refresh();
    await vi.waitFor(() => expect(source.getSnapshot().currentGlucose.data).not.toBeNull());
    expect(source.getSnapshot().metrics.data).toBeNull();
    release();
    await done;
    expect(source.getSnapshot().metrics.data).not.toBeNull();
  });

  it('reads only the new stretch of glucose once cached, and matches a full read', async () => {
    const day1 = START + 20 * 24 * 60 * MIN;
    grow(START, day1);
    vi.setSystemTime(day1);
    const source = createHealthKitDataSource();
    await source.refresh();
    await Promise.resolve();

    const later = day1 + 3 * 60 * MIN;
    grow(day1, later);
    vi.setSystemTime(later);
    glucoseReads.length = 0;
    await source.refresh();
    const incremental = source.getSnapshot();
    const long = glucoseReads.find((r) => r.limit > 500)!;
    expect(Date.parse(long.startDate)).toBe(day1 - 5 * MIN - 6 * 60 * MIN);

    store.clear();
    const fresh = createHealthKitDataSource();
    await fresh.refresh();
    const full = fresh.getSnapshot();
    expect(incremental.metrics.data).toEqual(full.metrics.data);
    expect(incremental.timeTrends.data).toEqual(full.timeTrends.data);
    expect(incremental.dayHourGrid.data).toEqual(full.dayHourGrid.data);
    expect(incremental.agp.data).toEqual(full.agp.data);
  });

  it('takes glucose from the combined source instead of reading it again', async () => {
    const now = START + 14 * 24 * 60 * MIN;
    grow(START, now);
    vi.setSystemTime(now);
    const supplied = health.glucose.map((g) => ({ iso: g.startDate, mgdl: g.value }));
    const source = createHealthKitDataSource({ glucoseHistory: async () => supplied, glucoseViews: false, insulinViews: () => false });
    await source.refresh();
    expect(glucoseReads.every((r) => r.limit <= 500)).toBe(true);
    const s = source.getSnapshot();
    expect(s.metrics.data).not.toBeNull();
    // Views the merge takes from Nightscout are not computed here at all.
    expect(s.timeTrends.data).toBeNull();
    expect(s.autotune.data).toBeNull();
    expect(store.size).toBe(0);
  });
});
