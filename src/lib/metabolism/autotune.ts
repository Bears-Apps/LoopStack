import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import { dailyBasalTotal, valueAt } from '@/data/loopTherapy';
import { compareIobToLoop, type IobAgreement, type LoopIobSample } from './iobAgreement';
import {
  computeDeviations,
  flatCarbRatio,
  flatIsf,
  seedCsf,
  STEP_MINUTES,
  type DeviationStep,
} from './deviations';

// Autotune: what does weeks of history say about the settings themselves?
//
// Where Autosens asks "what kind of day is this", Autotune asks the slower
// question — over enough history to average out illness, sites and stress, do
// the basal schedule, the sensitivity factor and the carb ratio still match
// what the data shows? It answers by sorting every five-minute deviation into
// the thing that best explains it and reading each bucket separately:
//
//   deviations with no food in play, by hour  ->  basal
//   deviations with no food in play, overall  ->  ISF
//   deviations while food was absorbing       ->  carb ratio
//
// Three properties of the real algorithm are load-bearing and easy to lose:
//
// 1. It damps every recommendation to 20% of the computed correction. A single
//    run is a nudge, not a verdict — the design assumes repeated runs over
//    weeks, and an undamped version would oscillate.
//
// 2. It tunes ONE flat ISF and ONE flat carb ratio. Only basal varies by hour.
//    There is no time-of-day ISF or carb-ratio tuning in this family of tools,
//    so a schedule has to be flattened before it can be used as a seed, and
//    per-block ISF/CR figures must never be presented.
//
// 3. Its validity is gated per-output on how completely carbs were logged, not
//    uniformly. With no carb data at all, overnight basals are still readable,
//    ISF is doubtful, and carb ratio is worthless. That gate is enforced in
//    code below rather than left to the reader.
//
// LoopStack reports what the numbers say and stops there. It does not change a
// schedule, and it does not tell anyone to.

/** Fraction of the computed correction applied per run. oref0's damping. */
export const DAMPING = 0.2;

/** Days of history below which nothing is reported. */
export const MIN_DAYS = 7;
/** Clean steps in an hour bucket before that hour's basal can be read. */
export const MIN_STEPS_PER_HOUR = 36;
/** Absorbing steps needed before carb ratio can be read at all. */
export const MIN_CARB_STEPS = 100;
/** Logged meals needed before carb ratio can be read at all. */
export const MIN_MEALS = 15;

/** How far a single run is allowed to move any parameter, as a fraction. Even
 *  after damping, a run built on thin data must not swing a setting wildly. */
const MAX_MOVE = 0.2;

/** Below this share of days carrying at least one carb entry, carb-derived
 *  outputs are suppressed rather than shown with a caveat. */
const CARB_DAY_COVERAGE_FLOOR = 0.5;

export type Confidence = 'good' | 'limited' | 'unusable';

export type CarbLogQuality = {
  /** Days in the window with at least one carb entry. */
  daysWithCarbs: number;
  daysInWindow: number;
  /** Share of days carrying carbs, 0–100. */
  coveragePct: number;
  /** Meals logged in the window. */
  mealCount: number;
  /** Steps quarantined as unannounced-meal rises — the direct evidence of
   *  meals that happened but were never logged. */
  uamStepCount: number;
  /** Share of all steps quarantined as UAM, 0–100. */
  uamSharePct: number;
  note: string;
};

export type BasalHourRecommendation = {
  hour: number;
  scheduledRate: number;
  /** Rate the deviations imply, before damping. */
  impliedRate: number;
  /** Rate after 20% damping — what a single run would actually move toward. */
  dampedRate: number;
  /** dampedRate − scheduledRate. */
  deltaU: number;
  stepCount: number;
  /** Mean unexplained deviation in this hour, mg/dL per 5 min. */
  meanDeviation: number;
  confidence: Confidence;
};

