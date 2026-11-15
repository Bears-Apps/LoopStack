// Data source abstraction.
//
// Screens read data through this interface, not by importing sample* objects
// directly. Adding HealthKit, Nightscout, Dexcom Share, Loop direct, etc. is
// "implement DataSource → register in the source registry → toggle in
// Settings." Nothing in the UI changes.
//
// Design principles:
//   - **Sync-friendly snapshots.** Each source maintains an in-memory snapshot
//     React reads via useSyncExternalStore; refreshes happen async in the
//     background. Avoids Suspense + lets screens render immediately with
//     last-known data.
//   - **Loading + error + staleness in every result.** Real CGM streams have
//     gaps; the UI must be able to show "data is 17 min old" or "couldn't
//     reach Nightscout."
//   - **Raw events + computed views.** Sources expose primitive event streams
//     (glucose readings, insulin events, carb entries) AND pre-computed views
//     (latest meal trace) so the mock can stay simple while real sources
//     drive the same view via computation later.

import type { CurrentGlucose } from '@/lib/glucoseStatus';
import type { GlucoseMetrics, MetricsRange } from '@/data/types';
import type { ActivitySummary } from '@/lib/activity/activityEvents';
import type { LoopModeSummary } from '@/lib/loop/loopMode';
import type { BasalInsights } from '@/lib/metabolism/basalInsights';
import type { Autosens } from '@/lib/metabolism/autosens';
import type { AutotuneResult } from '@/lib/metabolism/autotune';
import type { AbsorptionInsights } from '@/lib/metabolism/absorptionProfile';
import type { SettingsReview } from '@/lib/metabolism/settingsReview';
import type { RiskWindow } from '@/lib/alerts/riskWindows';
import type { DayHourGrid } from '@/lib/metrics/dayHourGrid';
import type { WeekdayHourly } from '@/lib/metrics/weekdayHourly';
import type { WeekdayExercise } from '@/lib/metrics/weekdayExercise';
import type { TimeTrends } from '@/lib/metrics/timeTrends';
import type { InsulinLedger } from '@/lib/metabolism/insulinLedger';
import type { GlucoseWindow, HypoReport } from '@/lib/metrics/hypoEvents';
import type { AgpProfile } from '@/lib/metrics/agp';
import type { MealPanels } from '@/lib/metrics/mealPanels';
import type { CorrectionOutcomes } from '@/lib/metrics/correctionOutcomes';
import type { TempBasalUse } from '@/lib/metrics/tempBasalUse';

/** Identifier for a registered data source implementation. */
export type DataSourceKind = 'mock' | 'healthkit' | 'nightscout' | 'combined';

/** Where a result's values came from. Screens show a Sample tag for anything
 *  not explicitly 'computed' — the honest default is to disclose. */
export type DataOrigin = 'sample' | 'computed';

/** What every hook returns to the UI. */
export type DataResult<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Source-reported timestamp for the data; null if unknown. */
  lastUpdatedIso: string | null;
  /** True when the data is older than the source's freshness window. */
  isStale: boolean;
  /** Absent = treat as sample. Only real computation may claim 'computed'. */
  origin?: DataOrigin;
};

/** Raw glucose reading. Real sources stream these; mock can synthesize. */
export type GlucoseReading = {
  iso: string;
  mgdl: number;
};

/** Raw insulin event from Loop / Health / Nightscout. */
export type InsulinEvent = {
  iso: string;
  units: number;
  /** "bolus" includes meal + correction; "basal" is the underlying rate. */
  kind: 'bolus' | 'basal_temp' | 'basal_scheduled';
  /** Basal kinds only: how long the rate ran. Present when the source reports
   *  temp basals, which is what lets deviation math net delivery against the
   *  schedule instead of treating every temp as extra insulin. */
  durationMin?: number;
  /** Basal kinds only: the delivery rate in U/hr. */
  rateUPerHr?: number;
};

/** Raw carb entry. */
export type CarbEntry = {
  iso: string;
  grams: number;
  /** Loop's absorption time in hours (default ~3, Loop user-tweakable). */
  absorptionHours: number;
  /** Optional human label. */
  label?: string;
  /** Loop's per-entry absorption-pattern identifier (`delayed-metabolic-v1`,
   *  `standard-v1`), read from the `[…-vN]` marker the fork's Nightscout
   *  uploader appends to the treatment notes. Absent or null = no explicit
   *  pattern: the entry is graded by its legacy text marker, as in Loop. */
  absorptionPattern?: string | null;
};

/** Activity / workout type aliases. Narrow union our code branches on; the
 *  HealthKit plugin's wide enum is mapped down to this in healthKitDataSource. */
export type WorkoutType =
  | 'running'
  | 'walking'
  | 'cycling'
  | 'swimming'
  | 'strength'
  | 'hiit'
  | 'cardio'
  | 'other'
  | 'unknown';

/** A logged workout — Apple Watch / Fitness / third-party app source. */
export type WorkoutEntry = {
  id: string;
  type: WorkoutType;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  calories?: number;
  distanceMeters?: number;
  source?: string;
};

/** Per-sample heart-rate reading. */
export type HeartRateSample = {
  timestamp: string;
  bpm: number;
  source?: string;
};

