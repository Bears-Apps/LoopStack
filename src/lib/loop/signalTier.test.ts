import { describe, it, expect } from 'vitest';
import {
  tierFor,
  canStage,
  isVisible,
  isPromoted,
  ESTABLISHED_MIN,
  EMERGING_MIN,
  CODE_PROMOTION_MIN,
} from './signalTier';

describe('tierFor', () => {
  it('sorts scores into the three tiers at their boundaries', () => {
    expect(tierFor(100)).toBe('established');
    expect(tierFor(ESTABLISHED_MIN)).toBe('established');
    expect(tierFor(ESTABLISHED_MIN - 1)).toBe('emerging');
    expect(tierFor(EMERGING_MIN)).toBe('emerging');
    expect(tierFor(EMERGING_MIN - 1)).toBe('noise');
    expect(tierFor(0)).toBe('noise');
  });

  it('treats a missing or unusable score as noise rather than as zero-confidence signal', () => {
    // A finding with no score is not a weak finding — it is a finding the
    // engine could not measure. Surfacing it as "early signal" would put an
    // unmeasured claim next to measured ones.
    expect(tierFor(undefined)).toBe('noise');
    expect(tierFor(null)).toBe('noise');
    expect(tierFor(NaN)).toBe('noise');
  });
});

describe('canStage — the safety gate', () => {
  it('only ever opens for established findings', () => {
    expect(canStage(ESTABLISHED_MIN)).toBe(true);
    expect(canStage(99)).toBe(true);
    expect(canStage(ESTABLISHED_MIN - 1)).toBe(false);
    expect(canStage(EMERGING_MIN)).toBe(false);
    expect(canStage(0)).toBe(false);
    expect(canStage(undefined)).toBe(false);
  });

  /**
   * The rule the tier system exists to enforce. An emerging finding is allowed
   * to be seen and is never allowed to become a therapy change — the Commit Log
   * is the only path in this app that ends at a real adjustment, and nothing
   * below the evidence bar may reach it.
   */
  it('never lets a visible-but-emerging finding become committable', () => {
    for (let score = EMERGING_MIN; score < ESTABLISHED_MIN; score++) {
      expect(isVisible(score)).toBe(true);
      expect(canStage(score)).toBe(false);
    }
  });

  it('agrees with the previous single threshold, so nothing loses commitability', () => {
    // The old bar was `percent >= 60`. Tiering must not have narrowed it.
    for (const score of [60, 61, 75, 80, 100]) expect(canStage(score)).toBe(true);
    for (const score of [0, 34, 35, 59]) expect(canStage(score)).toBe(false);
  });
});

describe('isPromoted', () => {
  it('holds code-surface findings to a higher bar than settings or habits', () => {
    const justEstablished = ESTABLISHED_MIN; // 60
    expect(isPromoted(justEstablished, 'settings')).toBe(true);
    expect(isPromoted(justEstablished, 'behaviour')).toBe(true);
    // Same evidence, but this one asks for a source edit and a rebuild.
    expect(isPromoted(justEstablished, 'code')).toBe(false);
    expect(isPromoted(CODE_PROMOTION_MIN, 'code')).toBe(true);
  });

  it('never promotes anything that cannot be staged', () => {
    for (const surface of ['settings', 'code', 'behaviour'] as const) {
      expect(isPromoted(EMERGING_MIN, surface)).toBe(false);
      expect(isPromoted(undefined, surface)).toBe(false);
    }
  });
});
