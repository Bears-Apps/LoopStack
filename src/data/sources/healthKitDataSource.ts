import { Capacitor } from '@capacitor/core';
import {
  Health,
  type HealthSample,
  type Workout as CapgoWorkout,
  type WorkoutType as CapgoWorkoutType,
} from '@capgo/capacitor-health';
import type { CurrentGlucose } from '@/lib/glucoseStatus';
import {
  computeAllMetrics,
  hasMetricsData,
  type MetricsInputs,
} from '@/lib/metrics/computeMetrics';
import { computeTimeTrends, type TimeTrends } from '@/lib/metrics/timeTrends';
import { bucketInsulinByHour, type InsulinLedger } from '@/lib/metabolism/insulinLedger';
import { dailyBasalTotal } from '@/data/loopTherapy';
import { activeLoopTherapy } from '@/data/loopTherapySchedules';
import { loadTargetRange } from '@/data/loopTherapyStore';
import {
  computeActivitySummary,
  dedupeWorkouts,
  type ActivitySummary,
  type HourlySteps,
} from '@/lib/activity/activityEvents';
import type { GlucoseMetrics, MetricsRange } from '@/data/types';
import type { LoopModeSummary } from '@/lib/loop/loopMode';
import { computeBasalInsights, type BasalInsights } from '@/lib/metabolism/basalInsights';
import { computeAutosens, type Autosens } from '@/lib/metabolism/autosens';
import { computeAutotune, type AutotuneResult } from '@/lib/metabolism/autotune';
import { computeAbsorptionInsights, type AbsorptionInsights } from '@/lib/metabolism/absorptionProfile';
import { computeSettingsReview, type SettingsReview } from '@/lib/metabolism/settingsReview';
import { computeDayHourGrid, PATTERN_SAMPLE_WEEKS, type DayHourGrid } from '@/lib/metrics/dayHourGrid';
import { computeWeekdayHourly, type WeekdayHourly } from '@/lib/metrics/weekdayHourly';
import { computeWeekdayExercise, type WeekdayExercise } from '@/lib/metrics/weekdayExercise';
import { computeRiskWindows, type RiskWindow } from '@/lib/alerts/riskWindows';
import { computeClinicianMetrics } from '@/lib/metrics/clinicianMetrics';
import { computeCorrectionOutcomes } from '@/lib/metrics/correctionOutcomes';
import type { GlucoseWindow, HypoReport } from '@/lib/metrics/hypoEvents';
import type { AgpProfile } from '@/lib/metrics/agp';
import type { MealPanels } from '@/lib/metrics/mealPanels';
import type { CorrectionOutcomes } from '@/lib/metrics/correctionOutcomes';
import type { TempBasalUse } from '@/lib/metrics/tempBasalUse';
import { dedupeCarbEntries, dedupeInsulinEvents } from '@/lib/metabolism/dedupe';
import {
  HealthDiabetes,
  type CarbSample,
  type InsulinDayBucket,
  type InsulinSample,
} from './healthDiabetesPlugin';
import {
  HISTORY_FORMAT,
  incrementalFrom,
  loadHistory,
  mergeSpan,
  needsFullFetch,
  saveHistory,
} from './historyCache';
import {
  emptyResult,
  freshResult,
  type CarbEntry,
  type DataSnapshot,
  type DataSource,
  type DataSubscriber,
  type GlucoseReading,
  type HeartRateSample,
  type InsulinEvent,
  type WorkoutEntry,
  type WorkoutType,
} from './types';

// HealthKit-backed data source.
//
// What's live:
//   • currentGlucose — derived from the most recent bloodGlucose samples.
//     Trend rates (per-5min, per-20min) are linear-fit from samples in the
//     last 30 minutes.
//   • recentGlucose — last 8 hours of bloodGlucose samples.
//
// What's NOT yet live (still falls back to mock):
//   • latestMeal trace — needs insulinDelivery + dietaryCarbohydrates, which
//     @capgo/capacitor-health does not currently expose. Plan: PR upstream
//     or add a small custom plugin extension. Tracked in screen comments.
//   • recentInsulin / recentCarbs — same gap.
//
// Behavior:
//   • Off-iOS (web preview), refresh() returns immediately with an
//     "unavailable" error so the UI shows a clear "this source needs iOS."
//   • On first refresh, requestAuthorization() prompts the user. iOS does
//     NOT report whether read permission was granted (Apple policy), so we
//     proceed and fail soft if reads return empty.

