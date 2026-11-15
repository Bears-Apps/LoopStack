import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { AutotuneResult, Confidence } from './autotune';
import type { AbsorptionInsights } from './absorptionProfile';
import { formatMinutes } from './absorptionProfile';
import { modelKindGlyph } from './carbAbsorption';

// One review row for every setting Loop's UI exposes.
//
// The deep engines each study one lever — Autotune the schedules, the
// absorption hub the carb entries. This module is the roster: it guarantees
// that EVERY setting has a home with three things attached — the value on
// file, what the backlog shows, and a confidence grade stating what that
// evidence can actually support. A setting with no evidence yet still gets its
// row; it says "not enough data" rather than disappearing, because a missing
// row reads as "nothing to see here" when the truth is "nothing measured yet".
//
// Loop's therapy screen, top to bottom: Glucose Safety Limit, Correction
// Range, Pre-Meal Range, Basal Rates, Delivery Limits (Max Basal, Max Bolus),
// Insulin Sensitivities, Carb Ratios, Insulin Model/Duration — plus the
// absorption presets chosen at carb entry. Ten levers, ten rows.
//
// Framing rule, as everywhere: readings and review points, never instructions.
// The Fix Log remains the only path toward an actual change, and that change
// happens in Loop with the care team.

export type SettingId =
  | 'safetyLimit'
  | 'correctionRange'
  | 'preMealRange'
  | 'basalRates'
  | 'maxBasal'
  | 'maxBolus'
  | 'insulinSensitivity'
  | 'carbRatio'
  | 'insulinDuration'
  | 'absorptionPresets';

export type SettingReview = {
  id: SettingId;
  /** The name as Loop's UI shows it. */
  label: string;
  /** Value(s) on file, formatted. */
  current: string;
  /** What the backlog points at, formatted. Null when nothing can be read. */
  reading: string | null;
  confidence: Confidence;
  /** One line naming the evidence behind the reading. */
  evidence: string;
  note: string;
  /** Where the deep dive lives, when one exists. */
  deepDive: 'tuning' | 'absorption' | 'basal' | null;
};

export type SettingsReview = {
  windowDays: number;
  items: SettingReview[];
};

const ms = (iso: string) => new Date(iso).getTime();

/** Median of a plain number list. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return Math.round((sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2);
}

function fmtRange(entries: { low: number; high: number }[]): string {
  if (entries.length === 0) return '—';
  const first = entries[0];
  const extra = entries.length > 1 ? ` (+${entries.length - 1} more)` : '';
  return `${first.low}–${first.high} mg/dL${extra}`;
}

export function computeSettingsReview(input: {
  therapy: LoopTherapy;
  autotune: AutotuneResult;
  absorption: AbsorptionInsights;
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  /** Should include temp-basal records where the source has them — that is
   *  what the Max Basal row reads. */
  insulin: InsulinEvent[];
  windowDays: number;
  now: Date;
}): SettingsReview {
  const { therapy, autotune, absorption, windowDays, now } = input;
  const startMs = now.getTime() - windowDays * 24 * 3600_000;
  const glucose = input.glucose
    .filter((g) => ms(g.iso) >= startMs && Number.isFinite(g.mgdl))
    .sort((a, b) => ms(a.iso) - ms(b.iso));
  const carbs = input.carbs.filter((c) => ms(c.iso) >= startMs);
  const insulin = input.insulin.filter((e) => ms(e.iso) >= startMs);

  const items: SettingReview[] = [
    reviewSafetyLimit(therapy, glucose, windowDays),
    reviewCorrectionRange(therapy, glucose),
    reviewPreMealRange(therapy, glucose, carbs),
    reviewBasal(therapy, autotune),
    reviewMaxBasal(therapy, insulin),
    reviewMaxBolus(therapy, insulin),
    reviewIsf(autotune),
    reviewCarbRatio(autotune),
    reviewInsulinDuration(therapy, autotune),
    reviewAbsorptionPresets(absorption),
  ];

  return { windowDays, items };
}

// ── glucose safety limit ────────────────────────────────────────────────────

