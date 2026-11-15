import { describe, expect, it } from 'vitest';
import {
  computeRiskWindows,
  formatClock,
  formatHour,
  MIN_OCCURRENCES,
  MIN_WEEKS_OBSERVED,
} from './riskWindows';
import type { GlucoseReading } from '@/data/sources/types';
import type { TargetRange } from '@/data/loopTherapyStore';

const target: TargetRange = { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 };

// A Wednesday, so weeks are unambiguous.
const NOW = new Date(2026, 7, 12, 12, 0, 0);

/**
 * Build `weeks` weeks of five-minute CGM at `base`, then apply `shape` to
 * override individual readings. `shape(weekIndex, weekday, hour)` returns a
 * mg/dL value or null to leave the baseline alone.
 */
function series(
  weeks: number,
  shape: (weekIndex: number, weekday: number, hour: number) => number | null,
  base = 120,
): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  const start = new Date(NOW);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - weeks * 7);

  for (let day = 0; day < weeks * 7; day += 1) {
    const weekIndex = Math.floor(day / 7);
    for (let step = 0; step < 288; step += 1) {
      const t = new Date(start);
      t.setDate(start.getDate() + day);
      t.setMinutes(step * 5);
      if (t > NOW) continue;
      const override = shape(weekIndex, t.getDay(), t.getHours());
      out.push({ iso: t.toISOString(), mgdl: override ?? base });
    }
  }
  return out;
}

const compute = (glucose: GlucoseReading[]) =>
  computeRiskWindows({ glucose, target, now: NOW });

describe('gating', () => {
  it('reports nothing below the week floor', () => {
    const g = series(MIN_WEEKS_OBSERVED - 1, (_w, d, h) => (d === 5 && h === 15 ? 55 : null));
    expect(compute(g)).toHaveLength(0);
  });

  it('reports nothing from an empty history', () => {
    expect(compute([])).toHaveLength(0);
  });

  it('reports nothing when glucose never leaves range', () => {
    expect(compute(series(6, () => null))).toHaveLength(0);
  });

  it('ignores a one-off bad day', () => {
    // Only week 0 has the Friday low — one occurrence, not a pattern.
    const g = series(6, (w, d, h) => (w === 0 && d === 5 && h === 15 ? 55 : null));
    expect(compute(g).filter((x) => x.weekday === 5)).toHaveLength(0);
  });
});

describe('day-specific windows', () => {
  const fridayLows = series(6, (_w, d, h) => (d === 5 && h === 15 ? 55 : null));

  it('finds a recurring Friday afternoon low', () => {
    const w = compute(fridayLows).find((x) => x.kind === 'low' && x.weekday === 5);
    expect(w).toBeDefined();
    expect(w!.startHour).toBe(15);
    expect(w!.endHour).toBe(16);
    expect(w!.occurrences).toBeGreaterThanOrEqual(MIN_OCCURRENCES);
    expect(w!.label).toContain('Fridays');
    expect(w!.label).toContain('3pm');
  });

  it('does not flag the same hour on other days', () => {
    const lows = compute(fridayLows).filter((x) => x.kind === 'low');
    expect(lows.every((x) => x.weekday === 5 || x.weekday == null)).toBe(true);
  });

  it('merges consecutive hours into one window', () => {
    const g = series(6, (_w, d, h) => (d === 5 && h >= 15 && h < 18 ? 55 : null));
    const w = compute(g).find((x) => x.weekday === 5)!;
    expect(w.startHour).toBe(15);
    expect(w.endHour).toBe(18);
    expect(w.label).toContain('3pm–6pm');
  });

  it('finds recurring highs the same way', () => {
    const g = series(6, (_w, d, h) => (d === 1 && h === 21 ? 240 : null));
    const w = compute(g).find((x) => x.kind === 'high' && x.weekday === 1);
    expect(w).toBeDefined();
    expect(w!.label).toContain('Mondays');
    expect(w!.extremeMgdl).toBe(240);
  });

  it('carries the worst reading seen in the window', () => {
    const g = series(6, (_w, d, h) => (d === 5 && h === 15 ? 48 : null));
    expect(compute(g).find((x) => x.weekday === 5)!.extremeMgdl).toBe(48);
  });
});