const STALE_THRESHOLD_MIN = 15;
const TREND_WINDOW_MIN = 30;
const RECENT_GLUCOSE_HOURS = 8;
// Activity windows are queried over a wider window than glucose so the
// classifier can see "ended 6h ago" workouts and overnight HR context.
// 72h (up from 24h) also feeds the activity-event stream — enough events for
// an early glucose-response signal without dragging weeks of HR samples
// across the bridge every refresh.
const ACTIVITY_WINDOW_HOURS = 72;
const RESTING_HR_LOOKBACK_DAYS = 7;
// Long-window reads powering the metrics dashboard + meal memories. 180 days of
// 5-min CGM ≈ 52k samples — heavy, and the reason this is a deliberate choice
// rather than a default: the range selector offers 180d, and a selector option
// backed by a shorter fetch is a label that lies. Metrics report daysCovered
// alongside daysInWindow so a window that outruns the available history says
// so on screen instead of silently averaging less data.
// Deltas for windows whose prior period predates the fetch resolve to neutral.
const METRICS_WINDOW_DAYS = 180;
const MEAL_WINDOW_DAYS = 30;
const AUTOTUNE_WINDOW_DAYS = 21;
const AUTOSENS_WINDOW_HOURS = 24;

/**
 * Sum hourly buckets into per-day totals.
 *
 * Exercise is queried hourly so the weekday report can say WHEN the movement
 * happened; the metrics dashboard still wants a day's total, and deriving it
 * here keeps one query serving both rather than paying for two.
 *
 * Buckets are keyed by local calendar day, matching every other per-day figure
 * in the app.
 */
function rollUpToDays(
  hourly: { iso: string; minutes: number }[],
): { dayIso: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const h of hourly) {
    const t = new Date(h.iso);
    if (Number.isNaN(t.getTime())) continue;
    const key = new Date(t.getFullYear(), t.getMonth(), t.getDate()).toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + h.minutes);
  }
  return [...byDay.entries()]
    .map(([dayIso, value]) => ({ dayIso, value }))
    .sort((a, b) => a.dayIso.localeCompare(b.dayIso));
}

function isStale(iso: string): boolean {
  const ageMin = (Date.now() - new Date(iso).getTime()) / 60_000;
  return ageMin > STALE_THRESHOLD_MIN;
}

function emptySnapshot(): DataSnapshot {
  return {
    currentGlucose: emptyResult<CurrentGlucose>(),
    recentGlucose: emptyResult<GlucoseReading[]>(),
    recentInsulin: emptyResult<InsulinEvent[]>(),
    currentLoopIob: emptyResult<number | null>(),
    recentCarbs: emptyResult<CarbEntry[]>(),
    recentWorkouts: emptyResult<WorkoutEntry[]>(),
    recentHeartRate: emptyResult<HeartRateSample[]>(),
    restingHeartRate: emptyResult<number>(),
    metrics: emptyResult<Record<MetricsRange, GlucoseMetrics>>(),
    timeTrends: emptyResult<TimeTrends>(),
    insulinLedger: emptyResult<InsulinLedger>(),
    activitySummary: emptyResult<ActivitySummary>(),
    // HealthKit has no loop-status signal — closed-loop tracking needs the
    // Nightscout source. Stays empty here so the UI says so honestly.
    loopMode: emptyResult<LoopModeSummary>(),
    basalInsights: emptyResult<BasalInsights>(),
    autosens: emptyResult<Autosens>(),
    autotune: emptyResult<AutotuneResult>(),
    absorptionInsights: emptyResult<AbsorptionInsights>(),
    settingsReview: emptyResult<SettingsReview>(),
    riskWindows: emptyResult<RiskWindow[]>(),
    dayHourGrid: emptyResult<DayHourGrid>(),
    weekdayHourly: emptyResult<WeekdayHourly>(),
    weekdayExercise: emptyResult<WeekdayExercise>(),
    hypoEvents: emptyResult<Record<GlucoseWindow, HypoReport>>(),
    agp: emptyResult<Record<GlucoseWindow, AgpProfile>>(),
    mealPanels: emptyResult<MealPanels>(),
    correctionOutcomes: emptyResult<CorrectionOutcomes>(),
    tempBasalUse: emptyResult<TempBasalUse>(),
  };
}

function loadingSnapshot(prev: DataSnapshot): DataSnapshot {
  return {
    ...prev,
    currentGlucose: { ...prev.currentGlucose, loading: true, error: null },
    recentGlucose: { ...prev.recentGlucose, loading: true, error: null },
    recentWorkouts: { ...prev.recentWorkouts, loading: true, error: null },
    recentHeartRate: { ...prev.recentHeartRate, loading: true, error: null },
    restingHeartRate: { ...prev.restingHeartRate, loading: true, error: null },
  };
}

function errorSnapshot(prev: DataSnapshot, err: Error): DataSnapshot {
  // Stamp EVERY field, not just the five raw reads. Anything left at
  // `emptyResult()` renders as "no data yet" — which is how a hard failure
  // used to masquerade as an empty account and left the dashboard silently
  // blank with nothing to explain it.
  const out = { ...prev } as Record<string, { loading: boolean; error: Error | null }>;
  for (const key of Object.keys(out)) {
    out[key] = { ...out[key], loading: false, error: err };
  }
  return out as unknown as DataSnapshot;
}

