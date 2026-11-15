import { describe, expect, it } from 'vitest';
import {
  computeLoopMode,
  type LoopStatusEntry,
  type OverrideEvent,
} from './loopMode';
import type { GlucoseReading } from '@/data/sources/types';

const NOW = new Date('2026-07-22T12:00:00Z');
const iso = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();

/** Heartbeats every 5 min from `fromMinAgo` back to `toMinAgo`. */
function beats(fromMinAgo: number, toMinAgo: number, looping = true): LoopStatusEntry[] {
  const out: LoopStatusEntry[] = [];
  for (let m = fromMinAgo; m >= toMinAgo; m -= 5) out.push({ iso: iso(m), looping });
  return out;
}

function flatGlucose(fromMinAgo: number, toMinAgo: number, mgdl: number): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  for (let m = fromMinAgo; m >= toMinAgo; m -= 5) out.push({ iso: iso(m), mgdl });
  return out;
}

describe('computeLoopMode', () => {
  it('all-looping heartbeats → 100% closed loop, no episodes', () => {
    const s = computeLoopMode({
      statuses: beats(600, 0),
      overrides: [],
      glucose: [],
      windowDays: 1,
      now: NOW,
    });
    expect(s.closedLoopPct).toBe(100);
    expect(s.manualEpisodeCount).toBe(0);
    expect(s.manualMinutesPerDay).toBe(0);
  });

  it('a heartbeat silence gap counts as a manual episode', () => {
    // looping 600→300 min ago, silent 300→120, looping 120→0
    const s = computeLoopMode({
      statuses: [...beats(600, 300), ...beats(120, 0)],
      overrides: [],
      glucose: [],
      windowDays: 1,
      now: NOW,
    });
    expect(s.manualEpisodeCount).toBe(1);
    expect(s.longestManualMinutes).toBe(180);
    expect(s.closedLoopPct).toBe(70); // 420 looping of 600 covered
  });

  it('not-looping heartbeats count as manual even without gaps', () => {
    const s = computeLoopMode({
      statuses: [...beats(200, 105), ...beats(100, 0, false)],
      overrides: [],
      glucose: [],
      windowDays: 1,
      now: NOW,
    });
    expect(s.manualEpisodeCount).toBe(1);
    expect(s.closedLoopPct).toBeLessThan(60);
  });

  it('override outcomes: worse-than-baseline TIR → review verdict + suggestion', () => {
    // Baseline glucose in range; during three "Workout" overrides it runs 220.
    const glucose = [
      ...flatGlucose(600, 361, 120),
      ...flatGlucose(360, 301, 220), // override 1
      ...flatGlucose(300, 241, 120),
      ...flatGlucose(240, 181, 220), // override 2
      ...flatGlucose(180, 121, 120),
      ...flatGlucose(120, 61, 220),  // override 3
      ...flatGlucose(60, 0, 120),
    ];
    const overrides: OverrideEvent[] = [
      { startIso: iso(360), durationMin: 59, name: 'Workout' },
      { startIso: iso(240), durationMin: 59, name: 'Workout' },
      { startIso: iso(120), durationMin: 59, name: 'Workout' },
    ];
    const s = computeLoopMode({
      statuses: beats(600, 0),
      overrides,
      glucose,
      windowDays: 1,
      now: NOW,
    });
    const workout = s.overrideOutcomes.find((o) => o.name === 'Workout')!;
    expect(workout.count).toBe(3);
    expect(workout.tirPct).toBe(0);
    expect(workout.verdict).toBe('review');
    expect(s.suggestions.some((x) => x.includes('"Workout"'))).toBe(true);
  });

  it('under 3 uses → building verdict, no judgment', () => {
    const s = computeLoopMode({
      statuses: beats(300, 0),
      overrides: [{ startIso: iso(200), durationMin: 60, name: 'Illness' }],
      glucose: flatGlucose(300, 0, 120),
      windowDays: 1,
      now: NOW,
    });
    expect(s.overrideOutcomes[0].verdict).toBe('building');
    expect(s.suggestions.some((x) => x.includes('Illness'))).toBe(false);
  });

  it('recurring manual hour → preset suggestion', () => {
    // Three separate silent stretches starting at the same local hour on
    // consecutive days (build via absolute dates).
    const day = 24 * 60;
    const statuses: LoopStatusEntry[] = [];
    for (let d = 0; d < 3; d++) {
      statuses.push(...beats(3 * day - d * day + 300, 3 * day - d * day + 60 - d * day * 0));
    }
    // Simpler construction: three looping blocks each followed by 60-min silence.
    const s = computeLoopMode({
      statuses: [
        ...beats(3 * day, 3 * day - 100),
        ...beats(3 * day - 160, 2 * day),
        ...beats(2 * day - 60, 1 * day),
        ...beats(1 * day - 60, 100),
      ],
      overrides: [],
      glucose: [],
      windowDays: 4,
      now: NOW,
    });
    expect(s.manualEpisodeCount).toBeGreaterThanOrEqual(3);
    expect(s.suggestions.some((x) => x.includes('override preset'))).toBe(true);
  });

  it('empty inputs → zeroed summary, no crash', () => {
    const s = computeLoopMode({
      statuses: [],
      overrides: [],
      glucose: [],
      windowDays: 7,
      now: NOW,
    });
    expect(s.closedLoopPct).toBe(0);
    expect(s.overrideOutcomes).toEqual([]);
    expect(s.suggestions).toEqual([]);
  });
});