function reviewSafetyLimit(
  therapy: LoopTherapy,
  glucose: GlucoseReading[],
  windowDays: number,
): SettingReview {
  const limit = therapy.glucoseSafetyLimitMgdl;
  const base = {
    id: 'safetyLimit' as const,
    label: 'Glucose safety limit',
    current: `${limit} mg/dL`,
    deepDive: null,
  };

  if (glucose.length < 288 * 3) {
    return {
      ...base,
      reading: null,
      confidence: 'unusable',
      evidence: `${glucose.length} readings`,
      note: 'Needs a few days of glucose history before time under the limit can be measured.',
    };
  }

  const below = glucose.filter((g) => g.mgdl < limit);
  const sharePct = +((below.length / glucose.length) * 100).toFixed(1);

  // Distinct episodes: runs of below-limit readings separated by ≥30 min.
  let episodes = 0;
  let lastBelowMs = -Infinity;
  for (const g of below) {
    const t = ms(g.iso);
    if (t - lastBelowMs > 30 * 60_000) episodes += 1;
    lastBelowMs = t;
  }
  const minutesBelow = below.length * 5;

  return {
    ...base,
    reading: `${sharePct}% of time under it`,
    confidence: 'good',
    evidence: `${glucose.length.toLocaleString()} readings over ${windowDays}d`,
    note:
      episodes === 0
        ? `Glucose never crossed under the ${limit} mg/dL limit in this window — Loop's suspend floor was never called on.`
        : `Glucose spent ${formatMinutes(minutesBelow)} under the ${limit} mg/dL limit across ${episodes} stretch${episodes === 1 ? '' : 'es'}. Each of those is time Loop was suspending delivery — a pattern worth reviewing with your care team if it repeats at the same hours.`,
  };
}

// ── correction range ────────────────────────────────────────────────────────

function reviewCorrectionRange(
  therapy: LoopTherapy,
  glucose: GlucoseReading[],
): SettingReview {
  const base = {
    id: 'correctionRange' as const,
    label: 'Correction range',
    current: fmtRange(therapy.correctionRange),
    deepDive: null,
  };

  // Where glucose actually settles when nothing is happening: overnight
  // (00:00–06:00), the longest reliably-fasting stretch. Per-night medians
  // first, so one strange night is one vote rather than six hours of votes.
  const byNight = new Map<string, number[]>();
  for (const g of glucose) {
    const d = new Date(ms(g.iso));
    if (d.getHours() >= 6) continue;
    const key = d.toDateString();
    if (!byNight.has(key)) byNight.set(key, []);
    byNight.get(key)!.push(g.mgdl);
  }
  const nightMedians = [...byNight.values()]
    .filter((xs) => xs.length >= 24) // at least 2h of readings in the night
    .map((xs) => median(xs)!)
    .filter((v) => v != null);

  if (nightMedians.length < 3) {
    return {
      ...base,
      reading: null,
      confidence: 'unusable',
      evidence: `${nightMedians.length} nights readable`,
      note: 'Needs a few nights of glucose history — overnight is where the settle point can be read without meals in the way.',
    };
  }

  const settle = median(nightMedians)!;
  const seg = therapy.correctionRange[0] ?? { low: 100, high: 115 };
  const mid = Math.round((seg.low + seg.high) / 2);
  const delta = settle - mid;
  const confidence: Confidence = nightMedians.length >= 7 ? 'good' : 'limited';

  return {
    ...base,
    reading: `settles near ${settle} mg/dL overnight`,
    confidence,
    evidence: `${nightMedians.length} nights`,
    note:
      Math.abs(delta) <= 10
        ? `Overnight glucose settles around ${settle} mg/dL — right where the range aims. The two agree.`
        : `Overnight glucose settles around ${settle} mg/dL, ${Math.abs(delta)} points ${delta > 0 ? 'above' : 'below'} the middle of the range Loop aims for. A persistent gap here usually traces to basal before it traces to the range itself — worth reading alongside the basal review.`,
  };
}

// ── pre-meal range ──────────────────────────────────────────────────────────

function reviewPreMealRange(
  therapy: LoopTherapy,
  glucose: GlucoseReading[],
  carbs: CarbEntry[],
): SettingReview {
  const base = {
    id: 'preMealRange' as const,
    label: 'Pre-meal range',
    current: `${therapy.preMealRange.low}–${therapy.preMealRange.high} mg/dL`,
    deepDive: null,
  };

  // Glucose at the moment each meal began: the nearest reading in the
  // 15 minutes before the entry.
  const starts: number[] = [];
  for (const c of carbs) {
    const t = ms(c.iso);
    let best: { gap: number; mgdl: number } | null = null;
    for (const g of glucose) {
      const gap = t - ms(g.iso);
      if (gap < 0 || gap > 15 * 60_000) continue;
      if (!best || gap < best.gap) best = { gap, mgdl: g.mgdl };
    }
    if (best) starts.push(best.mgdl);
  }

  if (starts.length < 5) {
    return {
      ...base,
      reading: null,
      confidence: 'unusable',
      evidence: `${starts.length} meals with a reading at the start`,
      note: 'Needs more meals with glucose recorded at the first bite.',
    };
  }

  const startMedian = median(starts)!;
  const inBand = starts.filter(
    (v) => v >= therapy.preMealRange.low && v <= therapy.preMealRange.high,
  ).length;
  const inBandPct = Math.round((inBand / starts.length) * 100);
  const confidence: Confidence = starts.length >= 15 ? 'good' : 'limited';

  return {
    ...base,
    reading: `meals began near ${startMedian} mg/dL`,
    confidence,
    evidence: `${starts.length} meals`,
    note: `Meals began at a median ${startMedian} mg/dL; ${inBandPct}% started inside the pre-meal band. The pre-meal target only does its work when the override is switched on ahead of eating — a low start percentage usually means it is not being reached for, not that the numbers are wrong.`,
  };
}