export type AutotuneResult = {
  windowDays: number;
  /** Days that actually carried readings. */
  daysWithData: number;
  carbQuality: CarbLogQuality;
  /** How closely the reconstructed insulin history matches Loop's own IOB.
   *  Null when Loop published none to compare against. */
  iobAgreement: IobAgreement | null;

  basal: {
    hours: BasalHourRecommendation[];
    /** Scheduled U/day across the whole schedule. */
    scheduledDailyU: number;
    /** U/day the damped recommendation adds up to. */
    impliedDailyU: number;
    confidence: Confidence;
    note: string;
  };

  isf: {
    current: number;
    implied: number | null;
    damped: number | null;
    confidence: Confidence;
    note: string;
  };

  carbRatio: {
    current: number;
    implied: number | null;
    damped: number | null;
    /** Observed carb sensitivity, mg/dL per gram. */
    observedCsf: number | null;
    seededCsf: number;
    mealCount: number;
    confidence: Confidence;
    note: string;
  };

  /** Evidence-phrased review lines, already filtered by confidence. */
  suggestions: string[];
};

const ms = (iso: string) => new Date(iso).getTime();
const dayKey = (t: number) => new Date(t).toDateString();

/** Move `from` toward `to` by the damping factor, capped by MAX_MOVE. */
function damp(from: number, to: number): number {
  if (from <= 0) return to;
  const target = from + (to - from) * DAMPING;
  const lo = from * (1 - MAX_MOVE);
  const hi = from * (1 + MAX_MOVE);
  return Math.min(hi, Math.max(lo, target));
}

function assessCarbLogging(
  carbs: CarbEntry[],
  steps: DeviationStep[],
  daysInWindow: number,
): CarbLogQuality {
  const carbDays = new Set(carbs.map((c) => dayKey(ms(c.iso))));
  const daysWithCarbs = carbDays.size;
  const coveragePct = daysInWindow > 0 ? Math.round((daysWithCarbs / daysInWindow) * 100) : 0;
  const uamStepCount = steps.filter((s) => s.bucket === 'uam').length;
  const uamSharePct = steps.length > 0 ? Math.round((uamStepCount / steps.length) * 100) : 0;

  let note: string;
  if (carbs.length === 0) {
    note =
      'No carb entries in this window. Without them there is no way to tell a meal apart from a basal gap, so only the overnight and other food-free stretches below are readable — carb ratio is not reported at all.';
  } else if (coveragePct < CARB_DAY_COVERAGE_FLOOR * 100) {
    note = `Carbs were logged on ${daysWithCarbs} of ${daysInWindow} days. Unlogged meals land in the basal reading as if they were a gap in coverage, so figures from this window run high.`;
  } else if (uamSharePct >= 15) {
    note = `${uamSharePct}% of readings show a rise with nothing logged against it. Those stretches are set aside rather than blamed on basal, but a high share means meals are being missed.`;
  } else {
    note = `Carbs logged on ${daysWithCarbs} of ${daysInWindow} days, with ${uamSharePct}% of readings showing an unexplained rise. Good enough to read all three.`;
  }

  return {
    daysWithCarbs,
    daysInWindow,
    coveragePct,
    mealCount: carbs.length,
    uamStepCount,
    uamSharePct,
    note,
  };
}

