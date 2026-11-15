import { describe, expect, it } from 'vitest';
import { computeRangeRhythm, computeTimeTrends, worstBucket } from './timeTrends';
import type { GlucoseReading } from '@/data/sources/types';

// Build readings at a fixed local day/hour.
function reading(dayOffset: number, hour: number, mgdl: number): GlucoseReading {
  const d = new Date('2026-07-19T00:00:00'); // a Sunday, local
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return { iso: d.toISOString(), mgdl };
}

describe('computeTimeTrends', () => {
  it('buckets by day of week and hour of day', () => {
    const t = computeTimeTrends([
      reading(0, 3, 200), // Sunday 3am, high
      reading(0, 3, 190),
      reading(1, 12, 120), // Monday noon, in range
    ], { lowMgdl: 70, highMgdl: 180 });

    expect(t.byDayOfWeek).toHaveLength(7);
    expect(t.byHourOfDay).toHaveLength(24);
    expect(t.byDayOfWeek[0].readingCount).toBe(2); // Sunday
    expect(t.byDayOfWeek[0].avgMgdl).toBe(195);
    expect(t.byDayOfWeek[0].highPct).toBe(100);
    expect(t.byDayOfWeek[1].inRangePct).toBe(100); // Monday
    expect(t.byHourOfDay[3].readingCount).toBe(2);
    expect(t.byHourOfDay[12].readingCount).toBe(1);
  });

  it('scores in-range against the passed target, not a fixed 70-180', () => {
    const t = computeTimeTrends([reading(1, 12, 170)], { lowMgdl: 70, highMgdl: 160 });
    expect(t.byDayOfWeek[1].highPct).toBe(100); // 170 is high at a 160 ceiling
    expect(t.byDayOfWeek[1].inRangePct).toBe(0);
  });

  it('marks empty buckets with a null average rather than zero', () => {
    const t = computeTimeTrends([reading(1, 12, 120)]);
    expect(t.byDayOfWeek[3].avgMgdl).toBeNull();
    expect(t.byDayOfWeek[3].readingCount).toBe(0);
  });

  it('skips unparseable timestamps', () => {
    const t = computeTimeTrends([
      { iso: 'nope', mgdl: 120 },
      reading(1, 12, 120),
    ]);
    expect(t.totalReadings).toBe(2);
    expect(t.byDayOfWeek.reduce((a, b) => a + b.readingCount, 0)).toBe(1);
  });
});

describe('worstBucket', () => {
  it('returns the lowest in-range bucket that clears the sample floor', () => {
    const t = computeTimeTrends([
      ...Array.from({ length: 20 }, () => reading(0, 19, 220)), // Sun dinner, bad
      ...Array.from({ length: 20 }, () => reading(1, 12, 120)), // Mon noon, good
    ], { lowMgdl: 70, highMgdl: 180 });
    const worst = worstBucket(t.byDayOfWeek, 12);
    expect(worst?.label).toBe('Sun');
  });

  it('returns null when nothing has enough data', () => {
    const t = computeTimeTrends([reading(0, 3, 200)]);
    expect(worstBucket(t.byDayOfWeek, 12)).toBeNull();
  });

  // The confidence principle applied to trends: days that behave alike must
  // not produce a "worst day" callout pointing at a setting. Before this gate,
  // a 98%-vs-100% spread was reported as "worth checking your settings".
  it('stays silent when every bucket is within a couple of points', () => {
    const t = computeTimeTrends(
      [
        // Sun: 19 of 20 in range (95%). Mon: 20 of 20 (100%).
        ...Array.from({ length: 19 }, () => reading(0, 12, 120)),
        reading(0, 13, 220),
        ...Array.from({ length: 20 }, () => reading(1, 12, 120)),
      ],
      { lowMgdl: 70, highMgdl: 180 },
    );
    expect(worstBucket(t.byDayOfWeek, 12)).toBeNull();
  });

  it('still reports a day that is genuinely worse', () => {
    const t = computeTimeTrends(
      [
        // Sun: 10 of 20 in range (50%) vs Mon 100% — a real 50-point spread.
        ...Array.from({ length: 10 }, () => reading(0, 12, 120)),
        ...Array.from({ length: 10 }, () => reading(0, 13, 260)),
        ...Array.from({ length: 20 }, () => reading(1, 12, 120)),
      ],
      { lowMgdl: 70, highMgdl: 180 },
    );
    expect(worstBucket(t.byDayOfWeek, 12)?.label).toBe('Sun');
  });
});

