import { describe, expect, it } from 'vitest';
import { compareIobToLoop, AGREEMENT_FLOOR_PCT, type LoopIobSample } from './iobAgreement';
import { iobAt, modelFromTherapy, netInsulinImpulses } from './insulinActivity';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { InsulinEvent } from '@/data/sources/types';

const therapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
  insulinSensitivitySchedule: [{ startMinutes: 0, value: 40 }],
  carbRatioSchedule: [{ startMinutes: 0, value: 10 }],
  insulinDurationHours: 6,
} as unknown as LoopTherapy;

const T0 = new Date(2026, 2, 1, 8, 0, 0).getTime();

/** Boluses every two hours for a day. */
const insulin: InsulinEvent[] = Array.from({ length: 12 }, (_, i) => ({
  iso: new Date(T0 + i * 2 * 3600_000).toISOString(),
  units: 2,
  kind: 'bolus' as const,
}));

/** Loop's own readings, generated from `f` applied to our own curve. */
function loopSamples(f: (ours: number) => number): LoopIobSample[] {
  const model = modelFromTherapy(therapy);
  const impulses = netInsulinImpulses(insulin, therapy);
  return Array.from({ length: 200 }, (_, i) => {
    const t = T0 + 10 * 60_000 + i * 5 * 60_000;
    return { iso: new Date(t).toISOString(), iob: f(iobAt(t, impulses, model)) };
  });
}

describe('IOB agreement', () => {
  it('reports a strong match when Loop agrees with us', () => {
    const r = compareIobToLoop({ insulin, therapy, loopIob: loopSamples((x) => x) });
    expect(r).not.toBeNull();
    expect(r!.agreementPct).toBe(100);
    expect(r!.trustworthy).toBe(true);
    expect(r!.note).toContain('complete');
  });

  it('flags insulin the app never saw', () => {
    // Loop carries more insulin than we reconstructed — the signature of temp
    // basals that are not reaching Nightscout.
    const r = compareIobToLoop({ insulin, therapy, loopIob: loopSamples((x) => x + 1.5) });
    expect(r!.trustworthy).toBe(false);
    expect(r!.biasU).toBeLessThan(0);
    expect(r!.note).toContain('not being uploaded');
  });

  it('flags a duration on file that outlasts the pump', () => {
    const r = compareIobToLoop({
      insulin,
      therapy,
      loopIob: loopSamples((x) => Math.max(0, x - 1.5)),
    });
    expect(r!.trustworthy).toBe(false);
    expect(r!.biasU).toBeGreaterThan(0);
    expect(r!.note.toLowerCase()).toContain('duration');
  });

  it('needs enough paired readings before it says anything', () => {
    const few = loopSamples((x) => x).slice(0, 5);
    expect(compareIobToLoop({ insulin, therapy, loopIob: few })).toBeNull();
  });

  it('returns null rather than guessing when Loop published nothing', () => {
    expect(compareIobToLoop({ insulin, therapy, loopIob: [] })).toBeNull();
  });

  it('returns null when there is no insulin history to compare', () => {
    expect(
      compareIobToLoop({ insulin: [], therapy, loopIob: loopSamples((x) => x) }),
    ).toBeNull();
  });

  it('ignores unparseable or non-numeric samples instead of returning NaN', () => {
    const dirty: LoopIobSample[] = [
      ...loopSamples((x) => x),
      { iso: 'nonsense', iob: 3 },
      { iso: new Date(T0 + 3600_000).toISOString(), iob: Number.NaN },
    ];
    const r = compareIobToLoop({ insulin, therapy, loopIob: dirty });
    expect(Number.isFinite(r!.agreementPct)).toBe(true);
    expect(Number.isFinite(r!.meanAbsDiffU)).toBe(true);
  });

  it('does not call a near-zero stretch a total disagreement', () => {
    // A day spent mostly at zero IOB must not turn a 0.1 U difference into 0%.
    const quiet: InsulinEvent[] = [
      { iso: new Date(T0).toISOString(), units: 0.2, kind: 'bolus' },
      { iso: new Date(T0 + 20 * 3600_000).toISOString(), units: 0.2, kind: 'bolus' },
    ];
    const model = modelFromTherapy(therapy);
    const impulses = netInsulinImpulses(quiet, therapy);
    const samples: LoopIobSample[] = Array.from({ length: 200 }, (_, i) => {
      const t = T0 + 10 * 60_000 + i * 5 * 60_000;
      return { iso: new Date(t).toISOString(), iob: iobAt(t, impulses, model) + 0.1 };
    });
    const r = compareIobToLoop({ insulin: quiet, therapy, loopIob: samples });
    expect(r!.agreementPct).toBeGreaterThan(AGREEMENT_FLOOR_PCT);
  });
});
