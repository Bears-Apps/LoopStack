import { describe, expect, it } from 'vitest';
import { combineCarbEntries, COMBO_GAP_HOURS } from './mealCombining';
import type { CarbEntry } from '@/data/sources/types';

const T0 = new Date(2026, 6, 10, 19, 0, 0).getTime();

const entry = (
  minutesAfter: number,
  grams: number,
  absorptionHours = 3,
  label?: string,
): CarbEntry => ({
  iso: new Date(T0 + minutesAfter * 60_000).toISOString(),
  grams,
  absorptionHours,
  label,
});

describe('combineCarbEntries', () => {
  it('keeps a lone entry as one plain meal', () => {
    const [m] = combineCarbEntries([entry(0, 60, 3, 'Pizza night')]);
    expect(m.grams).toBe(60);
    expect(m.entryCount).toBe(1);
    expect(m.spanMinutes).toBe(0);
    expect(m.label).toBe('Pizza night');
  });

  it('merges a subsequent entry within two hours into one big meal', () => {
    const meals = combineCarbEntries([entry(0, 90, 6), entry(90, 25, 3)]);
    expect(meals).toHaveLength(1);
    expect(meals[0].grams).toBe(115);
    expect(meals[0].entryCount).toBe(2);
    expect(meals[0].spanMinutes).toBe(90);
    // Sitting keeps the FIRST entry's clock time.
    expect(meals[0].timeMs).toBe(T0);
  });

  it('keeps entries beyond two hours as separate meals', () => {
    const meals = combineCarbEntries([entry(0, 60), entry(121, 40)]);
    expect(meals).toHaveLength(2);
  });

  it('chains off the last entry, not the first', () => {
    // 0 → 110 → 220: each gap under 2h, total span over 2h — one sitting.
    const meals = combineCarbEntries([entry(0, 40), entry(110, 30), entry(220, 20)]);
    expect(meals).toHaveLength(1);
    expect(meals[0].grams).toBe(90);
    expect(meals[0].spanMinutes).toBe(220);
  });

  it('weights absorption by grams — the big plate dominates', () => {
    const [m] = combineCarbEntries([entry(0, 90, 6), entry(90, 30, 3)]);
    // (90×6 + 30×3) / 120 = 5.25
    expect(m.absorptionHours).toBeCloseTo(5.25, 2);
  });

  it('joins distinct labels and skips repeats', () => {
    const [m] = combineCarbEntries([
      entry(0, 60, 6, 'Pizza night'),
      entry(60, 20, 3, 'Fruit crumble'),
      entry(100, 15, 3, 'Fruit crumble'),
    ]);
    expect(m.label).toBe('Pizza night + Fruit crumble');
  });

  it('drops zero-gram noise but keeps order stable', () => {
    const meals = combineCarbEntries([entry(30, 0.5), entry(0, 55)]);
    expect(meals).toHaveLength(1);
    expect(meals[0].grams).toBe(55);
  });

  it('honours the exported gap constant', () => {
    const justInside = combineCarbEntries([entry(0, 40), entry(COMBO_GAP_HOURS * 60, 30)]);
    expect(justInside).toHaveLength(1);
    const justOutside = combineCarbEntries([
      entry(0, 40),
      entry(COMBO_GAP_HOURS * 60 + 1, 30),
    ]);
    expect(justOutside).toHaveLength(2);
  });
});

describe('absorption-pattern identifier across a sitting', () => {
  const withPattern = (minutesAfter: number, grams: number, pattern: string | null, label?: string): CarbEntry => ({
    ...entry(minutesAfter, grams, 12, label),
    absorptionPattern: pattern,
  });

  it('carries a lone entry’s identifier, null when it has none', () => {
    expect(combineCarbEntries([withPattern(0, 40, 'delayed-metabolic-v1')])[0].absorptionPattern).toBe(
      'delayed-metabolic-v1',
    );
    expect(combineCarbEntries([withPattern(0, 40, 'standard-v1')])[0].absorptionPattern).toBe('standard-v1');
    expect(combineCarbEntries([entry(0, 40)])[0].absorptionPattern).toBeNull();
  });

  it('marks the sitting delayed-metabolic when any entry is', () => {
    const [m] = combineCarbEntries([
      withPattern(0, 60, 'standard-v1', 'Zoodles'),
      withPattern(90, 25, 'delayed-metabolic-v1', 'Dessert'),
    ]);
    expect(m.entryCount).toBe(2);
    expect(m.absorptionPattern).toBe('delayed-metabolic-v1');
  });

  it('drops to the legacy label path when any entry has no identifier', () => {
    // A pinned-standard plate plus an older 🥜12h dessert: the dessert was
    // graded on its marker curve in Loop, so the sitting must still see it.
    const [m] = combineCarbEntries([
      withPattern(0, 60, 'standard-v1', 'Zoodles'),
      withPattern(90, 25, null, '🥜12h cake'),
    ]);
    expect(m.absorptionPattern).toBeNull();
    expect(m.label).toBe('Zoodles + 🥜12h cake');
  });

  it('keeps a pinned identifier only when every entry pins one', () => {
    const [m] = combineCarbEntries([
      withPattern(0, 60, 'standard-v1', '🥜12h plate'),
      withPattern(30, 20, 'standard-v1'),
    ]);
    expect(m.absorptionPattern).toBe('standard-v1');
  });
});