export function computeAutotune(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  /** Loop's own IOB readings, when the source can supply them. Used only to
   *  check the reconstruction — never as an input to the maths. */
  loopIob?: LoopIobSample[];
  windowDays?: number;
  now: Date;
}): AutotuneResult {
  const windowDays = input.windowDays ?? 21;
  const { therapy, now } = input;
  const startMs = now.getTime() - windowDays * 24 * 3600_000;
  const since = <T extends { iso: string }>(xs: T[]) => xs.filter((x) => ms(x.iso) >= startMs);

  const glucose = since(input.glucose);
  const carbs = since(input.carbs);
  const currentIsf = flatIsf(therapy);
  const currentCr = flatCarbRatio(therapy);

  // Insulin is not windowed — doses from just before the window are still
  // acting inside it.
  const { steps, cleanSteps, carbSteps } = computeDeviations({
    glucose,
    carbs,
    insulin: input.insulin,
    therapy,
  });

  const daysWithData = new Set(glucose.map((g) => dayKey(ms(g.iso)))).size;
  const carbQuality = assessCarbLogging(carbs, steps, daysWithData);

  const iobAgreement = input.loopIob?.length
    ? compareIobToLoop({ insulin: input.insulin, therapy, loopIob: since(input.loopIob) })
    : null;
  // A reconstruction that disagrees with Loop's own IOB is not a caveat, it is
  // a missing input. Everything downstream is measured against insulin we know
  // is incomplete, so nothing here gets to claim more than "limited".
  const iobUntrustworthy = iobAgreement != null && !iobAgreement.trustworthy;

  // The segment-weighted total, so this agrees with the Basal hub and the
  // Profile mirror. Summing the 24 hourly samples instead would drift by a few
  // hundredths whenever a segment starts mid-hour, and two screens quoting
  // different "scheduled U/day" is the kind of small contradiction that costs
  // trust in every other number on the page.
  const scheduledDailyU = therapy.basalSchedule.length ? dailyBasalTotal(therapy) : 0;

  // ── basal, by hour ────────────────────────────────────────────────────────
  //
  // A positive mean deviation in an hour means glucose rose beyond what the
  // insulin explains while no food was in play — the hour is under-covered.
  // Convert that mg/dL-per-5-min into the U/hr that would have cancelled it.
  const hours: BasalHourRecommendation[] = Array.from({ length: 24 }, (_, hour) => {
    const mine = cleanSteps.filter((s) => s.hour === hour);
    const scheduledRate = valueAt(therapy.basalSchedule, hour * 60);
    const meanDeviation =
      mine.length > 0 ? mine.reduce((a, s) => a + s.deviation, 0) / mine.length : 0;

    if (mine.length < MIN_STEPS_PER_HOUR || currentIsf <= 0) {
      return {
        hour,
        scheduledRate,
        impliedRate: scheduledRate,
        dampedRate: scheduledRate,
        deltaU: 0,
        stepCount: mine.length,
        meanDeviation: +meanDeviation.toFixed(2),
        confidence: 'unusable' as Confidence,
      };
    }

    const impliedRate = Math.max(
      0,
      scheduledRate + (meanDeviation * (60 / STEP_MINUTES)) / currentIsf,
    );
    const dampedRate = Math.max(0, damp(scheduledRate, impliedRate));

    return {
      hour,
      scheduledRate,
      impliedRate: +impliedRate.toFixed(3),
      dampedRate: +dampedRate.toFixed(3),
      deltaU: +(dampedRate - scheduledRate).toFixed(3),
      stepCount: mine.length,
      meanDeviation: +meanDeviation.toFixed(2),
      confidence: carbQuality.uamSharePct >= 25 ? 'limited' : 'good',
    };
  });

  const readableHours = hours.filter((h) => h.confidence !== 'unusable');
  // Built as the scheduled total plus the hour-by-hour changes, rather than as
  // a raw sum of the 24 damped rates, so it stays directly comparable with the
  // scheduled figure above.
  const impliedDailyU = +(
    scheduledDailyU + hours.reduce((a, h) => a + h.deltaU, 0)
  ).toFixed(2);

  let basalConfidence: Confidence = 'good';
  if (daysWithData < MIN_DAYS || readableHours.length < 6) basalConfidence = 'unusable';
  else if (
    iobUntrustworthy ||
    carbQuality.uamSharePct >= 25 ||
    carbQuality.coveragePct < CARB_DAY_COVERAGE_FLOOR * 100
  )
    basalConfidence = 'limited';

  const basalNote =
    basalConfidence === 'unusable'
      ? `${daysWithData} of ${MIN_DAYS} days with enough food-free readings. Basal needs quiet stretches, and there are not enough yet.`
      : `Read from ${readableHours.length} hours of the day across ${daysWithData} days. Each figure is damped to ${Math.round(DAMPING * 100)}% of the computed correction, which is how this method is meant to be run — a nudge per pass, over weeks.`;

  // ── ISF ───────────────────────────────────────────────────────────────────
  //
  // One flat number, never a schedule. A persistent positive deviation across
  // all food-free time means insulin is doing less than the settings claim, so
  // the true ISF is smaller than the one on file.
  const meanCleanDeviation =
    cleanSteps.length > 0
      ? cleanSteps.reduce((a, s) => a + s.deviation, 0) / cleanSteps.length
      : 0;

  let isfConfidence: Confidence = 'good';
  if (cleanSteps.length < MIN_STEPS_PER_HOUR * 6 || currentIsf <= 0) isfConfidence = 'unusable';
  else if (iobUntrustworthy || carbs.length === 0 || carbQuality.uamSharePct >= 15)
    isfConfidence = 'limited';

  let impliedIsf: number | null = null;
  let dampedIsf: number | null = null;
  if (isfConfidence !== 'unusable') {
    // Fractional ISF error, and every step of that has to be dimensionally real.
    //
    // meanCleanDeviation is mg/dL per 5 min; ×12 makes it mg/dL per hour;
    // dividing by ISF (mg/dL per U) yields U/hr — insulin action the model did
    // not account for. This was then added directly to 1 as though it were a
    // fraction, which silently asserts that 1 U/hr of unexplained need equals a
    // 100% ISF error. That is only true for someone whose basal is exactly
    // 1 U/hr: on Ryan's ~0.4–0.8 U/hr schedule the correction came out
    // under-scaled, and on a 2 U/hr profile it would be over-scaled.
    //
    // Normalising by the insulin economy makes it a genuine ratio. Autosens
    // does the same thing twelve lines into its own file, where the comment
    // warns that "dividing by ISF alone (the obvious-looking shortcut)
    // collapses every real shift into a rounding error" — this is that shortcut.
    //
    // Mean rather than autosens's max: an ISF error acts across the whole day,
    // so the average rate is the better stand-in for typical insulin activity,
    // whereas autosens is reading a single recent stretch against the strongest
    // rate the schedule reaches.
    const meanScheduledRate = Math.max(0.05, scheduledDailyU / 24);
    const basalOffsetUPerHr = (meanCleanDeviation * (60 / STEP_MINUTES)) / currentIsf;
    const shift = basalOffsetUPerHr / meanScheduledRate;
    // Positive shift = insulin under-performing = smaller true ISF.
    impliedIsf = +Math.max(1, currentIsf / (1 + shift)).toFixed(1);
    dampedIsf = +damp(currentIsf, impliedIsf).toFixed(1);
  }

  const isfNote =
    isfConfidence === 'unusable'
      ? 'Not enough food-free readings to separate sensitivity from everything else.'
      : isfConfidence === 'limited'
        ? 'Sensitivity is readable but should be treated with caution: unlogged meals inflate it, and this window has some.'
        : 'Read from food-free stretches across the window. One figure for the whole day — this method does not tune sensitivity by time of day.';

  // ── carb ratio ────────────────────────────────────────────────────────────
  //
  // The only place carb ratio can come from. Observed carb sensitivity is the
  // rise the food actually produced per gram; the ratio follows from ISF ÷ CSF.
  const seededCsf = seedCsf(currentIsf, currentCr);
  const gramsInWindow = carbs.reduce((a, c) => a + c.grams, 0);
  const totalCarbRise = carbSteps.reduce((a, s) => a + Math.max(0, s.deviation), 0);

  let crConfidence: Confidence = 'good';
  if (
    carbs.length < MIN_MEALS ||
    carbSteps.length < MIN_CARB_STEPS ||
    gramsInWindow <= 0 ||
    currentIsf <= 0 ||
    currentCr <= 0
  ) {
    crConfidence = 'unusable';
  } else if (
    iobUntrustworthy ||
    carbQuality.coveragePct < CARB_DAY_COVERAGE_FLOOR * 100 ||
    carbQuality.uamSharePct >= 15
  ) {
    crConfidence = 'limited';
  }

  let observedCsf: number | null = null;
  let impliedCr: number | null = null;
  let dampedCr: number | null = null;
  if (crConfidence !== 'unusable') {
    observedCsf = +(totalCarbRise / gramsInWindow).toFixed(2);
    if (observedCsf > 0) {
      impliedCr = +Math.max(1, currentIsf / observedCsf).toFixed(1);
      dampedCr = +damp(currentCr, impliedCr).toFixed(1);
    } else {
      crConfidence = 'unusable';
    }
  }

  const crNote =
    crConfidence === 'unusable'
      ? carbs.length < MIN_MEALS
        ? `${carbs.length} of ${MIN_MEALS} logged meals needed. Carb ratio is the first thing to become unreadable when meals go unlogged, and the first thing that should be ignored when they do.`
        : 'Not enough absorbing readings to tell what the food actually did.'
      : crConfidence === 'limited'
        ? 'Readable, but meals are being missed in this window — an unlogged meal makes the logged ones look like they raised glucose more than they did.'
        : `Read from ${carbs.length} logged meals. One figure for the whole day, as with sensitivity.`;

  // ── suggestions ───────────────────────────────────────────────────────────
  const suggestions: string[] = [];

  if (basalConfidence !== 'unusable') {
    const drifters = hours
      .filter((h) => h.confidence !== 'unusable' && Math.abs(h.deltaU) >= 0.05)
      .sort((a, b) => Math.abs(b.deltaU) - Math.abs(a.deltaU))
      .slice(0, 3);
    for (const h of drifters) {
      const dir = h.deltaU > 0 ? 'above' : 'below';
      suggestions.push(
        `Around ${String(h.hour).padStart(2, '0')}:00, food-free readings sit ${dir} what the schedule accounts for — the history points at roughly ${h.dampedRate.toFixed(2)} U/hr against the ${h.scheduledRate.toFixed(2)} U/hr on file. Worth reviewing this hour with your care team.`,
      );
    }
    const dailyDelta = impliedDailyU - scheduledDailyU;
    if (Math.abs(dailyDelta) / Math.max(scheduledDailyU, 0.1) >= 0.1) {
      suggestions.push(
        `Across the day the history points ${dailyDelta > 0 ? 'higher' : 'lower'} than the schedule totals — ${impliedDailyU.toFixed(1)} against ${scheduledDailyU.toFixed(1)} U/day. A whole-day gap usually means the schedule and the need have drifted apart rather than any one hour being wrong.`,
      );
    }
  }

  if (isfConfidence === 'good' && impliedIsf != null && currentIsf > 0) {
    const pct = Math.round(((impliedIsf - currentIsf) / currentIsf) * 100);
    if (Math.abs(pct) >= 10) {
      suggestions.push(
        `Sensitivity reads about ${Math.abs(pct)}% ${pct > 0 ? 'stronger' : 'weaker'} than the ${currentIsf} mg/dL per unit on file. Sensitivity moves with sites, sleep and season, so this is worth watching across a few runs before it means much.`,
      );
    }
  }

  if (crConfidence === 'good' && impliedCr != null && currentCr > 0) {
    const pct = Math.round(((impliedCr - currentCr) / currentCr) * 100);
    if (Math.abs(pct) >= 10) {
      suggestions.push(
        `Across ${carbs.length} logged meals, the rise per gram points at a ${pct > 0 ? 'weaker' : 'stronger'} carb ratio than the ${currentCr} g per unit on file. Worth raising with your care team alongside how the meals were counted.`,
      );
    }
  }

  return {
    windowDays,
    daysWithData,
    carbQuality,
    iobAgreement,
    basal: {
      hours,
      scheduledDailyU,
      impliedDailyU,
      confidence: basalConfidence,
      note: basalNote,
    },
    isf: {
      current: currentIsf,
      implied: impliedIsf,
      damped: dampedIsf,
      confidence: isfConfidence,
      note: isfNote,
    },
    carbRatio: {
      current: currentCr,
      implied: impliedCr,
      damped: dampedCr,
      observedCsf,
      seededCsf: +seededCsf.toFixed(2),
      mealCount: carbs.length,
      confidence: crConfidence,
      note: crNote,
    },
    suggestions,
  };
}
