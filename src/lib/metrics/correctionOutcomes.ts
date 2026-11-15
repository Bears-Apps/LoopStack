import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import { isfAt, type LoopTherapy } from '@/data/loopTherapy';
import { iobFraction, modelFromTherapy } from '@/lib/metabolism/insulinActivity';
import { median, windowed } from '@/lib/metrics/hypoEvents';

// Correction-bolus outcomes: what glucose did 2 and 3 hours after a bolus
// given without food, against what the ISF on file predicts for that dose.
//
// Predicted change = −units × ISF at the time × the share of the dose that
// has acted by then (the app's own insulin curve). The ratio of observed to
// predicted is the read: near 100% means the ISF describes these corrections;
// well under means glucose fell less than the ISF expects, well over more.
//
// Only clean corrections count, because anything else confounds the fall:
//   - no carb entry from 3 h before to 3 h after (absorbing or new food),
//   - other boluses in the 2 h before to 3 h after under a quarter of this
//     dose (stacking — which also excludes most automatic-bolus micro-doses),
//   - readings at the start, 2 h and 3 h.
// Loop's temp basals keep acting through the window (often a zero temp after a
// correction), so this is a read of the whole system's response to a
// correction, not of ISF alone. The report says so beside the numbers.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MIN_UNITS = 0.5;
const CARB_CLEAR_MIN = 180;
const PRIOR_BOLUS_MIN = 120;
const STACK_LIMIT = 0.25;
const NEAR_MINUTES = 10;

export type CorrectionHorizon = {
  medianObservedMgdl: number | null;
  medianPredictedMgdl: number | null;
  /** Median of observed ÷ predicted, as a percentage. */
  medianAchievedPct: number | null;
};

export type CorrectionOutcomes = {
  windowDays: number;
  /** Boluses of 0.5 U or more with no carbs nearby. */
  candidates: number;
  /** Candidates that also passed the stacking and reading checks. */
  clean: number;
  medianUnits: number | null;
  medianStartMgdl: number | null;
  at2h: CorrectionHorizon;
  at3h: CorrectionHorizon;
  /** Clean corrections followed by a reading below the low line within 3 h. */
  followedByLow: number;
};

export function computeCorrectionOutcomes(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  lowMgdl: number;
  now: Date;
  windowDays: number;
}): CorrectionOutcomes {
  const end = input.now.getTime();
  const start = end - input.windowDays * DAY;
  const readings = windowed(input.glucose, input.now, input.windowDays + 1);
  const model = modelFromTherapy(input.therapy);
  const near = (t: number): number | null => {
    let best: number | null = null;
    let bestD = NEAR_MINUTES * MIN + 1;
    for (const r of readings) {
      const d = Math.abs(r.t - t);
      if (d < bestD) {
        bestD = d;
        best = r.mgdl;
      }
      if (r.t > t + NEAR_MINUTES * MIN) break;
    }
    return best;
  };
  const carbTimes = input.carbs.filter((c) => c.grams > 0).map((c) => Date.parse(c.iso));
  const boluses = input.insulin
    .filter((i) => i.kind === 'bolus' && i.units > 0)
    .map((i) => ({ t: Date.parse(i.iso), units: i.units }))
    .filter((b) => Number.isFinite(b.t))
    .sort((a, b) => a.t - b.t);

  const rows: { units: number; startMgdl: number; obs2: number; pred2: number; obs3: number; pred3: number; low: boolean }[] = [];
  let candidates = 0;
  for (const b of boluses) {
    // Needs its full 3 hours inside the data.
    if (b.t < start || b.t + 180 * MIN > end || b.units < MIN_UNITS) continue;
    if (carbTimes.some((c) => Math.abs(c - b.t) <= CARB_CLEAR_MIN * MIN)) continue;
    candidates++;
    const others = boluses
      .filter((o) => o !== b && o.t >= b.t - PRIOR_BOLUS_MIN * MIN && o.t <= b.t + 180 * MIN)
      .reduce((a, o) => a + o.units, 0);
    if (others > b.units * STACK_LIMIT) continue;
    const g0 = near(b.t);
    const g2 = near(b.t + 120 * MIN);
    const g3 = near(b.t + 180 * MIN);
    if (g0 == null || g2 == null || g3 == null) continue;
    const isf = isfAt(input.therapy, new Date(b.t));
    const predicted = (mins: number) => -b.units * isf * (1 - iobFraction(mins, model));
    rows.push({
      units: b.units,
      startMgdl: g0,
      obs2: g2 - g0,
      pred2: predicted(120),
      obs3: g3 - g0,
      pred3: predicted(180),
      low: readings.some((r) => r.t > b.t && r.t <= b.t + 180 * MIN && r.mgdl < input.lowMgdl),
    });
  }

  const round = (x: number | null) => (x == null ? null : Math.round(x));
  const horizon = (obs: number[], pred: number[]): CorrectionHorizon => ({
    medianObservedMgdl: round(median(obs)),
    medianPredictedMgdl: round(median(pred)),
    medianAchievedPct: round(median(obs.map((o, i) => (pred[i] !== 0 ? (o / pred[i]) * 100 : 0)))),
  });
  return {
    windowDays: input.windowDays,
    candidates,
    clean: rows.length,
    medianUnits: rows.length ? Math.round((median(rows.map((r) => r.units)) ?? 0) * 100) / 100 : null,
    medianStartMgdl: round(median(rows.map((r) => r.startMgdl))),
    at2h: horizon(rows.map((r) => r.obs2), rows.map((r) => r.pred2)),
    at3h: horizon(rows.map((r) => r.obs3), rows.map((r) => r.pred3)),
    followedByLow: rows.filter((r) => r.low).length,
  };
}