/** Map @capgo's wide HealthKit workout enum down to the narrow union our
 *  classifier branches on. Anything we don't recognize bucks to 'other'. */
function mapWorkoutType(t: CapgoWorkoutType): WorkoutType {
  switch (t) {
    case 'running':
    case 'runningTreadmill':
      return 'running';
    case 'walking':
    case 'hiking':
      return 'walking';
    case 'cycling':
    case 'bikingStationary':
    case 'handCycling':
      return 'cycling';
    case 'swimming':
    case 'swimmingPool':
    case 'swimmingOpenWater':
      return 'swimming';
    case 'strengthTraining':
    case 'traditionalStrengthTraining':
    case 'functionalStrengthTraining':
    case 'weightlifting':
    case 'crossTraining':
      return 'strength';
    case 'highIntensityIntervalTraining':
    case 'jumpRope':
    case 'kickboxing':
    case 'boxing':
      return 'hiit';
    case 'elliptical':
    case 'rowing':
    case 'rowingMachine':
    case 'stairs':
    case 'stairClimbing':
    case 'stairClimbingMachine':
    case 'stepTraining':
    case 'mixedCardio':
    case 'cardioDance':
    case 'dance':
    case 'dancing':
      return 'cardio';
    default:
      return 'other';
  }
}

/** Linear regression slope (mg/dL per minute) from a time series. */
function fitSlopePerMin(samples: HealthSample[]): number {
  if (samples.length < 2) return 0;
  const t0 = new Date(samples[0].startDate).getTime();
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const s of samples) {
    const x = (new Date(s.startDate).getTime() - t0) / 60_000;
    const y = s.value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const n = samples.length;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Sum carb entries into per-day buckets for the metrics aggregator. */
function bucketCarbsByDay(carbs: CarbEntry[]): { dayIso: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const c of carbs) {
    const day = new Date(c.iso);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + c.grams);
  }
  return [...byDay.entries()].map(([dayIso, value]) => ({ dayIso, value }));
}

function buildCurrentGlucose(samples: HealthSample[]): CurrentGlucose | null {
  if (samples.length === 0) return null;
  // Newest sample is whatever has the latest startDate.
  const sorted = [...samples].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );
  const newest = sorted[sorted.length - 1];

  // Rate fit: use samples within the trend window of the newest reading.
  const cutoff = new Date(newest.startDate).getTime() - TREND_WINDOW_MIN * 60_000;
  const window = sorted.filter((s) => new Date(s.startDate).getTime() >= cutoff);
  const slopePerMin = fitSlopePerMin(window);

  return {
    mgdl: Math.round(newest.value),
    ratePer5min: +(slopePerMin * 5).toFixed(2),
    ratePer20min: +(slopePerMin * 20).toFixed(2),
    lastUpdatedIso: newest.startDate,
  };
}

// ── raw records ────────────────────────────────────────────────────────────

type Agg = { startDate: string; value: number };

/**
 * Everything a refresh reads from Apple Health, as the plugins return it. This
 * is what the device cache holds: the snapshot is always rebuilt from it, so a
 * cached launch and a fresh read go through the same code.
 */
type HkRaw = {
  glucose8h: HealthSample[];
  insulin8h: InsulinSample[];
  carbs8h: CarbSample[];
  heartRate: HealthSample[];
  resting: HealthSample[];
  insulinToday: InsulinSample[];
  workouts: CapgoWorkout[];
  /** 180 days, oldest first. */
  longGlucose: GlucoseReading[];
  longCarbs: CarbSample[];
  longBoluses: InsulinSample[];
  insulinByDay: InsulinDayBucket[];
  stepsByDay: Agg[];
  exerciseHourly: Agg[];
  sleep: HealthSample[];
  hourlySteps: Agg[];
};

/** The reads that make up the top of the home screen; they go first. */
type FastPart = Pick<HkRaw, 'glucose8h' | 'insulin8h' | 'carbs8h' | 'heartRate' | 'resting' | 'insulinToday'>;

export type HealthKitOptions = {
  /**
   * Where the 180-day glucose history comes from. Absent: Apple Health,
   * through the device cache. The combined source passes Nightscout's, which
   * it reads anyway — the same CGM, so reading it twice bought nothing.
   * Resolving to null (Nightscout failed) falls back to Apple Health's own.
   */
  glucoseHistory?: () => Promise<GlucoseReading[] | null>;
  /**
   * Compute the glucose-only views (time trends, weekday grid, risk windows,
   * AGP, lows, meal panels). The combined source takes all of these from
   * Nightscout and turns them off here.
   */
  glucoseViews?: boolean;
  /**
   * Compute the views built on the insulin stream (basal, autosens, autotune,
   * absorption, settings review, corrections). The combined source turns them
   * off while Nightscout owns insulin.
   */
  insulinViews?: () => boolean;
};