/** Snapshot a source publishes to subscribers. Each field follows DataResult. */
export type DataSnapshot = {
  currentGlucose: DataResult<CurrentGlucose>;
  recentGlucose: DataResult<GlucoseReading[]>;
  recentInsulin: DataResult<InsulinEvent[]>;
  /** Loop's OWN current insulin-on-board, from its latest devicestatus upload.
   *  Not a reconstruction — this is the number Loop itself is acting on, which
   *  is why it is safe to read. Null on any source that does not carry
   *  devicestatus (HealthKit has no equivalent). */
  currentLoopIob: DataResult<number | null>;
  recentCarbs: DataResult<CarbEntry[]>;
  recentWorkouts: DataResult<WorkoutEntry[]>;
  recentHeartRate: DataResult<HeartRateSample[]>;
  /** Apple Health publishes resting HR as a daily computed value. */
  restingHeartRate: DataResult<number>;
  // ---- Computed views ----
  // Sources fill these from their raw streams (mock: hand-authored samples;
  // HealthKit: the pure compute modules). Screens read only these.
  metrics: DataResult<Record<MetricsRange, GlucoseMetrics>>;
  /** Glucose sliced by day of week and hour of day. */
  timeTrends: DataResult<TimeTrends>;
  /** Today's insulin accumulated by hour, plus the scheduled-basal baseline the
   *  xtra-insulin and observed-ratio figures are measured against. */
  insulinLedger: DataResult<InsulinLedger>;
  activitySummary: DataResult<ActivitySummary>;
  /** Closed-loop vs manual time + override outcomes. Computed from Loop's
   *  Nightscout telemetry; HealthKit has no equivalent signal. */
  loopMode: DataResult<LoopModeSummary>;
  /** Fasting-window drift + scheduled-vs-delivered basal. */
  basalInsights: DataResult<BasalInsights>;
  /** Short-window insulin sensitivity ratio. Context, never a lever. */
  autosens: DataResult<Autosens>;
  /** Multi-week retrospective read of basal, ISF and carb ratio. */
  autotune: DataResult<AutotuneResult>;
  /** Observed carb absorption per preset and per food, with export. */
  absorptionInsights: DataResult<AbsorptionInsights>;
  /** One confidence-graded row for every setting Loop's UI exposes. */
  settingsReview: DataResult<SettingsReview>;
  /** Recurring low/high stretches by weekday and hour — what alerts fire on. */
  riskWindows: DataResult<RiskWindow[]>;
  /**
   * The full weekday × hour picture: what each day of the week usually does,
   * hour by hour, with exercise and carbs alongside. riskWindows is the subset
   * of this that crossed an alerting threshold; this is the whole shape,
   * including the hours that are fine.
   */
  dayHourGrid: DataResult<DayHourGrid>;
  /** Average glucose, IOB and COB for each weekday hour over the last 12 weeks. */
  weekdayHourly: DataResult<WeekdayHourly>;
  /**
   * Usual exercise for each weekday hour, the same twelve weeks. Its own field
   * because activity is Apple Health's to own: the combined source takes
   * weekdayHourly from Nightscout and this from Apple Health.
   */
  weekdayExercise: DataResult<WeekdayExercise>;
  // ---- Clinician metrics ----
  // Computed from the long raw reads inside the source, because the snapshot's
  // raw streams are too short for them (HealthKit's recentGlucose is 8 hours).
  // Glucose-only views are keyed by clinic-report period.
  /** Hypoglycaemia events (15+ min below low / urgent low) and overnight TBR. */
  hypoEvents: DataResult<Record<GlucoseWindow, HypoReport>>;
  /** AGP percentile curve and CGM wear. */
  agp: DataResult<Record<GlucoseWindow, AgpProfile>>;
  /** Breakfast / lunch / dinner panels over the source's meal window. */
  mealPanels: DataResult<MealPanels>;
  /** Clean correction boluses, observed vs ISF-predicted change. */
  correctionOutcomes: DataResult<CorrectionOutcomes>;
  /** Time at max basal and zero temps. Empty where the source has no temps. */
  tempBasalUse: DataResult<TempBasalUse>;
};

/** Subscribe callback — invoked any time the snapshot changes. */
export type DataSubscriber = () => void;

/** Public surface every data source must implement. */
export interface DataSource {
  readonly kind: DataSourceKind;
  /** Human label shown in the source picker. */
  readonly displayName: string;
  /** Read the current snapshot synchronously. */
  getSnapshot(): DataSnapshot;
  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(cb: DataSubscriber): () => void;
  /** Trigger a background refresh; resolves when complete (or errored). */
  refresh(): Promise<void>;
  /** Optional teardown — close streams, clear timers. */
  dispose?(): void;
}

/** Convenience: an empty result for "no data yet, not loading." */
export function emptyResult<T>(): DataResult<T> {
  return {
    data: null,
    loading: false,
    error: null,
    lastUpdatedIso: null,
    isStale: false,
  };
}

/** Convenience: a populated result with no error and not stale. */
export function freshResult<T>(
  data: T,
  lastUpdatedIso: string | null,
  origin: DataOrigin = 'sample',
): DataResult<T> {
  return {
    data,
    loading: false,
    error: null,
    lastUpdatedIso,
    isStale: false,
    origin,
  };
}