describe('weekRhythm (current calendar week)', () => {
  // Anchor "now" to a known Wednesday so day placement is deterministic.
  const wed = new Date('2026-07-22T12:00:00'); // Wed
  const onDay = (dowMondayFirst: number, hour: number, mgdl: number): GlucoseReading => {
    // Monday of that week is 2026-07-20.
    const d = new Date('2026-07-20T00:00:00');
    d.setDate(d.getDate() + dowMondayFirst);
    d.setHours(hour, 0, 0, 0);
    return { iso: d.toISOString(), mgdl };
  };

  it('returns 7 Monday-first days', () => {
    const t = computeTimeTrends([onDay(0, 9, 120)], { lowMgdl: 70, highMgdl: 180 }, wed);
    expect(t.weekRhythm).toHaveLength(7);
    expect(t.weekRhythm.map((d) => d.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(t.weekRhythm[0].index).toBe(0);
  });

  it('scores each day of the week independently', () => {
    const t = computeTimeTrends(
      [
        onDay(0, 9, 120), // Mon in range
        onDay(0, 12, 130), // Mon in range
        onDay(2, 9, 260), // Wed (today) high
      ],
      { lowMgdl: 70, highMgdl: 180 },
      wed,
    );
    expect(t.weekRhythm[0].tirPct).toBe(100); // Monday
    expect(t.weekRhythm[0].readingCount).toBe(2);
    expect(t.weekRhythm[2].tirPct).toBe(0); // Wednesday, high
  });

  it('marks today and future days', () => {
    const t = computeTimeTrends([onDay(0, 9, 120)], { lowMgdl: 70, highMgdl: 180 }, wed);
    expect(t.weekRhythm[2].isToday).toBe(true); // Wed
    expect(t.weekRhythm[2].isFuture).toBe(false);
    expect(t.weekRhythm[3].isFuture).toBe(true); // Thu — hasn't happened
    expect(t.weekRhythm[0].isFuture).toBe(false); // Mon — past
  });

  it('leaves days with no readings null, not zero', () => {
    const t = computeTimeTrends([onDay(0, 9, 120)], { lowMgdl: 70, highMgdl: 180 }, wed);
    expect(t.weekRhythm[0].tirPct).toBe(100);
    expect(t.weekRhythm[1].tirPct).toBeNull(); // Tuesday, no data
    expect(t.weekRhythm[1].readingCount).toBe(0);
  });

  it('excludes readings from other weeks', () => {
    const lastWeek: GlucoseReading = { iso: '2026-07-13T09:00:00', mgdl: 120 }; // prior Mon
    const t = computeTimeTrends(
      [lastWeek, onDay(0, 9, 120)],
      { lowMgdl: 70, highMgdl: 180 },
      wed,
    );
    // Only this week's Monday reading counts toward the strip.
    expect(t.weekRhythm[0].readingCount).toBe(1);
  });

  it('treats Sunday as the last day of the week, not the first', () => {
    const sun = new Date('2026-07-26T12:00:00'); // Sunday
    const t = computeTimeTrends([], { lowMgdl: 70, highMgdl: 180 }, sun);
    expect(t.weekRhythm[6].isToday).toBe(true); // Sunday is index 6
    expect(t.weekRhythm[6].label).toBe('S');
  });
});

// ── Range-aware rhythm ──────────────────────────────────────────────────────
// Wide windows must collapse into a readable number of marks: 90 daily rings
// is not a chart. Each mark reports the days it covers so the UI can word the
// takeaway honestly.
describe('computeRangeRhythm', () => {
  const TARGET = { lowMgdl: 70, highMgdl: 180 };
  // Fixed "now" so bucket boundaries are deterministic.
  const NOW = new Date('2026-07-19T12:00:00');

  // A reading `daysAgo` before NOW, at midday to stay inside its own day.
  function ago(daysAgo: number, mgdl: number): GlucoseReading {
    const d = new Date(NOW);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(12, 0, 0, 0);
    return { iso: d.toISOString(), mgdl };
  }

  it('keeps one mark per day on short windows', () => {
    const r = computeRangeRhythm([ago(0, 120), ago(1, 120)], '7d', TARGET, NOW);
    expect(r).toHaveLength(7);
    expect(r.every((d) => d.spanDays === 1)).toBe(true);
    // Oldest to newest: today is the last mark.
    expect(r[r.length - 1].isToday).toBe(true);
  });

  it('collapses wide windows into multi-day buckets, never more than seven marks', () => {
    for (const range of ['14d', '30d', '90d', '180d'] as const) {
      const r = computeRangeRhythm([ago(0, 120)], range, TARGET, NOW);
      expect(r.length).toBeLessThanOrEqual(7);
      expect((r[0].spanDays ?? 1)).toBeGreaterThan(1);
    }
  });

  it('covers the full window it claims', () => {
    const r = computeRangeRhythm([], '180d', TARGET, NOW);
    const covered = r.reduce((a, d) => a + (d.spanDays ?? 1), 0);
    expect(covered).toBe(180);
  });

  it('scores each bucket against the target and leaves empty buckets null', () => {
    // Two in-range readings today, one high reading 100 days back.
    const r = computeRangeRhythm(
      [ago(0, 120), ago(0, 130), ago(100, 250)],
      '180d',
      TARGET,
      NOW,
    );
    const withData = r.filter((d) => d.tirPct != null);
    expect(withData.length).toBe(2);
    // The newest bucket holds today's in-range pair.
    expect(r[r.length - 1].tirPct).toBe(100);
    expect(r[r.length - 1].readingCount).toBe(2);
    // Buckets with no readings stay null rather than scoring a misleading 0%.
    expect(r.some((d) => d.tirPct === null)).toBe(true);
  });

  it('excludes readings outside the window', () => {
    const r = computeRangeRhythm([ago(400, 120)], '180d', TARGET, NOW);
    expect(r.every((d) => d.tirPct === null)).toBe(true);
  });
});