const CACHE_KEY = 'healthkit';
const CACHE_SOURCE = 'healthkit';
/** Re-read on every refresh: CGM backfill after a dropout lands in here. */
const GLUCOSE_OVERLAP_MS = 6 * 3600_000;
const LONG_GLUCOSE_LIMIT = 60_000;

const toInsulinKind = (reason: string | undefined): InsulinEvent['kind'] =>
  // Loop tags boluses; basal-temp events come tagged 'basal'. Unknown is
  // rare — treat as bolus so it shows up rather than getting hidden.
  reason === 'basal' ? 'basal_temp' : 'bolus';

const toEvents = (samples: InsulinSample[]): InsulinEvent[] =>
  dedupeInsulinEvents(samples.map((s) => ({ iso: s.iso, units: +s.units.toFixed(3), kind: toInsulinKind(s.reason) })));

// Deduplicated: more than one writer of dietaryCarbohydrates (Loop plus a
// food logger, or Loop on two devices) puts the same meal in the store
// twice under different UUIDs, which inflates every carb figure downstream.
const toCarbs = (samples: CarbSample[]): CarbEntry[] =>
  dedupeCarbEntries(
    samples.map((s) => ({
      iso: s.iso,
      grams: +s.grams.toFixed(1),
      // Loop persists absorption time as metadata; default to 3h when
      // missing (matches Loop's own default).
      absorptionHours: s.absorptionHours ?? 3,
      label: s.label,
    })),
  );

/** The fast fields: what is happening now. */
function fastFields(raw: FastPart, now: Date): Pick<DataSnapshot, 'currentGlucose' | 'recentGlucose' | 'recentInsulin' | 'recentCarbs' | 'recentHeartRate' | 'restingHeartRate' | 'insulinLedger'> {
  const current = buildCurrentGlucose(raw.glucose8h);
  const readings: GlucoseReading[] = raw.glucose8h.map((s) => ({ iso: s.startDate, mgdl: Math.round(s.value) }));
  const insulinEvents = toEvents(raw.insulin8h);
  // Today's full insulin stream (temp basals + boluses) for the hourly ledger.
  const insulinTodayEvents = toEvents(raw.insulinToday);
  const carbEntries = toCarbs(raw.carbs8h);
  const heartRate: HeartRateSample[] = raw.heartRate.map((s) => ({ timestamp: s.startDate, bpm: Math.round(s.value), source: s.sourceName }));
  const restingSample = raw.resting[0];
  return {
    currentGlucose: current
      ? { data: current, loading: false, error: null, lastUpdatedIso: current.lastUpdatedIso, isStale: isStale(current.lastUpdatedIso) }
      : {
          data: null,
          loading: false,
          error: new Error('No glucose readings found in Apple Health for the last 8 hours.'),
          lastUpdatedIso: null,
          isStale: false,
        },
    recentGlucose: {
      data: readings,
      loading: false,
      error: null,
      lastUpdatedIso: readings.at(-1)?.iso ?? null,
      isStale: readings.length === 0 ? false : isStale(readings.at(-1)!.iso),
    },
    recentInsulin: { data: insulinEvents, loading: false, error: null, lastUpdatedIso: insulinEvents.at(-1)?.iso ?? null, isStale: false },
    recentCarbs: { data: carbEntries, loading: false, error: null, lastUpdatedIso: carbEntries.at(-1)?.iso ?? null, isStale: false },
    recentHeartRate: { data: heartRate, loading: false, error: null, lastUpdatedIso: heartRate.at(-1)?.timestamp ?? null, isStale: false },
    restingHeartRate: restingSample
      ? { data: Math.round(restingSample.value), loading: false, error: null, lastUpdatedIso: restingSample.startDate, isStale: false }
      : emptyResult<number>(),
    insulinLedger: freshResult(
      {
        hourly: bucketInsulinByHour(insulinTodayEvents, now),
        // Whether Health ACTUALLY delivered basal samples, not an
        // assumption that it does. Pinned true, this made the derived
        // "Xtra insulin" and "Observed carb ratio" tiles render off a
        // basal figure of zero — a tautology presented as a measurement.
        hasBasal: insulinTodayEvents.some((e) => e.kind !== 'bolus'),
        scheduledBasalU: dailyBasalTotal(activeLoopTherapy()),
      },
      now.toISOString(),
      'computed',
    ),
  };
}