// ── basal / ISF / carb ratio, from Autotune ────────────────────────────────

function reviewBasal(therapy: LoopTherapy, t: AutotuneResult): SettingReview {
  const segs = therapy.basalSchedule.length;
  return {
    id: 'basalRates',
    label: 'Basal rates',
    current: `${t.basal.scheduledDailyU.toFixed(1)} U/day over ${segs} segment${segs === 1 ? '' : 's'}`,
    reading:
      t.basal.confidence === 'unusable'
        ? null
        : `history points at ${t.basal.impliedDailyU.toFixed(1)} U/day`,
    confidence: t.basal.confidence,
    evidence: `${t.daysWithData}d of food-free stretches, damped per pass`,
    note: t.basal.note,
    deepDive: 'tuning',
  };
}

function reviewIsf(t: AutotuneResult): SettingReview {
  return {
    id: 'insulinSensitivity',
    label: 'Insulin sensitivities',
    current: `~${t.isf.current} mg/dL per U`,
    reading:
      t.isf.confidence === 'unusable' || t.isf.damped == null
        ? null
        : `history points at ~${t.isf.damped}`,
    confidence: t.isf.confidence,
    evidence: 'food-free deviations across the window',
    note: t.isf.note,
    deepDive: 'tuning',
  };
}

function reviewCarbRatio(t: AutotuneResult): SettingReview {
  return {
    id: 'carbRatio',
    label: 'Carb ratios',
    current: `~${t.carbRatio.current} g per U`,
    reading:
      t.carbRatio.confidence === 'unusable' || t.carbRatio.damped == null
        ? null
        : `history points at ~${t.carbRatio.damped}`,
    confidence: t.carbRatio.confidence,
    evidence: `${t.carbRatio.mealCount} logged meals`,
    note: t.carbRatio.note,
    deepDive: 'tuning',
  };
}

// ── delivery limits ─────────────────────────────────────────────────────────

function reviewMaxBasal(therapy: LoopTherapy, insulin: InsulinEvent[]): SettingReview {
  const cap = therapy.maxBasalRate;
  const base = {
    id: 'maxBasal' as const,
    label: 'Max basal rate',
    current: `${cap} U/hr`,
    deepDive: null,
  };

  const temps = insulin.filter(
    (e) => e.kind === 'basal_temp' && e.rateUPerHr != null,
  );
  if (temps.length < 20) {
    return {
      ...base,
      reading: null,
      confidence: 'unusable',
      evidence: `${temps.length} temp-basal records`,
      note: 'Needs temp-basal records to read — Nightscout carries them; Apple Health does not.',
    };
  }

  const maxRate = Math.max(...temps.map((e) => e.rateUPerHr!));
  const pinned = temps.filter((e) => e.rateUPerHr! >= cap * 0.95).length;
  const pinnedPct = Math.round((pinned / temps.length) * 100);

  return {
    ...base,
    reading: `Loop's highest temp: ${maxRate.toFixed(1)} U/hr`,
    confidence: 'good',
    evidence: `${temps.length} temp basals`,
    note:
      pinnedPct >= 5
        ? `${pinnedPct}% of temp basals ran at or against the ${cap} U/hr cap — Loop keeps reaching the ceiling of what it is allowed to deliver. A cap that binds this often is shaping every high, and is worth reviewing with your care team.`
        : `Loop's strongest temp basal was ${maxRate.toFixed(1)} U/hr against the ${cap} U/hr cap, and it pressed the ceiling in under 5% of temps — the cap is not constraining what Loop wants to do.`,
  };
}

