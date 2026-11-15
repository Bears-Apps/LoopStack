import type { CurrentGlucose } from '@/lib/glucoseStatus';
import { absorptionPatternFromNotes } from '@/lib/metabolism/carbAbsorption';
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
import { computeBasalInsights, type BasalInsights } from '@/lib/metabolism/basalInsights';
import {
  deliveredBasalByDay,
  hasMeasuredBasal,
  measuredDays,
} from '@/lib/metabolism/deliveredBasal';
import { computeAutosens, type Autosens } from '@/lib/metabolism/autosens';
import { computeAutotune, type AutotuneResult } from '@/lib/metabolism/autotune';
import { computeAbsorptionInsights, type AbsorptionInsights } from '@/lib/metabolism/absorptionProfile';
import { computeSettingsReview, type SettingsReview } from '@/lib/metabolism/settingsReview';
import { computeDayHourGrid, PATTERN_SAMPLE_WEEKS, type DayHourGrid } from '@/lib/metrics/dayHourGrid';
import { computeWeekdayHourly, type WeekdayHourly } from '@/lib/metrics/weekdayHourly';
import type { WeekdayExercise } from '@/lib/metrics/weekdayExercise';
import { computeRiskWindows, type RiskWindow } from '@/lib/alerts/riskWindows';
import { computeClinicianMetrics } from '@/lib/metrics/clinicianMetrics';
import type { GlucoseWindow, HypoReport } from '@/lib/metrics/hypoEvents';
import type { AgpProfile } from '@/lib/metrics/agp';
import type { MealPanels } from '@/lib/metrics/mealPanels';
import type { CorrectionOutcomes } from '@/lib/metrics/correctionOutcomes';
import type { TempBasalUse } from '@/lib/metrics/tempBasalUse';
import type { LoopIobSample } from '@/lib/metabolism/iobAgreement';
import {
  computeLoopMode,
  type LoopModeSummary,
  type LoopStatusEntry,
  type OverrideEvent,
} from '@/lib/loop/loopMode';
import type { ActivitySummary } from '@/lib/activity/activityEvents';
import type { GlucoseMetrics, MetricsRange } from '@/data/types';
import { dedupeCarbEntries, dedupeInsulinEvents } from '@/lib/metabolism/dedupe';
import { loadNightscoutConfig } from './nightscoutConfig';
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
} from './types';

// Nightscout-backed data source.
//
// What Nightscout uniquely adds over HealthKit: Loop's own telemetry —
// devicestatus heartbeats (closed-loop vs manual) and "Temporary Override"
// treatments — which power the loop-mode summary and override suggestions.
//
// What it lacks: activity data (workouts/HR/steps stay empty → the activity
// summary shows its honest building state), basal totals (temp-basal
// integration is not implemented; insulin metrics are bolus-only here), and
// meal names (Loop doesn't upload favorite names to NS, so shape-based
// patterns compute but name-keyed favorites usually stay empty).
//
// If requests fail with a network/CORS error on web, the user's NS site needs
// `cors` added to its ENABLE setting. On device (Capacitor) CORS is moot.

// 180 days so the range selector's longest option is backed by real data
// rather than 90 days under a 180-day label. count is raised to match: at
// 5-minute CGM, 180 days is ~51,840 entries, and a cap below that silently
// truncates the OLDEST readings, which is exactly the half a long window is
// selected to see.
const METRICS_WINDOW_DAYS = 180;
const MEAL_WINDOW_DAYS = 30;
const LOOP_MODE_WINDOW_DAYS = 14;
/** Autotune is a trend tool — it wants weeks, not days. */
const AUTOTUNE_WINDOW_DAYS = 21;
/** Autosens deliberately reads only the recent stretch. */
const AUTOSENS_WINDOW_HOURS = 24;
const STALE_THRESHOLD_MIN = 15;
const TREND_WINDOW_MIN = 30;