/** Every view this source publishes, from its raw records. */
function buildSnapshot(raw: HkRaw, now: Date, opts: { glucoseViews: boolean; insulinViews: boolean }): DataSnapshot {
  const nowIso = now.toISOString();
  const therapy = activeLoopTherapy();
  const target = loadTargetRange();
  const longGlucose = raw.longGlucose;
  const longCarbs = toCarbs(raw.longCarbs);
  const longBoluses: InsulinEvent[] = dedupeInsulinEvents(
    raw.longBoluses.map((s) => ({ iso: s.iso, units: +s.units.toFixed(3), kind: 'bolus' as const })),
  );
  // Hourly exercise minutes across the whole metrics window. Feeds the
  // weekday × hour report; rolled up to days for the dashboard below.
  const exerciseByHourSamples = raw.exerciseHourly.map((s) => ({ iso: s.startDate, minutes: s.value }));

  // Sleep: sum sample durations into per-day hours. Only true sleep stages
  // count -- 'inBed' overlaps the asleep stages on Apple Watch and would
  // double-count, and 'awake' is not sleep. Samples are attributed to the
  // day they START on, so a night that crosses midnight lands on the
  // evening date, matching how Health reports a night's sleep.
  const sleepByDay = (() => {
    const ASLEEP = new Set(['asleep', 'rem', 'deep', 'light']);
    const byDay = new Map<string, number>();
    for (const s of raw.sleep) {
      if (!s.sleepState || !ASLEEP.has(s.sleepState)) continue;
      const hours = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 3600_000;
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const day = new Date(s.startDate);
      day.setHours(0, 0, 0, 0);
      const key = day.toISOString();
      byDay.set(key, (byDay.get(key) ?? 0) + hours);
    }
    return [...byDay.entries()].map(([dayIso, value]) => ({ dayIso, value }));
  })();

  const workouts: WorkoutEntry[] = raw.workouts.map((w) => ({
    // Prefer platformId (HealthKit UUID) when available; fall back to
    // composite so React keys stay stable across refreshes.
    id: w.platformId ?? `${w.startDate}-${w.workoutType}`,
    type: mapWorkoutType(w.workoutType),
    startTime: w.startDate,
    endTime: w.endDate,
    // Plugin returns duration in seconds; classifier expects minutes.
    durationMinutes: Math.round(w.duration / 60),
    calories: w.totalEnergyBurned,
    distanceMeters: w.totalDistance,
    source: w.sourceName,
  }));

  const fast = fastFields(raw, now);

  const metricsInputs: MetricsInputs = {
    glucose: longGlucose,
    insulinByDay: raw.insulinByDay.map((d) => ({ dayIso: d.dayIso, basal: d.basal, bolus: d.bolus })),
    carbsByDay: bucketCarbsByDay(longCarbs),
    stepsByDay: raw.stepsByDay.map((s) => ({ dayIso: s.startDate, value: s.value })),
    // The query returns HOURLY buckets (for the weekday report), so the
    // per-day figure the dashboard shows is summed back out of them.
    exerciseByDay: rollUpToDays(exerciseByHourSamples),
    sleepByDay,
    targetRange: target,
    // HealthKit may omit basal. Supply the scheduled daily total so the
    // insulin split reflects background insulin instead of reading as 100% bolus.
    scheduledDailyBasal: dailyBasalTotal(therapy),
  };
  const metricsView = hasMetricsData(metricsInputs) ? computeAllMetrics(metricsInputs, now) : null;

  const hourlySteps: HourlySteps[] = raw.hourlySteps.map((s) => ({ hourIso: s.startDate, steps: Math.round(s.value) }));

  const out: DataSnapshot = {
    ...emptySnapshot(),
    ...fast,
    recentWorkouts: {
      // Deduplicated for display as well as for the summary: Apple Health
      // keeps one record per app that wrote the activity, so a run tracked
      // by both the Watch and a running app would otherwise be listed twice.
      data: dedupeWorkouts(workouts),
      loading: false,
      error: null,
      lastUpdatedIso: workouts.at(-1)?.endTime ?? null,
      isStale: false,
    },
    metrics: metricsView ? freshResult(metricsView, nowIso, 'computed') : emptyResult<Record<MetricsRange, GlucoseMetrics>>(),
    activitySummary: freshResult(
      computeActivitySummary({
        workouts,
        heartRate: fast.recentHeartRate.data ?? [],
        restingBpm: fast.restingHeartRate.data ?? null,
        hourlySteps,
        glucose: longGlucose,
        windowHours: ACTIVITY_WINDOW_HOURS,
      }),
      nowIso,
      'computed',
    ),
  };

  // Activity, so outside the glucose gate: the combined source turns this
  // source's glucose views off but still takes its exercise.
  const weekdayExercise = computeWeekdayExercise({ exerciseByHour: exerciseByHourSamples, workouts, now });
  if (weekdayExercise) out.weekdayExercise = freshResult(weekdayExercise, nowIso, 'computed');

  if (opts.glucoseViews) {
    const clinician = longGlucose.length
      ? computeClinicianMetrics({ glucose: longGlucose, carbs: longCarbs, insulin: longBoluses, therapy, target, now, treatmentWindowDays: MEAL_WINDOW_DAYS })
      : null;
    out.timeTrends = freshResult(computeTimeTrends(longGlucose, target), nowIso, 'computed');
    // The whole weekday × hour shape, not just the alerting subset. This is
    // the only source that can annotate it with exercise: workouts and
    // hourly exercise minutes are HealthKit-only.
    out.dayHourGrid = freshResult(
      computeDayHourGrid({ glucose: longGlucose, target, now, workouts, exerciseByHour: exerciseByHourSamples, carbs: longCarbs, weeks: PATTERN_SAMPLE_WEEKS }),
      nowIso,
      'computed',
    );
    // Apple Health's long insulin read is boluses only, so IOB here leaves
    // out temp basals; the screen says so.
    out.weekdayHourly = freshResult(
      computeWeekdayHourly({ glucose: longGlucose, insulin: longBoluses, carbs: longCarbs, therapy, target, now }),
      nowIso,
      'computed',
    );
    // Recurrence is counted in weeks, so this reads the long glucose window.
    out.riskWindows = freshResult(computeRiskWindows({ glucose: longGlucose, target, now }), nowIso, 'computed');
    if (clinician) {
      out.hypoEvents = freshResult(clinician.hypoEvents, nowIso, 'computed');
      out.agp = freshResult(clinician.agp, nowIso, 'computed');
      out.mealPanels = freshResult(clinician.mealPanels, nowIso, 'computed');
    }
  }

  if (opts.insulinViews) {
    // Apple Health carries boluses but not Loop's temp-basal decisions, so
    // deviations here are netted against the schedule alone. That reads a
    // low-temp stretch as a plain unexplained fall, which is why a
    // Nightscout-backed run of the same maths is the more trustworthy one.
    const engine = { glucose: longGlucose, carbs: longCarbs, insulin: longBoluses, therapy, now };
    const autotune = computeAutotune({ ...engine, windowDays: AUTOTUNE_WINDOW_DAYS });
    const absorption = computeAbsorptionInsights({ ...engine, windowDays: MEAL_WINDOW_DAYS });
    out.basalInsights = freshResult(
      computeBasalInsights({
        ...engine,
        windowDays: MEAL_WINDOW_DAYS,
        // Delivered basal per day, averaged over the days the aggregate
        // actually covers — HealthKit is the only source that measures it.
        deliveredDailyU: raw.insulinByDay.length ? raw.insulinByDay.reduce((a, d) => a + d.basal, 0) / raw.insulinByDay.length : null,
      }),
      nowIso,
      'computed',
    );
    out.autosens = freshResult(computeAutosens({ ...engine, windowHours: AUTOSENS_WINDOW_HOURS }), nowIso, 'computed');
    out.autotune = freshResult(autotune, nowIso, 'computed');
    out.absorptionInsights = freshResult(absorption, nowIso, 'computed');
    // Apple Health carries no temp basals and no Loop IOB, so the max-basal
    // and duration rows honestly report themselves unreadable here.
    out.settingsReview = freshResult(
      computeSettingsReview({ ...engine, autotune, absorption, windowDays: MEAL_WINDOW_DAYS }),
      nowIso,
      'computed',
    );
    if (longGlucose.length) {
      out.correctionOutcomes = freshResult(
        computeCorrectionOutcomes({ glucose: longGlucose, carbs: longCarbs, insulin: longBoluses, therapy, lowMgdl: target.lowMgdl, now, windowDays: MEAL_WINDOW_DAYS }),
        nowIso,
        'computed',
      );
    }
  }
  // tempBasalUse stays empty: Apple Health has no temp basals.
  return out;
}

