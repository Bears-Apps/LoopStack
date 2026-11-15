import { describe, expect, it } from 'vitest';
import { createCombinedDataSource } from './combinedDataSource';

// Build 9 shipped a combined source whose getSnapshot rebuilt its object on
// every call. useSyncExternalStore compares snapshots by identity, so React
// concluded the store had changed on every render and looped forever — a white
// screen and a minified error #185 the moment a Nightscout token was entered.
// The contract is one line of code away from being broken again, so it is
// asserted here rather than left to review.

describe('combined source snapshot stability', () => {
  it('returns the same reference when nothing upstream has changed', () => {
    const source = createCombinedDataSource();
    const a = source.getSnapshot();
    const b = source.getSnapshot();
    expect(b).toBe(a);
    source.dispose?.();
  });

  it('stays stable across many reads, as a render loop would', () => {
    const source = createCombinedDataSource();
    const first = source.getSnapshot();
    for (let i = 0; i < 50; i += 1) {
      expect(source.getSnapshot()).toBe(first);
    }
    source.dispose?.();
  });
});
