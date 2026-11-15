import { describe, it, expect } from 'vitest';
import { classifyGlucose, glucoseAdvisory, type CurrentGlucose } from './glucoseStatus';

const g = (mgdl: number, per5 = 0): CurrentGlucose => ({
  mgdl,
  ratePer5min: per5,
  ratePer20min: per5 * 4,
  lastUpdatedIso: new Date().toISOString(),
});

/**
 * The default band is 65–180 (loopTherapyStore DEFAULT_TARGET_RANGE) unless a
 * stored override says otherwise. These tests run without localStorage, so the
 * defaults apply.
 */
describe('classifyGlucose', () => {
  it('scores against the configured band, not hardcoded constants', () => {
    // 121 used to be `urgent_high` off a hardcoded 120 — a value inside Ryan's
    // own Loop correction range, which painted the hero red at target.
    expect(classifyGlucose(g(121))).toBe('in_range');
    expect(classifyGlucose(g(179))).toBe('in_range');
    expect(classifyGlucose(g(181))).toBe('urgent_high');
    // 67 used to be `low` off a hardcoded 70 while the time-in-range bar
    // counted the same reading as in range.
    expect(classifyGlucose(g(67))).toBe('in_range');
    expect(classifyGlucose(g(64))).toBe('low');
  });

  /**
   * The mislabel this status was added to fix. A steep fall is a statement
   * about urgency; it was implemented as a statement about the number, so a
   * severe high rendered green with "Standard meal strategy is fine."
   */
  it('never calls a high reading in range, however fast it is falling', () => {
    for (const mgdl of [181, 220, 300, 400]) {
      for (const per5 of [-3, -5, -10, -20]) {
        const status = classifyGlucose(g(mgdl, per5));
        expect(status).not.toBe('in_range');
        expect(status).not.toBe('low');
      }
    }
    // Falling fast is still distinguished from not falling.
    expect(classifyGlucose(g(300, -5))).toBe('high_falling');
    expect(classifyGlucose(g(300, 0))).toBe('urgent_high');
  });

  it('flags a fast climb near the top of the band', () => {
    expect(classifyGlucose(g(170, 5))).toBe('elevated_rising');
    expect(classifyGlucose(g(170, 1))).toBe('in_range');
  });
});

/**
 * The safety contract, executable.
 *
 * docs/principles.md #5: recommendations are pattern support, not medical
 * commands. This banner is the single most-seen string in the app — it renders
 * on the home hero above everything else — and it previously issued insulin
 * timing instructions ("a small pre-bolus 15–20 min ahead", "Hold any
 * pre-bolus") justified by outcomes it had no data to know.
 */
describe('glucoseAdvisory — safety contract', () => {
  const SAMPLES: CurrentGlucose[] = [
    g(45), g(60, -2), g(64), g(70), g(100), g(120), g(140, 5), g(170, 6),
    g(179), g(181), g(200, 3), g(250, -1), g(300, -10), g(400, 8),
    g(90, -6), g(90, 7), g(150, -8),
  ];

  it('never issues an insulin instruction', () => {
    // "pre-bolus" as a verb, dose magnitudes, and imperatives about insulin.
    const BANNED = [
      /pre-bolus(ing)?\s+\d/i,
      /\bpre-bolus\b/i,
      /\btake\b[^.]{0,20}\b(unit|u\b)/i,
      /\bhold\b[^.]{0,20}\b(bolus|insulin)/i,
      /\b(increase|decrease|raise|lower|reduce)\b[^.]{0,20}\b(basal|bolus|insulin|dose)/i,
      /\bmore conservative\b/i,
      /\b\d+(\.\d+)?\s*(u|units)\b/i,
    ];
    for (const sample of SAMPLES) {
      const copy = glucoseAdvisory(sample);
      for (const pattern of BANNED) {
        expect(
          pattern.test(copy),
          `"${copy}" (at ${sample.mgdl} mg/dL) matched banned pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it('never claims an outcome it did not measure', () => {
    // The function receives only the current reading. Any past-tense empirical
    // claim it makes is necessarily fabricated.
    const FABRICATED = [
      /matched better outcomes/i,
      /\bdid better\b/i,
      /\bhave (been|shown|matched)\b/i,
      /in patterns like this/i,
      /\bhistorically\b/i,
    ];
    for (const sample of SAMPLES) {
      const copy = glucoseAdvisory(sample);
      for (const pattern of FABRICATED) {
        expect(
          pattern.test(copy),
          `"${copy}" (at ${sample.mgdl} mg/dL) asserts unmeasured evidence: ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it('never tells a severe high that a standard meal strategy is fine', () => {
    for (const per5 of [-20, -10, -5, 0, 5]) {
      expect(glucoseAdvisory(g(300, per5)).toLowerCase()).not.toContain('in range and steady');
    }
  });

  it('still says something useful in every state', () => {
    for (const sample of SAMPLES) {
      const copy = glucoseAdvisory(sample);
      expect(copy.length).toBeGreaterThan(20);
      expect(copy.trim()).toBe(copy);
    }
  });

  it('keeps the low branch free of a carb amount', () => {
    const copy = glucoseAdvisory(g(52));
    expect(copy).toMatch(/low/i);
    expect(/\b\d+\s*(g|grams|carbs)\b/i.test(copy)).toBe(false);
  });
});
