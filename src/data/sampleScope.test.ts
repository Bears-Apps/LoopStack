import { describe, it, expect } from 'vitest';
import {
  scopeWindow,
  scopeIncludes,
  scopeLabel,
  describeScopeCoverage,
  DEFAULT_SCOPE,
  type SampleScope,
} from './sampleScope';

// A Wednesday, mid-afternoon.
const NOW = new Date(2026, 7, 12, 15, 0, 0);
const at = (daysAgo: number, hour = 12) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

describe('scopeWindow', () => {
  it('starts today at midnight, not 24 hours ago', () => {
    const { startMs } = scopeWindow({ kind: 'today' }, NOW);
    const s = new Date(startMs);
    expect(s.getHours()).toBe(0);
    expect(s.getDate()).toBe(NOW.getDate());
  });

  it('tolerates a reversed date pair rather than emptying the screen', () => {
    const fwd = scopeWindow({ kind: 'dates', startIso: '2026-08-01', endIso: '2026-08-10' }, NOW);
    const rev = scopeWindow({ kind: 'dates', startIso: '2026-08-10', endIso: '2026-08-01' }, NOW);
    expect(rev.startMs).toBe(fwd.startMs);
    expect(rev.endMs).toBe(fwd.endMs);
    expect(rev.endMs).toBeGreaterThan(rev.startMs);
  });
});

describe('scopeIncludes', () => {
  /**
   * The weekday scope is the only non-contiguous one, and it is the reason a
   * scope cannot be reduced to a start and an end.
   */
  it('keeps only the chosen weekday inside the window', () => {
    const scope: SampleScope = { kind: 'weekday', weekday: 2, windowDays: 28 };
    // Tuesdays relative to a Wednesday NOW are 1, 8, 15, 22 days back.
    for (const d of [1, 8, 15, 22]) {
      expect(scopeIncludes(scope, at(d), NOW), `${d}d ago`).toBe(true);
    }
    for (const d of [0, 2, 3, 9]) {
      expect(scopeIncludes(scope, at(d), NOW), `${d}d ago`).toBe(false);
    }
  });

  it('excludes the chosen weekday once it falls outside the window', () => {
    const narrow: SampleScope = { kind: 'weekday', weekday: 2, windowDays: 14 };
    expect(scopeIncludes(narrow, at(8), NOW)).toBe(true);
    expect(scopeIncludes(narrow, at(22), NOW)).toBe(false);
  });

  it('includes every day inside a contiguous range', () => {
    const scope: SampleScope = { kind: 'range', range: '7d' };
    for (const d of [0, 1, 3, 6]) expect(scopeIncludes(scope, at(d), NOW)).toBe(true);
    expect(scopeIncludes(scope, at(9), NOW)).toBe(false);
  });
});

describe('scopeLabel', () => {
  it('names each scope the way the header shows it', () => {
    expect(scopeLabel({ kind: 'today' })).toBe('Today');
    expect(scopeLabel({ kind: 'weekday', weekday: 2, windowDays: 84 })).toBe('Tuesdays');
    expect(scopeLabel({ kind: 'range', range: '30d' })).toBe('Last 30 days');
    expect(scopeLabel(DEFAULT_SCOPE)).toBe('Last 7 days');
  });
});

describe('describeScopeCoverage', () => {
  /**
   * Reports what the sample HOLDS, never what was asked for. A 26-week window
   * over eleven weeks of history is eleven weeks — claiming 26 would repeat
   * the mistake the metrics layer already had to be fixed for.
   */
  it('counts the weekdays actually present, not the window', () => {
    const scope: SampleScope = { kind: 'weekday', weekday: 2, windowDays: 182 };
    // Only four Tuesdays exist, though the window asks for twenty-six.
    const stamps = [1, 8, 15, 22].map((d) => at(d));
    const line = describeScopeCoverage(scope, stamps, NOW);
    expect(line).toMatch(/^4 Tuesdays/);
    expect(line).not.toMatch(/26/);
  });

  it('says so when the sample is empty rather than reporting zero of something', () => {
    expect(describeScopeCoverage({ kind: 'today' }, [], NOW)).toMatch(/no readings/i);
  });

  it('uses the singular for a single instance', () => {
    const scope: SampleScope = { kind: 'weekday', weekday: 2, windowDays: 28 };
    expect(describeScopeCoverage(scope, [at(1)], NOW)).toMatch(/^1 Tuesday so far/);
  });

  it('counts days, not readings, for a contiguous range', () => {
    const stamps = [at(0, 9), at(0, 10), at(0, 11), at(1, 9), at(2, 9)];
    expect(describeScopeCoverage({ kind: 'range', range: '7d' }, stamps, NOW)).toMatch(/^3 days/);
  });
});