type NsEntry = { _id?: string; date: number; sgv?: number };
type NsTreatment = {
  _id?: string;
  created_at?: string;
  timestamp?: string;
  eventType?: string;
  carbs?: number | null;
  insulin?: number | null;
  absorptionTime?: number | null; // minutes
  duration?: number | null;       // minutes (overrides / temp targets / temp basal)
  rate?: number | null;           // U/hr (Temp Basal)
  absolute?: number | null;       // U/hr (Temp Basal, absolute form)
  reason?: string | null;         // Loop override preset name
  notes?: string | null;
  foodType?: string | null;
};
type NsDeviceStatus = {
  _id?: string;
  created_at?: string;
  loop?: {
    timestamp?: string;
    enacted?: unknown;
    recommendedTempBasal?: unknown;
    /** Loop's own insulin-on-board at the time of the upload. */
    iob?: { iob?: number | null } | null;
  } | null;
};

// Device cache: what each stream re-reads on every refresh, so backfilled and
// edited records inside that span are picked up (see historyCache.ts).
const CACHE_KEY = 'nightscout';
const ENTRY_OVERLAP_MS = 6 * 3600_000;
const TREATMENT_OVERLAP_MS = 24 * 3600_000;
const STATUS_OVERLAP_MS = 3600_000;
const ENTRY_COUNT = 53_000;
const TREATMENT_COUNT = 12_000;
const STATUS_COUNT = 5_000;
/** Three hours of 5-minute CGM: enough for the current reading and its trend. */
const QUICK_ENTRY_COUNT = 36;

// Only the fields the views read are kept. A devicestatus document is several
// kilobytes of Loop's prediction state; the cache needs three facts from it.
const trimEntry = (e: NsEntry): NsEntry => ({ _id: e._id, date: e.date, sgv: e.sgv });
const trimTreatment = (t: NsTreatment): NsTreatment => ({
  _id: t._id,
  created_at: t.created_at,
  timestamp: t.timestamp,
  eventType: t.eventType,
  carbs: t.carbs,
  insulin: t.insulin,
  absorptionTime: t.absorptionTime,
  duration: t.duration,
  rate: t.rate,
  absolute: t.absolute,
  reason: t.reason,
  notes: t.notes,
  foodType: t.foodType,
});
const trimStatus = (d: NsDeviceStatus): NsDeviceStatus => ({
  _id: d._id,
  created_at: d.created_at,
  loop: d.loop
    ? {
        enacted: d.loop.enacted || d.loop.recommendedTempBasal ? true : undefined,
        iob: typeof d.loop.iob?.iob === 'number' ? { iob: d.loop.iob.iob } : null,
      }
    : null,
});

const entryTime = (e: NsEntry) => e.date;
const treatmentTime = (t: NsTreatment) => Date.parse(t.created_at ?? t.timestamp ?? '');
const statusTime = (d: NsDeviceStatus) => Date.parse(d.created_at ?? '');
const entryKey = (e: NsEntry) => e._id ?? `${e.date}:${e.sgv}`;
const treatmentKey = (t: NsTreatment) =>
  t._id ?? `${t.created_at ?? t.timestamp}|${t.eventType}|${t.carbs}|${t.insulin}|${t.rate ?? t.absolute}`;
const statusKey = (d: NsDeviceStatus) => d._id ?? `${d.created_at}`;

const byTime = <T,>(xs: T[], timeOf: (x: T) => number): T[] => [...xs].sort((a, b) => timeOf(a) - timeOf(b));

