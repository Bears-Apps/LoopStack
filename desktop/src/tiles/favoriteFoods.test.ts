import { describe, expect, it } from 'vitest';
import { glanceLayout } from './FavoriteFoods';

describe('favorite foods widget size', () => {
  it('shows 8 four across at full width, 4 in a 2×2 narrower', () => {
    expect(glanceLayout(12, 11, false)).toEqual({ cols: 4, shown: 8, hidden: 3 });
    expect(glanceLayout(8, 11, false)).toEqual({ cols: 2, shown: 4, hidden: 7 });
  });
  it('Show more lists every food; nothing to show when they all fit', () => {
    expect(glanceLayout(8, 11, true).shown).toBe(11);
    expect(glanceLayout(12, 4, false)).toEqual({ cols: 4, shown: 4, hidden: 0 });
  });
});
