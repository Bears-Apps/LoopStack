import type { InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import { iobAt, modelFromTherapy, netInsulinImpulses } from './insulinActivity';

// Does our reconstruction of insulin-on-board match Loop's own?
//
// Every deviation-based insight rests on rebuilding insulin activity from
// treatment records. That reconstruction can be quietly wrong in ways nothing
// else catches: temp basals that never uploaded, a duration on file that does
// not match the pump, a site change that lost an hour of records. The result
// still looks like a confident number.
//
// Loop already publishes its own IOB to Nightscout on every cycle. Comparing
// against it converts "we assume this is right" into "we checked". It cannot
// replace the reconstruction — the maths needs insulin *activity*, the rate at
// which insulin is working, and devicestatus only carries the level — but as a
// check on the same underlying stream it is exactly the right instrument.
//
// A poor match is not a reason to hide the insights. It is a reason to say so.

/** One of Loop's own IOB readings, from a devicestatus upload. */
export type LoopIobSample = {
  iso: string;
  iob: number;
};

/** Below this share of agreement, the reconstruction is not to be trusted. */
export const AGREEMENT_FLOOR_PCT = 70;

/** Samples needed before agreement means anything. */
const MIN_SAMPLES = 50;

/** How far a paired reading may sit from Loop's timestamp, in minutes. */
const PAIR_TOLERANCE_MINUTES = 3;

export type IobAgreement = {
  /** Loop readings that could be paired with our own. */
  sampleCount: number;
  /** Mean absolute difference in units. */
  meanAbsDiffU: number;
  /** Agreement as a percentage, 0–100. */
  agreementPct: number;
  /** Signed mean: positive means our figure runs above Loop's. */
  biasU: number;
  trustworthy: boolean;
  note: string;
};

/**
 * Compare reconstructed IOB against Loop's, at the moments Loop reported.
 *
 * Agreement is scaled by the typical IOB carried rather than being a raw error:
 * being 0.3 U out matters far more on a 1 U baseline than on a 6 U one.
 */
export function compareIobToLoop(input: {
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  loopIob: LoopIobSample[];
}): IobAgreement | null {
  const { therapy, loopIob } = input;
  if (loopIob.length === 0) return null;

  const model = modelFromTherapy(therapy);
  const impulses = netInsulinImpulses(input.insulin, therapy);
  if (impulses.length === 0) return null;

  const tolerance = PAIR_TOLERANCE_MINUTES * 60_000;
  const diffs: number[] = [];
  const levels: number[] = [];

  for (const sample of loopIob) {
    const t = new Date(sample.iso).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(sample.iob)) continue;
    // Only compare inside the span our impulses actually cover — outside it we
    // would be measuring missing history rather than a modelling difference.
    if (t < impulses[0].ms + tolerance) continue;
    if (t > impulses[impulses.length - 1].ms + model.durationMinutes * 60_000) continue;

    const ours = iobAt(t, impulses, model);
    diffs.push(ours - sample.iob);
    levels.push(Math.abs(sample.iob));
  }

  if (diffs.length < MIN_SAMPLES) return null;

  const meanAbsDiff = diffs.reduce((a, d) => a + Math.abs(d), 0) / diffs.length;
  const bias = diffs.reduce((a, d) => a + d, 0) / diffs.length;
  // Floor the baseline so a stretch spent near zero IOB cannot make a 0.1 U
  // difference read as total disagreement.
  const typicalLevel = Math.max(0.5, levels.reduce((a, l) => a + l, 0) / levels.length);
  const agreementPct = Math.max(0, Math.min(100, Math.round((1 - meanAbsDiff / typicalLevel) * 100)));
  const trustworthy = agreementPct >= AGREEMENT_FLOOR_PCT;

  let note: string;
  if (trustworthy) {
    note = `Insulin-on-board reconstructed here tracks Loop's own figure to within ${meanAbsDiff.toFixed(2)} U on average across ${diffs.length} checks — the insulin history these readings are built on is complete.`;
  } else if (bias < 0) {
    note = `Insulin-on-board reconstructed here runs about ${Math.abs(bias).toFixed(2)} U below Loop's own figure across ${diffs.length} checks. Insulin is reaching the pump that is not reaching this app — usually temp basals that are not being uploaded — so glucose will look like it fell for no reason and sensitivity will read high.`;
  } else {
    note = `Insulin-on-board reconstructed here runs about ${bias.toFixed(2)} U above Loop's own figure across ${diffs.length} checks. The duration of insulin action on file is the usual cause, and it makes insulin look like it is still working when Loop has already written it off.`;
  }

  return {
    sampleCount: diffs.length,
    meanAbsDiffU: +meanAbsDiff.toFixed(3),
    agreementPct,
    biasU: +bias.toFixed(3),
    trustworthy,
    note,
  };
}