function newestMs<T>(xs: T[], timeOf: (x: T) => number): number | null {
  let best: number | null = null;
  for (const x of xs) {
    const t = timeOf(x);
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

/** A cached snapshot shown while the fresh read is under way. */
function withLoading(s: DataSnapshot): DataSnapshot {
  return {
    ...s,
    currentGlucose: { ...s.currentGlucose, loading: true },
    metrics: { ...s.metrics, loading: true },
  };
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

function isStale(iso: string): boolean {
  return (Date.now() - new Date(iso).getTime()) / 60_000 > STALE_THRESHOLD_MIN;
}

/** Linear-fit slope over the trend window, mg/dL per minute. */
function slopePerMin(readings: GlucoseReading[]): number {
  if (readings.length < 2) return 0;
  const t0 = new Date(readings[0].iso).getTime();
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const r of readings) {
    const x = (new Date(r.iso).getTime() - t0) / 60_000;
    sx += x; sy += r.mgdl; sxy += x * r.mgdl; sxx += x * x;
  }
  const n = readings.length;
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

/** The raw Nightscout records a snapshot is computed from. */
type NsRaw = { entries: NsEntry[]; treatments: NsTreatment[]; devicestatus: NsDeviceStatus[] };

/** Latest reading and its trend, from readings sorted oldest first. */
function currentFrom(glucose: GlucoseReading[]): CurrentGlucose | null {
  const newest = glucose.at(-1) ?? null;
  if (!newest) return null;
  const cutoff = new Date(newest.iso).getTime() - TREND_WINDOW_MIN * 60_000;
  const slope = slopePerMin(glucose.filter((g) => new Date(g.iso).getTime() >= cutoff));
  return {
    mgdl: newest.mgdl,
    ratePer5min: +(slope * 5).toFixed(2),
    ratePer20min: +(slope * 20).toFixed(2),
    lastUpdatedIso: newest.iso,
  };
}

const toGlucose = (entries: NsEntry[]): GlucoseReading[] =>
  entries
    .filter((e) => typeof e.sgv === 'number' && e.date > 0)
    .map((e) => ({ iso: new Date(e.date).toISOString(), mgdl: Math.round(e.sgv!) }))
    .sort((a, b) => a.iso.localeCompare(b.iso));

/**
 * Every view this source publishes, from its raw records. Pure apart from the
 * settings it reads (therapy, targets), so the same records — fetched now or
 * read back from the device cache — always produce the same dashboard.
 */
function buildSnapshot({ entries, treatments, devicestatus }: NsRaw, now: Date): DataSnapshot {
  const nowIso = now.toISOString();
  const metricsStartMs = now.getTime() - METRICS_WINDOW_DAYS * 24 * 3600_000;

  // ── map raw streams ──
  const glucose = toGlucose(entries);

  const when = (t: NsTreatment) => t.created_at ?? t.timestamp ?? '';
  // Duplicate treatments are the norm on a long-lived Nightscout site (edits
  // re-upload, second devices post their own copy), and counting a meal
  // twice is what produced the impossible "715 g/day avg carbs".
  const carbs: CarbEntry[] = dedupeCarbEntries(
    treatments
      .filter((t) => (t.carbs ?? 0) > 0 && when(t))
      .map((t) => ({
        iso: new Date(when(t)).toISOString(),
        grams: +(t.carbs as number).toFixed(1),
        absorptionHours: t.absorptionTime ? t.absorptionTime / 60 : 3,
        label: t.foodType ?? undefined,
        // The fork's uploader patch writes the entry's absorption-pattern
        // identifier into the notes as `[delayed-metabolic-v1]`; it is
        // what decides which curve Loop graded the entry on.
        absorptionPattern: absorptionPatternFromNotes(t.notes),
      })),
  );

  const boluses: InsulinEvent[] = dedupeInsulinEvents(
    treatments
      .filter((t) => (t.insulin ?? 0) > 0 && when(t))
      .map((t) => ({
        iso: new Date(when(t)).toISOString(),
        units: +(t.insulin as number).toFixed(3),
        kind: 'bolus' as const,
      })),
  );

  // Temp basals. Without these, every deviation is measured against the
  // schedule alone — so an hour Loop spent at zero temp reads as a plain
  // unexplained rise, and the basal analysis blames the schedule for
  // insulin that was deliberately withheld.
  const tempBasals: InsulinEvent[] = treatments
    .filter(
      (t) =>
        t.eventType === 'Temp Basal' &&
        when(t) &&
        (t.rate ?? t.absolute) != null &&
        (t.duration ?? 0) > 0,
    )
    .map((t) => {
      const rate = (t.rate ?? t.absolute) as number;
      const durationMin = t.duration as number;
      return {
        iso: new Date(when(t)).toISOString(),
        units: +((rate * durationMin) / 60).toFixed(3),
        kind: 'basal_temp' as const,
        rateUPerHr: rate,
        durationMin,
      };
    });

  // Boluses and temp basals together are what the deviation math nets
  // against the schedule. They are kept apart from `recentInsulin`, which
  // the ledger treats as bolus-only.
  const insulinForAnalysis: InsulinEvent[] = [...boluses, ...tempBasals];

  const overrides: OverrideEvent[] = treatments
    .filter((t) => t.eventType === 'Temporary Override' && when(t))
    .map((t) => ({
      startIso: new Date(when(t)).toISOString(),
      durationMin: t.duration ?? 60,
      name: (t.reason ?? t.notes ?? '(unnamed)').trim() || '(unnamed)',
    }));

  // Loop heartbeat: an entry is "looping" when Loop reports an enacted
  // cycle (or a recommendation it was about to enact). Open-loop uploads
  // still carry a `loop` object but no enacted — those count as manual.
  const statuses: LoopStatusEntry[] = devicestatus
    .filter((d) => d.created_at)
    .map((d) => ({
      iso: new Date(d.created_at!).toISOString(),
      looping: Boolean(d.loop && (d.loop.enacted || d.loop.recommendedTempBasal)),
    }));

  // Loop's own IOB, for checking our reconstruction against. These are
  // never fed into the deviation maths — the maths needs insulin activity,
  // which devicestatus does not carry — but as an independent read of the
  // same insulin history they are the one available way to find out whether
  // the treatment stream is complete.
  const loopIob: LoopIobSample[] = devicestatus
    .filter((d) => d.created_at && typeof d.loop?.iob?.iob === 'number')
    .map((d) => ({
      iso: new Date(d.created_at!).toISOString(),
      iob: d.loop!.iob!.iob as number,
    }));

  // ── current glucose ──
  const newest = glucose.at(-1) ?? null;
  const current = currentFrom(glucose);

  // ── computed views ──
  //
  // Basal is reconstructed from the temp-basal records this refresh already
  // parsed above, integrated against the schedule between them. The old
  // comment here said temp-basal integration "isn't implemented" and passed
  // basal: 0 — but it WAS implemented, twenty lines up, for the deviation
  // math; only the metrics never received it. That is what made the Bolus
  // share tile read 100% and prompted "is standard basal not factored in?".
  const basalDays = deliveredBasalByDay(
    tempBasals
      .filter((t) => t.rateUPerHr != null && t.durationMin != null)
      .map((t) => ({
        iso: t.iso,
        rateUPerHr: t.rateUPerHr as number,
        durationMin: t.durationMin as number,
      })),
    activeLoopTherapy(),
    metricsStartMs,
    now.getTime(),
  );
  // Only claim measurement where temps actually cover the day. Without
  // coverage the integral is just the schedule wearing a measurement's
  // clothes, so those days report 0 and the existing scheduled-total
  // fallback takes over, correctly labelled "basal from schedule".
  const measuredBasalByDay = new Map(
    measuredDays(basalDays).map((d) => [d.dayIso, d.units]),
  );
  const basalMeasured = hasMeasuredBasal(basalDays);

  const metricsInputs: MetricsInputs = {
    glucose,
    insulinByDay: bucketByDay(boluses.map((b) => ({ iso: b.iso, value: b.units }))).map(
      (d) => ({
        dayIso: d.dayIso,
        basal: measuredBasalByDay.get(d.dayIso) ?? 0,
        bolus: d.value,
      }),
    ),
    carbsByDay: bucketByDay(carbs.map((c) => ({ iso: c.iso, value: c.grams }))),
    stepsByDay: [],
    exerciseByDay: [],
    sleepByDay: [],
    targetRange: loadTargetRange(),
    // Nightscout is bolus-only: no delivered basal ever arrives. Supply the
    // scheduled daily total so the split reflects background insulin
    // instead of reading as 100% bolus.
    scheduledDailyBasal: dailyBasalTotal(activeLoopTherapy()),
  };
  const metricsView = hasMetricsData(metricsInputs)
    ? computeAllMetrics(metricsInputs, now)
    : null;

  const loopModeView = computeLoopMode({
    statuses,
    overrides,
    glucose,
    windowDays: LOOP_MODE_WINDOW_DAYS,
    now,
    // Same boundaries the dashboard scores against, so an override verdict
    // and the TIR tile above it can never disagree about what "in range" is.
    targetRange: loadTargetRange(),
  });

  // Hoisted so the settings roster can consume the same results the
  // snapshot publishes — running the engines twice would double the work
  // and open the door to the two drifting apart.
  const autotuneView = computeAutotune({
    glucose,
    carbs,
    insulin: insulinForAnalysis,
    therapy: activeLoopTherapy(),
    loopIob,
    windowDays: AUTOTUNE_WINDOW_DAYS,
    now,
  });
  const absorptionView = computeAbsorptionInsights({
    glucose,
    carbs,
    insulin: insulinForAnalysis,
    therapy: activeLoopTherapy(),
    windowDays: MEAL_WINDOW_DAYS,
    now,
  });
  // Clinician metrics. Treatments span 180 days here, but the meal,
  // correction and temp-basal reads keep the meal window so they describe
  // the same recent stretch as the other meal analyses.
  const clinician = computeClinicianMetrics({
    glucose,
    carbs,
    insulin: insulinForAnalysis,
    therapy: activeLoopTherapy(),
    target: loadTargetRange(),
    now,
    treatmentWindowDays: MEAL_WINDOW_DAYS,
  });

  return {
    ...emptySnapshot(),
    currentGlucose: current
      ? {
          data: current,
          loading: false,
          error: null,
          lastUpdatedIso: current.lastUpdatedIso,
          isStale: isStale(current.lastUpdatedIso),
          origin: 'computed',
        }
      : {
          ...emptyResult<CurrentGlucose>(),
          error: new Error('No glucose entries found on this Nightscout site.'),
        },
    recentGlucose: freshResult(glucose, newest?.iso ?? null, 'computed'),
    recentInsulin: freshResult(boluses, boluses.at(-1)?.iso ?? null, 'computed'),
    // The newest devicestatus IOB. Deliberately NOT interpolated forward:
    // a stale reading is reported with its own timestamp so anything using
    // it can decide whether it is fresh enough, rather than being handed a
    // decayed guess dressed up as Loop's own number.
    currentLoopIob: loopIob.length
      ? freshResult(loopIob.at(-1)!.iob, loopIob.at(-1)!.iso, 'computed')
      : { ...emptyResult<number | null>(), loading: false },
    recentCarbs: freshResult(carbs, carbs.at(-1)?.iso ?? null, 'computed'),
    timeTrends: freshResult(
      computeTimeTrends(glucose, loadTargetRange()),
      nowIso,
      'computed',
    ),
    // Bolus-only: Nightscout has no delivered-basal integration here, so
    // hasBasal now reflects whether temps actually covered the window,
    // rather than being pinned false. The xtra-insulin / observed-ratio
    // cards need real delivered basal, and with reconstruction they can
    // have it — but only when the mirror carried enough temps to measure.
    insulinLedger: freshResult(
      {
        hourly: bucketInsulinByHour(boluses, now),
        hasBasal: basalMeasured,
        scheduledBasalU: dailyBasalTotal(activeLoopTherapy()),
      },
      nowIso,
      'computed',
    ),
    metrics: metricsView
      ? freshResult(metricsView, nowIso, 'computed')
      : emptyResult<Record<MetricsRange, GlucoseMetrics>>(),
    loopMode: freshResult(loopModeView, nowIso, 'computed'),
    // deliveredDailyU stays null: Nightscout here is bolus-only, so a
    // delivered-vs-scheduled comparison would be measuring nothing.
    basalInsights: freshResult(
      computeBasalInsights({
        glucose,
        carbs,
        insulin: insulinForAnalysis,
        therapy: activeLoopTherapy(),
        windowDays: MEAL_WINDOW_DAYS,
        deliveredDailyU: null,
        now,
      }),
      nowIso,
      'computed',
    ),
    autosens: freshResult(
      computeAutosens({
        glucose,
        carbs,
        insulin: insulinForAnalysis,
        therapy: activeLoopTherapy(),
        windowHours: AUTOSENS_WINDOW_HOURS,
        now,
      }),
      nowIso,
      'computed',
    ),
    autotune: freshResult(autotuneView, nowIso, 'computed'),
    // Absorption reads the same treatment stream — the window matches the
    // meal fetch, since that is how far back carb entries actually go.
    absorptionInsights: freshResult(absorptionView, nowIso, 'computed'),
    // The roster: one confidence-graded row for every Loop setting, built
    // from the engines above plus the raw streams.
    settingsReview: freshResult(
      computeSettingsReview({
        therapy: activeLoopTherapy(),
        autotune: autotuneView,
        absorption: absorptionView,
        glucose,
        carbs,
        insulin: insulinForAnalysis,
        windowDays: MEAL_WINDOW_DAYS,
        now,
      }),
      nowIso,
      'computed',
    ),
    // Risk windows read the full 90-day glucose window: recurrence is
    // counted in weeks, so the longer history is what makes a pattern
    // distinguishable from a bad fortnight.
    // No workouts or exercise minutes on this path — Nightscout carries
    // none, so the grid's activity annotations stay empty here rather than
    // being faked from something adjacent.
    // The weekday picture, unlike risk windows, reads only the last twelve
    // weeks: it is what the heads-ups and the morning report describe as
    // "usually", and usually should mean lately.
    dayHourGrid: freshResult(
      computeDayHourGrid({
        glucose,
        target: loadTargetRange(),
        now,
        carbs,
        weeks: PATTERN_SAMPLE_WEEKS,
      }),
      nowIso,
      'computed',
    ),
    weekdayHourly: freshResult(
      computeWeekdayHourly({
        glucose,
        insulin: insulinForAnalysis,
        carbs,
        therapy: activeLoopTherapy(),
        target: loadTargetRange(),
        now,
      }),
      nowIso,
      'computed',
    ),
    riskWindows: freshResult(
      computeRiskWindows({ glucose, target: loadTargetRange(), now }),
      nowIso,
      'computed',
    ),
    hypoEvents: glucose.length ? freshResult(clinician.hypoEvents, nowIso, 'computed') : emptyResult<Record<GlucoseWindow, HypoReport>>(),
    agp: glucose.length ? freshResult(clinician.agp, nowIso, 'computed') : emptyResult<Record<GlucoseWindow, AgpProfile>>(),
    mealPanels: glucose.length ? freshResult(clinician.mealPanels, nowIso, 'computed') : emptyResult<MealPanels>(),
    correctionOutcomes: glucose.length ? freshResult(clinician.correctionOutcomes, nowIso, 'computed') : emptyResult<CorrectionOutcomes>(),
    // Null when the site carried no temp basals in the window.
    tempBasalUse: clinician.tempBasalUse
      ? freshResult(clinician.tempBasalUse, nowIso, 'computed')
      : emptyResult<TempBasalUse>(),
  };
}

export function createNightscoutDataSource(): DataSource {
  let snapshot: DataSnapshot = emptySnapshot();
  const listeners = new Set<DataSubscriber>();
  const emit = () => { for (const cb of listeners) cb(); };

  const refresh = async (): Promise<void> => {
    const config = loadNightscoutConfig();
    if (!config.url) {
      snapshot = {
        ...emptySnapshot(),
        currentGlucose: {
          ...emptyResult<CurrentGlucose>(),
          error: new Error(
            'No Nightscout URL configured. Add your site URL under Data sources → Nightscout.',
          ),
        },
      };
      emit();
      return;
    }

    snapshot = {
      ...snapshot,
      currentGlucose: { ...snapshot.currentGlucose, loading: true, error: null },
      metrics: { ...snapshot.metrics, loading: true, error: null },
      loopMode: { ...snapshot.loopMode, loading: true, error: null },
    };
    emit();

    const tokenParam = config.token ? `&token=${encodeURIComponent(config.token)}` : '';
    const get = async <T>(path: string): Promise<T> => {
      const sep = path.includes('?') ? '' : '?';
      const res = await fetch(`${config.url}${path}${sep}${tokenParam}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(
          `Nightscout request failed (${res.status}) — check the URL${config.token ? ' and token' : ''}.`,
        );
      }
      return (await res.json()) as T;
    };

    try {
      const now = new Date();
      const nowMs = now.getTime();
      const metricsStartMs = nowMs - METRICS_WINDOW_DAYS * 24 * 3600_000;
      const loopStartMs = nowMs - LOOP_MODE_WINDOW_DAYS * 24 * 3600_000;

      // ── 1. the dashboard from what is already on the device ──
      // Only while the screen has nothing to show: a refresh after the first
      // keeps the live snapshot rather than stepping back to the cache.
      const cache = await loadHistory<NsRaw>(CACHE_KEY, config.url);
      if (cache && snapshot.metrics.data == null) {
        snapshot = withLoading(buildSnapshot(cache.data, now));
        emit();
      }

      // ── 2. what to read ──
      const full = needsFullFetch(cache, nowMs);
      const plan = full || !cache
        ? { entries: metricsStartMs, treatments: metricsStartMs, devicestatus: loopStartMs }
        : {
            entries: incrementalFrom(newestMs(cache.data.entries, entryTime), ENTRY_OVERLAP_MS, metricsStartMs) ?? metricsStartMs,
            treatments: incrementalFrom(newestMs(cache.data.treatments, treatmentTime), TREATMENT_OVERLAP_MS, metricsStartMs) ?? metricsStartMs,
            devicestatus: incrementalFrom(newestMs(cache.data.devicestatus, statusTime), STATUS_OVERLAP_MS, loopStartMs) ?? loopStartMs,
          };

      // A full read of six months takes a while; the current reading should
      // not wait for it. A small read of the last few hours goes first.
      if (full) {
        void get<NsEntry[]>(`/api/v1/entries/sgv.json?count=${QUICK_ENTRY_COUNT}`)
          .then((quick) => {
            const current = currentFrom(toGlucose(quick));
            // Only if the full read has not already landed something newer.
            if (!current || (snapshot.currentGlucose.data && snapshot.currentGlucose.data.lastUpdatedIso >= current.lastUpdatedIso)) return;
            snapshot = {
              ...snapshot,
              currentGlucose: {
                data: current,
                loading: false,
                error: null,
                lastUpdatedIso: current.lastUpdatedIso,
                isStale: isStale(current.lastUpdatedIso),
                origin: 'computed',
              },
            };
            emit();
          })
          .catch(() => {
            // The full read reports any connection problem.
          });
      }

      const read = (from: typeof plan) =>
        Promise.all([
          get<NsEntry[]>(`/api/v1/entries/sgv.json?count=${ENTRY_COUNT}&find[date][$gte]=${from.entries}`),
          // Treatments span the METRICS window, not the meal window, so per-day
          // carb and insulin averages match the range selector's label. count
          // scales with the span: ~30 treatments/day over 180 days.
          get<NsTreatment[]>(
            `/api/v1/treatments.json?count=${TREATMENT_COUNT}&find[created_at][$gte]=${encodeURIComponent(new Date(from.treatments).toISOString())}`,
          ),
          get<NsDeviceStatus[]>(
            `/api/v1/devicestatus.json?count=${STATUS_COUNT}&find[created_at][$gte]=${encodeURIComponent(new Date(from.devicestatus).toISOString())}`,
          ),
        ]);

      let [entries, treatments, devicestatus] = await read(plan);
      let raw: NsRaw;
      // An incremental read that hit a count cap may have a hole between it
      // and the cache; read the whole window instead of merging across it.
      const capped = entries.length >= ENTRY_COUNT || treatments.length >= TREATMENT_COUNT || devicestatus.length >= STATUS_COUNT;
      if (!full && cache && !capped) {
        raw = {
          entries: mergeSpan(cache.data.entries, entries.map(trimEntry), { timeOf: entryTime, keyOf: entryKey, fromMs: plan.entries, windowStartMs: metricsStartMs }),
          treatments: mergeSpan(cache.data.treatments, treatments.map(trimTreatment), { timeOf: treatmentTime, keyOf: treatmentKey, fromMs: plan.treatments, windowStartMs: metricsStartMs }),
          devicestatus: mergeSpan(cache.data.devicestatus, devicestatus.map(trimStatus), { timeOf: statusTime, keyOf: statusKey, fromMs: plan.devicestatus, windowStartMs: loopStartMs }),
        };
      } else {
        if (!full && cache && capped) {
          [entries, treatments, devicestatus] = await read({ entries: metricsStartMs, treatments: metricsStartMs, devicestatus: loopStartMs });
        }
        // Oldest first, as the merged path produces. Nightscout answers newest
        // first, and the views that take "the latest" record — Loop's current
        // IOB above all — read the end of the list: unsorted, that was the
        // OLDEST devicestatus in the fortnight.
        raw = {
          entries: byTime(entries.map(trimEntry), entryTime),
          treatments: byTime(treatments.map(trimTreatment), treatmentTime),
          devicestatus: byTime(devicestatus.map(trimStatus), statusTime),
        };
      }

      snapshot = buildSnapshot(raw, now);
      emit();
      void saveHistory<NsRaw>(CACHE_KEY, {
        format: HISTORY_FORMAT,
        sourceKey: config.url,
        fullFetchedMs: full || capped || !cache ? nowMs : cache.fullFetchedMs,
        savedMs: nowMs,
        data: raw,
      });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const friendly =
        e.message.includes('Failed to fetch') || e.message.includes('Load failed')
          ? new Error(
              'Could not reach Nightscout. Check the URL — and if this is the web preview, your site may need "cors" added to its ENABLE setting.',
            )
          : e;
      snapshot = {
        ...snapshot,
        currentGlucose: { ...snapshot.currentGlucose, loading: false, error: friendly },
        metrics: { ...snapshot.metrics, loading: false, error: friendly },
        loopMode: { ...snapshot.loopMode, loading: false, error: friendly },
      };
      emit();
    }
  };

  return {
    kind: 'nightscout',
    displayName: 'Nightscout',
    getSnapshot: () => snapshot,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    refresh,
  };
}

function bucketByDay(
  items: { iso: string; value: number }[],
): { dayIso: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const it of items) {
    const d = new Date(it.iso);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + it.value);
  }
  return [...byDay.entries()].map(([dayIso, value]) => ({ dayIso, value }));
}