export function createHealthKitDataSource(options: HealthKitOptions = {}): DataSource {
  let snapshot: DataSnapshot = emptySnapshot();
  const listeners = new Set<DataSubscriber>();
  const viewOpts = () => ({
    glucoseViews: options.glucoseViews ?? true,
    insulinViews: options.insulinViews?.() ?? true,
  });

  const emit = () => {
    for (const cb of listeners) cb();
  };

  const refresh = async (): Promise<void> => {
    if (Capacitor.getPlatform() !== 'ios') {
      snapshot = errorSnapshot(
        snapshot,
        new Error(
          'Apple Health is only available on iOS. Open LoopStack on your iPhone to use this source.',
        ),
      );
      emit();
      return;
    }

    snapshot = loadingSnapshot(snapshot);
    emit();

    try {
      const now = new Date();
      const nowMs = now.getTime();
      const metricsStartMs = nowMs - METRICS_WINDOW_DAYS * 24 * 3600_000;

      // ── 1. the dashboard from what is already on the device ──
      // Only while the screen has nothing yet, and only when this source
      // reads its own glucose (the combined source supplies it instead).
      const cache = options.glucoseHistory ? null : await loadHistory<HkRaw>(CACHE_KEY, CACHE_SOURCE);
      if (cache && snapshot.metrics.data == null) {
        snapshot = { ...buildSnapshot(cache.data, now, viewOpts()), currentGlucose: { ...snapshot.currentGlucose, loading: true } };
        emit();
      }

      const availability = await Health.isAvailable();
      if (!availability.available) {
        throw new Error(
          availability.reason ?? 'Apple Health is not available on this device.',
        );
      }

      // Authorization runs across two plugins:
      //   • @capgo/capacitor-health for bloodGlucose + workouts + heartRate +
      //     restingHeartRate
      //   • our in-app HealthDiabetes for insulinDelivery + dietaryCarbohydrates
      // iOS shows one or two permission sheets (or none, if already prompted).
      await Health.requestAuthorization({
        read: [
          'bloodGlucose',
          'workouts',
          'heartRate',
          'restingHeartRate',
          'steps',
          'exerciseTime',
          'sleep',
        ],
      });
      await HealthDiabetes.requestAuthorization();

      const iso = (ms: number) => new Date(ms).toISOString();
      const endIso = now.toISOString();
      const startIso = iso(nowMs - RECENT_GLUCOSE_HOURS * 3600_000);
      // Activity reads use a wider window so the classifier can see workouts
      // and HR context that ended hours ago but still affect insulin needs.
      const activityStartIso = iso(nowMs - ACTIVITY_WINDOW_HOURS * 3600_000);
      const restingStartIso = iso(nowMs - RESTING_HR_LOOKBACK_DAYS * 24 * 3600_000);
      const metricsStartIso = iso(metricsStartMs);
      const mealStartIso = iso(nowMs - MEAL_WINDOW_DAYS * 24 * 3600_000);
      // Since local midnight — the hourly insulin ledger is a "today" view, and
      // the 8h recent window isn't enough once it's afternoon.
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayStartIso = dayStart.toISOString();

      // Each read settles on its own: a read that fails costs only its own
      // field (falling back to the cached copy where there is one), never the
      // whole dashboard. Under Promise.all a single rejection — the
      // unsupported sleep aggregate, a denied type — used to blank everything.
      const settle = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
      const cached = cache?.data;
      type Samples = { samples?: HealthSample[] };
      type Aggregated = { samples?: Agg[] };

      // ── 2. the reads behind the top of the screen, first ──
      // All reads start together; the fast ones are awaited on their own so
      // the current reading appears without waiting for six months of history.
      const fastReads = Promise.all([
        settle(Health.readSamples({ dataType: 'bloodGlucose', startDate: startIso, endDate: endIso, limit: 500, ascending: true }), {} as Samples),
        settle(HealthDiabetes.readInsulin({ startDate: startIso, endDate: endIso, limit: 500 }), { samples: [] as InsulinSample[] }),
        settle(HealthDiabetes.readCarbs({ startDate: startIso, endDate: endIso, limit: 500 }), { samples: [] as CarbSample[] }),
        settle(Health.readSamples({ dataType: 'heartRate', startDate: activityStartIso, endDate: endIso, limit: 1500, ascending: true }), {} as Samples),
        // Resting HR is published once per day — the most recent in a 7d
        // window. ascending:false so [0] is the newest value.
        settle(Health.readSamples({ dataType: 'restingHeartRate', startDate: restingStartIso, endDate: endIso, limit: 1, ascending: false }), {} as Samples),
        // All insulin since local midnight — temp basals + boluses — for the
        // hourly ledger. Loop writes a temp basal every ~5 min, plus boluses.
        settle(HealthDiabetes.readInsulin({ startDate: dayStartIso, endDate: endIso, limit: 2000 }), { samples: [] as InsulinSample[] }),
      ]);

      // ── 3. the 180-day glucose history: only what is new since the cache ──
      //
      // The limit MUST exceed the samples the window can hold, and the sort
      // MUST be newest-first. The native query is a plain HKSampleQuery with a
      // hard limit and a start-date sort (@capgo/capacitor-health Health.swift),
      // so a limit below the true count silently truncates — and with
      // ascending:true it truncates the WRONG END, keeping the oldest samples.
      // 60,000 clears 180 days of 5-minute CGM with headroom.
      const full = needsFullFetch(cache, nowMs);
      const newest = cached?.longGlucose.length ? Date.parse(cached.longGlucose[cached.longGlucose.length - 1].iso) : null;
      const glucoseFrom = full ? metricsStartMs : incrementalFrom(newest, GLUCOSE_OVERLAP_MS, metricsStartMs) ?? metricsStartMs;
      const toReadings = (r: Samples) =>
        (r.samples ?? []).map((s) => ({ iso: s.startDate, mgdl: Math.round(s.value) })).sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
      // `fullFetchedMs` is what the cache records: now for a full read, the
      // previous full read's time for a merge, and 0 for a capped incremental
      // read that may not reach back to the cache — forcing a full read next.
      type GlucoseRead = { readings: GlucoseReading[]; fullFetchedMs: number } | null;
      const ownRead = (): Promise<GlucoseRead> =>
        Health.readSamples({ dataType: 'bloodGlucose', startDate: iso(glucoseFrom), endDate: endIso, limit: LONG_GLUCOSE_LIMIT, ascending: false }).then(
            (r) => {
              const fresh = toReadings(r);
              if (full || !cached) return { readings: fresh, fullFetchedMs: nowMs };
              if (fresh.length >= LONG_GLUCOSE_LIMIT) return { readings: fresh, fullFetchedMs: 0 };
              return {
                readings: mergeSpan(cached.longGlucose, fresh, {
                  timeOf: (g) => Date.parse(g.iso),
                  keyOf: (g) => `${g.iso}:${g.mgdl}`,
                  fromMs: glucoseFrom,
                  windowStartMs: metricsStartMs,
                }),
                fullFetchedMs: cache!.fullFetchedMs,
              };
            },
            () => null,
          );
      const glucoseRead: Promise<GlucoseRead> = options.glucoseHistory
        ? options.glucoseHistory().then(
            (readings) => (readings && readings.length ? { readings, fullFetchedMs: nowMs } : ownRead()),
            () => ownRead(),
          )
        : ownRead();

      const slowReads = Promise.all([
        // Workouts span the METRICS window, not the 72-hour activity window,
        // so "Tuesdays you usually ride at 9" is computable. A few hundred
        // small records over six months.
        settle(Health.queryWorkouts({ startDate: metricsStartIso, endDate: endIso, limit: 1000, ascending: true }).then((r) => r.workouts ?? null), null),
        settle(HealthDiabetes.readCarbs({ startDate: mealStartIso, endDate: endIso, limit: 3000 }).then((r) => r.samples ?? null), null),
        settle(HealthDiabetes.readBoluses({ startDate: mealStartIso, endDate: endIso, limit: 3000 }).then((r) => r.samples ?? null), null),
        settle(HealthDiabetes.aggregateInsulinByDay({ startDate: metricsStartIso, endDate: endIso }).then((r) => r.days ?? null), null),
        settle(Health.queryAggregated({ dataType: 'steps', startDate: metricsStartIso, endDate: endIso, bucket: 'day', aggregation: 'sum' }).then((r: Aggregated) => r.samples ?? null), null),
        // Hourly, not daily: a daily total cannot say whether the movement
        // happened at 9am or 9pm, which is the whole question when reading a
        // weekday's shape hour by hour. Per-day figures are summed back out.
        settle(Health.queryAggregated({ dataType: 'exerciseTime', startDate: metricsStartIso, endDate: endIso, bucket: 'hour', aggregation: 'sum' }).then((r: Aggregated) => r.samples ?? null), null),
        // Sleep must be read as samples, never aggregated: it is categorical
        // and @capgo/capacitor-health rejects queryAggregated for it natively.
        settle(Health.readSamples({ dataType: 'sleep', startDate: metricsStartIso, endDate: endIso, limit: 5000, ascending: true }).then((r: Samples) => r.samples ?? null), null),
        settle(Health.queryAggregated({ dataType: 'steps', startDate: activityStartIso, endDate: endIso, bucket: 'hour', aggregation: 'sum' }).then((r: Aggregated) => r.samples ?? null), null),
        glucoseRead,
      ]);

      const [g8, i8, c8, hr, rhr, today] = await fastReads;
      const fast: FastPart = {
        glucose8h: g8.samples ?? [],
        insulin8h: i8.samples ?? [],
        carbs8h: c8.samples ?? [],
        heartRate: hr.samples ?? [],
        resting: rhr.samples ?? [],
        insulinToday: today.samples ?? [],
      };
      snapshot = { ...snapshot, ...fastFields(fast, now) };
      emit();

      const [workouts, longCarbs, longBoluses, insulinByDay, stepsByDay, exerciseHourly, sleep, hourlySteps, glucose] = await slowReads;
      // A read that failed keeps the cached copy rather than blanking its field.
      const raw: HkRaw = {
        ...fast,
        workouts: workouts ?? cached?.workouts ?? [],
        longGlucose: glucose?.readings ?? cached?.longGlucose ?? [],
        longCarbs: longCarbs ?? cached?.longCarbs ?? [],
        longBoluses: longBoluses ?? cached?.longBoluses ?? [],
        insulinByDay: insulinByDay ?? cached?.insulinByDay ?? [],
        stepsByDay: stepsByDay ?? cached?.stepsByDay ?? [],
        exerciseHourly: exerciseHourly ?? cached?.exerciseHourly ?? [],
        sleep: sleep ?? cached?.sleep ?? [],
        hourlySteps: hourlySteps ?? cached?.hourlySteps ?? [],
      };

      snapshot = buildSnapshot(raw, now, viewOpts());
      emit();

      if (!options.glucoseHistory && glucose) {
        void saveHistory<HkRaw>(CACHE_KEY, {
          format: HISTORY_FORMAT,
          sourceKey: CACHE_SOURCE,
          fullFetchedMs: glucose.fullFetchedMs,
          savedMs: nowMs,
          data: raw,
        });
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      snapshot = errorSnapshot(snapshot, e);
      emit();
    }
  };

  return {
    kind: 'healthkit',
    displayName: 'Apple Health (HealthKit)',
    getSnapshot: () => snapshot,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    refresh,
  };
}