function reviewMaxBolus(therapy: LoopTherapy, insulin: InsulinEvent[]): SettingReview {
  const cap = therapy.maxBolus;
  const base = {
    id: 'maxBolus' as const,
    label: 'Max bolus',
    current: `${cap} U`,
    deepDive: null,
  };

  const boluses = insulin.filter((e) => e.kind === 'bolus' && e.units > 0);
  if (boluses.length < 10) {
    return {
      ...base,
      reading: null,
      confidence: 'unusable',
      evidence: `${boluses.length} boluses`,
      note: 'Needs more bolus history to read.',
    };
  }

  const maxU = Math.max(...boluses.map((e) => e.units));
  const nearCap = boluses.filter((e) => e.units >= cap * 0.95).length;
  const nearCapPct = Math.round((nearCap / boluses.length) * 100);

  return {
    ...base,
    reading: `largest bolus: ${maxU.toFixed(1)} U`,
    confidence: 'good',
    evidence: `${boluses.length} boluses`,
    note:
      nearCapPct >= 5
        ? `${nearCapPct}% of boluses landed at or against the ${cap} U cap. When entries keep hitting the ceiling, the meal maths is being truncated — worth reviewing with your care team.`
        : `The largest bolus in the window was ${maxU.toFixed(1)} U against the ${cap} U cap — comfortable headroom, and the cap still catches a mistyped entry.`,
  };
}

// ── insulin duration ────────────────────────────────────────────────────────

function reviewInsulinDuration(
  therapy: LoopTherapy,
  t: AutotuneResult,
): SettingReview {
  const base = {
    id: 'insulinDuration' as const,
    label: 'Insulin duration',
    current: `${therapy.insulinDurationHours} h`,
    deepDive: 'tuning' as const,
  };

  const agr = t.iobAgreement;
  if (agr == null) {
    return {
      ...base,
      reading: null,
      confidence: 'unusable',
      evidence: 'no Loop IOB to compare against',
      note: "Read by checking this app's insulin reconstruction against Loop's own IOB, which needs Nightscout devicestatus records.",
    };
  }

  if (!agr.trustworthy && agr.biasU < 0) {
    return {
      ...base,
      reading: `reconstruction runs ${Math.abs(agr.biasU).toFixed(1)} U low`,
      confidence: 'unusable',
      evidence: `${agr.sampleCount} checks against Loop`,
      note: 'The insulin record reaching this app is incomplete (usually temp basals not uploading), so the duration on file cannot be judged from it.',
    };
  }

  const runsLong = agr.biasU > 0.3;
  return {
    ...base,
    reading: runsLong
      ? `model outlasts Loop's IOB by ~${agr.biasU.toFixed(1)} U`
      : `tracks Loop's IOB within ${agr.meanAbsDiffU.toFixed(2)} U`,
    confidence: runsLong ? 'limited' : 'good',
    evidence: `${agr.sampleCount} checks against Loop's own IOB`,
    note: runsLong
      ? `Modelling insulin with the ${therapy.insulinDurationHours} h duration on file keeps it "working" after Loop has already written it off. That pattern is what a duration set longer than the insulin's real tail looks like — worth reviewing with your care team.`
      : `Insulin modelled with the ${therapy.insulinDurationHours} h duration tracks Loop's own IOB closely — the duration on file fits how doses actually play out.`,
  };
}

// ── absorption presets ──────────────────────────────────────────────────────

function reviewAbsorptionPresets(a: AbsorptionInsights): SettingReview {
  const base = {
    id: 'absorptionPresets' as const,
    label: 'Carb absorption presets',
    deepDive: 'absorption' as const,
  };

  // Marked entries (🥜/🍲) are individual cases with their own curve; name
  // them by marker so "12h" and "12h 🥜" never read as the same preset.
  const presetName = (p: AbsorptionInsights['presets'][number]) =>
    p.modelKind === 'piecewise'
      ? `${p.presetHours}h`
      : `${p.presetHours}h ${modelKindGlyph(p.modelKind)}`;

  const stated = a.presets.filter((p) => p.verdict !== 'building');
  const current =
    a.presets.length > 0
      ? a.presets.map(presetName).join(' / ')
      : '—';

  if (stated.length === 0) {
    return {
      ...base,
      current,
      reading: null,
      confidence: 'unusable',
      evidence: `${a.cleanMeals} meals read cleanly`,
      note: 'Each preset needs enough cleanly-isolated meals before its shape can be stated — see the Absorption tab for progress.',
    };
  }

  const wording: Record<string, string> = {
    matches: 'fits',
    finishes_early: 'finishes early',
    outlasts: 'outlasts',
  };
  const summary = stated
    .map((p) => `${presetName(p)} ${wording[p.verdict]}`)
    .join(' · ');
  const anyOff = stated.some((p) => p.verdict !== 'matches');

  return {
    ...base,
    current,
    reading: summary,
    confidence: stated.length === a.presets.length ? 'good' : 'limited',
    evidence: `${a.cleanMeals} meals read across ${a.presets.length} presets`,
    note: anyOff
      ? 'At least one preset models a different shape than its plates deliver — the Absorption tab shows which foods drive it and which preset they actually track.'
      : 'Every preset with enough meals behind it matches how its plates absorb.',
  };
}
