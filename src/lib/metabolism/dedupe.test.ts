import { describe, expect, it } from 'vitest';
import { dedupeCarbEntries, dedupeInsulinEvents, duplicateCount } from './dedupe';
import type { CarbEntry, InsulinEvent } from '@/data/sources/types';

const carb = (iso: string, grams: number, label?: string): CarbEntry => ({
  iso,
  grams,
  absorptionHours: 3,
  label,
});

const bolus = (
  iso: string,
  units: number,
  kind: InsulinEvent['kind'] = 'bolus',
): InsulinEvent => ({ iso, units, kind });

describe('dedupeCarbEntries', () => {
  it('collapses an exact re-upload of the same entry', () => {
    const out = dedupeCarbEntries([
      carb('2026-07-20T12:00:00.000Z', 60),
      carb('2026-07-20T12:00:00.000Z', 60),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].grams).toBe(60);
  });

  it('collapses a copy posted seconds later by a second uploader', () => {
    const out = dedupeCarbEntries([
      carb('2026-07-20T12:00:00.000Z', 60),
      carb('2026-07-20T12:00:41.000Z', 60),
    ]);
    expect(out).toHaveLength(1);
    // The earliest copy wins, so the timestamp stays the real meal time.
    expect(out[0].iso).toBe('2026-07-20T12:00:00.000Z');
  });

  it('keeps a copy posted well outside the duplicate window', () => {
    const out = dedupeCarbEntries([
      carb('2026-07-20T12:00:00.000Z', 60),
      carb('2026-07-20T12:05:00.000Z', 60),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps a genuine split entry — same minute, different amount', () => {
    const out = dedupeCarbEntries([
      carb('2026-07-20T12:00:00.000Z', 60),
      carb('2026-07-20T12:00:10.000Z', 15),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.grams)).toEqual([60, 15]);
  });

  it('prefers the earliest copy even when the later one carries the label', () => {
    // Duplicates routinely lose metadata; one copy of a labelled meal still
    // beats counting the meal twice.
    const out = dedupeCarbEntries([
      carb('2026-07-20T12:00:00.000Z', 45),
      carb('2026-07-20T12:00:20.000Z', 45, 'oat bowl'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].iso).toBe('2026-07-20T12:00:00.000Z');
  });

  it('halves the daily total for a fully duplicated day', () => {
    // The shape of the 715 g/day report: every meal in the store twice.
    const meals = [
      carb('2026-07-20T08:00:00.000Z', 90),
      carb('2026-07-20T13:00:00.000Z', 120),
      carb('2026-07-20T19:00:00.000Z', 150),
    ];
    const doubled = meals.flatMap((m) => [
      m,
      { ...m, iso: new Date(new Date(m.iso).getTime() + 8_000).toISOString() },
    ]);
    const total = (xs: CarbEntry[]) => xs.reduce((a, c) => a + c.grams, 0);

    expect(total(doubled)).toBe(720);
    const out = dedupeCarbEntries(doubled);
    expect(total(out)).toBe(360);
    expect(duplicateCount(doubled, out)).toBe(3);
  });

  it('sorts output oldest-first and drops unparseable timestamps', () => {
    const out = dedupeCarbEntries([
      carb('2026-07-20T19:00:00.000Z', 30),
      carb('not-a-date', 30),
      carb('2026-07-20T08:00:00.000Z', 30),
    ]);
    expect(out.map((c) => c.iso)).toEqual([
      '2026-07-20T08:00:00.000Z',
      '2026-07-20T19:00:00.000Z',
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(dedupeCarbEntries([])).toEqual([]);
  });
});

describe('dedupeInsulinEvents', () => {
  it('collapses a duplicated bolus', () => {
    const out = dedupeInsulinEvents([
      bolus('2026-07-20T12:00:00.000Z', 4.5),
      bolus('2026-07-20T12:00:30.000Z', 4.5),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps a bolus and a temp basal of the same size at the same minute', () => {
    // Different delivery kinds are different deliveries, not a duplicate.
    const out = dedupeInsulinEvents([
      bolus('2026-07-20T12:00:00.000Z', 0.5, 'bolus'),
      bolus('2026-07-20T12:00:00.000Z', 0.5, 'basal_temp'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('returns events sorted oldest-first across kinds', () => {
    const out = dedupeInsulinEvents([
      bolus('2026-07-20T14:00:00.000Z', 1, 'basal_temp'),
      bolus('2026-07-20T12:00:00.000Z', 3, 'bolus'),
      bolus('2026-07-20T13:00:00.000Z', 2, 'bolus'),
    ]);
    expect(out.map((e) => e.units)).toEqual([3, 2, 1]);
  });
});
