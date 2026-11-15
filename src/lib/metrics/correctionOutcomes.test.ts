import { describe, expect, it } from 'vitest';
import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import { isfAt, realLoopTherapy } from '@/data/loopTherapy';
import { iobFraction, modelFromTherapy } from '@/lib/metabolism/insulinActivity';
import { computeCorrectionOutcomes } from './correctionOutcomes';

const MIN = 60_000;
const START = new Date(2026, 9, 1, 0, 0, 0).getTime();
const at = (day: number, h: number, m = 0) => START + (day * 24 * 60 + h * 60 + m) * MIN;
const iso = (t: number) => new Date(t).toISOString();
const therapy = realLoopTherapy;
const model = modelFromTherapy(therapy);

/** Glucose that falls exactly `scale` × what ISF predicts after each correction. */
function setup(corrections: { t: number; units: number }[], scale: number) {
  const glucose: GlucoseReading[] = [];
  for (let t = START; t < at(5, 0); t += 5 * MIN) {
    let v = 220;
    for (const c of corrections) {
      const mins = (t - c.t) / MIN;
      if (mins > 0) v -= scale * c.units * isfAt(therapy, new Date(c.t)) * (1 - iobFraction(mins, model));
    }
    glucose.push({ iso: iso(t), mgdl: v });
  }
  const insulin: InsulinEvent[] = corrections.map((c) => ({ iso: iso(c.t), units: c.units, kind: 'bolus' }));
  return { glucose, insulin, therapy, lowMgdl: 70, now: new Date(at(5, 0)), windowDays: 5 };
}

describe('computeCorrectionOutcomes', () => {
  it('reads observed against the ISF-predicted change at 2 and 3 hours', () => {
    const c = computeCorrectionOutcomes({ ...setup([{ t: at(1, 14), units: 1 }], 1), carbs: [] });
    expect(c.clean).toBe(1);
    expect(c.at3h.medianAchievedPct).toBe(100);
    expect(c.at2h.medianAchievedPct).toBe(100);
    expect(c.at3h.medianObservedMgdl).toBe(c.at3h.medianPredictedMgdl);
    expect(c.at3h.medianObservedMgdl!).toBeLessThan(0);
    expect(c.medianStartMgdl).toBe(220);
  });

  it('says when glucose fell less than the ISF predicts', () => {
    const c = computeCorrectionOutcomes({ ...setup([{ t: at(1, 14), units: 1 }], 0.5), carbs: [] });
    expect(c.at3h.medianAchievedPct).toBe(50);
  });

  it('excludes boluses near carbs, stacked boluses and small doses', () => {
    const s = setup([{ t: at(1, 14), units: 1 }, { t: at(2, 14), units: 1 }, { t: at(2, 15), units: 1 }, { t: at(3, 14), units: 0.3 }], 1);
    const carbs: CarbEntry[] = [{ iso: iso(at(1, 13)), grams: 40, absorptionHours: 3 }];
    const c = computeCorrectionOutcomes({ ...s, carbs });
    // Day 1 is near carbs; day 2's pair stack; day 3 is under 0.5 U.
    expect(c.candidates).toBe(2);
    expect(c.clean).toBe(0);
    expect(c.at3h.medianAchievedPct).toBeNull();
  });

  it('counts corrections followed by a low', () => {
    // A dose sized to land 40 mg/dL under the low line by 3 hours.
    const isf = isfAt(therapy, new Date(at(1, 14)));
    const units = (220 - 30) / (isf * (1 - iobFraction(180, model)));
    const c = computeCorrectionOutcomes({ ...setup([{ t: at(1, 14), units }], 1), carbs: [] });
    expect(c.followedByLow).toBe(1);
  });
});