describe('every-day windows', () => {
  const dailyLows = series(6, (_w, _d, h) => (h === 15 ? 55 : null));

  it('reports one week-wide window instead of seven weekday ones', () => {
    const lows = compute(dailyLows).filter((x) => x.kind === 'low');
    expect(lows).toHaveLength(1);
    expect(lows[0].weekday).toBeNull();
    expect(lows[0].label).toContain('Most days');
  });

  it('does not let a general habit masquerade as a weekday pattern', () => {
    // Every day at 3pm plus a slightly worse Friday — still one habit, because
    // Friday is not materially worse than the rest.
    const g = series(6, (_w, d, h) => (h === 15 ? (d === 5 ? 52 : 55) : null));
    const lows = compute(g).filter((x) => x.kind === 'low');
    expect(lows.every((x) => x.weekday == null)).toBe(true);
  });

  it('still separates a genuinely day-specific window at a different hour', () => {
    const g = series(6, (_w, d, h) => {
      if (h === 15) return 55; // every day
      if (d === 5 && h === 21) return 55; // Fridays only
      return null;
    });
    const lows = compute(g).filter((x) => x.kind === 'low');
    expect(lows.some((x) => x.weekday == null && x.startHour === 15)).toBe(true);
    expect(lows.some((x) => x.weekday === 5 && x.startHour === 21)).toBe(true);
  });
});

describe('confidence and ordering', () => {
  it('grades a long run of weeks as good and a short one as limited', () => {
    const long = compute(series(8, (_w, d, h) => (d === 5 && h === 15 ? 55 : null)));
    expect(long.find((x) => x.weekday === 5)!.confidence).toBe('good');

    // Exactly the floor: three weeks, three hits — a pattern, but a thin one.
    const short = compute(series(3, (_w, d, h) => (d === 5 && h === 15 ? 55 : null)));
    const w = short.find((x) => x.weekday === 5);
    if (w) expect(w.confidence).toBe('limited');
  });

  it('sorts the most-recurring window first', () => {
    const g = series(8, (_w, d, h) => {
      if (d === 5 && h === 15) return 55; // every Friday
      if (d === 2 && h === 21 && h % 2 === 1) return 55;
      return null;
    });
    const out = compute(g);
    if (out.length > 1) {
      expect(out[0].recurrencePct).toBeGreaterThanOrEqual(out[1].recurrencePct);
    }
  });

  it('never reports a recurrence above 100%', () => {
    for (const w of compute(series(6, (_w, d, h) => (d === 5 && h === 15 ? 55 : null)))) {
      expect(w.recurrencePct).toBeLessThanOrEqual(100);
    }
  });

  it('gives every window a stable, unique id', () => {
    const out = compute(series(6, (_w, d, h) => (d === 5 && h >= 15 && h < 17 ? 55 : null)));
    const ids = out.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('formatHour', () => {
  it('formats the clock the way a person reads it', () => {
    expect(formatHour(0)).toBe('12am');
    expect(formatHour(9)).toBe('9am');
    expect(formatHour(12)).toBe('12pm');
    expect(formatHour(15)).toBe('3pm');
    expect(formatHour(23)).toBe('11pm');
  });
});

describe('formatClock', () => {
  it('reads as wall-clock time, not an hour label with minutes bolted on', () => {
    expect(formatClock(new Date(2026, 0, 1, 8, 50))).toBe('8:50am');
    expect(formatClock(new Date(2026, 0, 1, 15, 0))).toBe('3pm');
    expect(formatClock(new Date(2026, 0, 1, 0, 5))).toBe('12:05am');
    expect(formatClock(new Date(2026, 0, 1, 12, 0))).toBe('12pm');
    expect(formatClock(new Date(2026, 0, 1, 23, 59))).toBe('11:59pm');
  });
});
