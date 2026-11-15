import type { InsulinNeedPattern } from '@/lib/metabolism/insulinNeeded';
import type { MealBolusDelivery } from '@/lib/metabolism/mealBolus';
export type DietPattern =
  | 'none'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'keto'
  | 'low_carb'
  | 'mediterranean';

export type FatSensitivity = 'low' | 'moderate' | 'high';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

// Numeric 0-100 confidence expressed as: evidence strength × consistency × recency.
// When present on a signal, the UI renders a ring in place of the L/M/H label.
export type ConfidenceScore = number;

export type FoodFrequency = 'rarely' | 'sometimes' | 'often';

// Categories chosen from the glycemic-impact research:
//  - wholePlantFoods  → raises sensitivity baseline (fiber, viscous fiber, intact starch)
//  - refinedCarbs     → spike-prone, lowers sensitivity baseline
//  - saturatedFats    → lowers sensitivity baseline (red meat, full-fat dairy, fried)
//  - unsaturatedFats  → neutral-positive (olive oil, nuts, avocado, fish)
//  - acidsFermented   → buffers the early rise (vinegar, pickled, kimchi)
export type FoodCategoryMix = {
  wholePlantFoods: FoodFrequency;
  refinedCarbs: FoodFrequency;
  saturatedFats: FoodFrequency;
  unsaturatedFats: FoodFrequency;
  acidsFermented: FoodFrequency;
};

export type DietConsistency = 'consistent' | 'weekend_shift' | 'highly_variable';

export type WeekendShift =
  | 'more_eating_out'
  | 'higher_fat'
  | 'higher_carb'
  | 'more_refined'
  | 'more_alcohol'
  | 'later_eating';

export type DietVariance = {
  consistency: DietConsistency;
  weekendShifts: WeekendShift[];
};

export type DietaryPreferences = {
  pattern: DietPattern;
  fatSensitivity: FatSensitivity;
  observesProteinImpact: boolean;
  foodMix: FoodCategoryMix;
  variance: DietVariance;
};

export type HealthConnection = {
  id: 'apple_health' | 'dexcom' | 'loop' | 'nightscout';
  label: string;
  connected: boolean;
  lastSync?: string;
};

export type FitnessTrend = {
  // A fitness percentile shift over the last 14 days; negative = less fit, positive = more fit.
  // Drives an ISF multiplier: higher fitness → more sensitive → smaller ISF.
  delta14d: number;
  isfMultiplier: number; // e.g. 0.92 means reduce insulin ~8%
  summary: string;
  source: 'apple_health' | 'manual';
  confidence: ConfidenceLevel;
};

export type TrendDirection = 'up' | 'down' | 'steady';

export type TargetMetric = {
  trend: TrendDirection;
  confidence: ConfidenceLevel;
  confidenceScore?: ConfidenceScore;
  evidenceCount: number;
  lastUpdatedIso: string;
};

export type ClinicalSettings = {
  /** Below this is "urgent low". Consensus AGP uses 54; personal settings may
   *  differ — a value you treat differently deserves its own band. */
  urgentLowMgdl: number;
  targetLowMgdl: number;
  targetHighMgdl: number;
  baseIsf: number;       // mg/dL per 1U
  observedIsf: number;   // derived from data
  carbRatio: number;     // g per 1U
  insulinDurationHours: number;
  observedIsfMeta?: TargetMetric;
};

export type InsulinStrategyPrefs = {
  defaultUpfrontPct: number;       // 0-100
  defaultExtendedHours: number;
  showSplitSuggestions: boolean;
};

// ---- Foundations ----
// Slow-changing context about the person — drives confidence baselines and
// default cadence for suggestions (e.g. shift workers need routine-aware tuning).
export type AgeRange = '18-29' | '30-44' | '45-59' | '60+';
export type TypicalRoutine =
  | 'regular_hours'
  | 'shift_work'
  | 'flexible'
  | 'athlete';

export type UserProfile = {
  id: string;
  displayName: string;
  diagnosedOn: string;              // ISO date
  diabetesType: 't1' | 't2' | 'lada';
  ageRange: AgeRange;
  typicalRoutine: TypicalRoutine;
  dietary: DietaryPreferences;
  connections: HealthConnection[];
  fitness: FitnessTrend | null;
  clinical: ClinicalSettings;
  strategyPrefs: InsulinStrategyPrefs;
};

// ---- Suggested Loop input ----

export type InsulinSplitSegment = {
  hourFromMealStart: number;   // 0, 1, 2, ...
  percent: number;             // 0-100
  units: number;               // computed
};

export type SuggestedInsulinStrategy = {
  id: string;
  mealMemoryId?: string;
  mealTitle: string;
  carbs: number;
  totalUnits: number;
  upfrontPct: number;
  upfrontUnits: number;
  extendedPct: number;
  extendedHours: number;
  extendedSplit: InsulinSplitSegment[];   // one entry per hour of extended portion
  absorptionHours: number;
  /** Minutes to dose before the meal, from the pre-bolus lever. 0 = at meal. */
  preBolusMinutes: number;
  reasoning: string[];                     // bullets — evidence-phrased
  confidence: ConfidenceLevel;
  /** The engine's own 0–100 score, capped at MAX_CONFIDENCE. Carried so the
   *  ring shows what was computed rather than the level's default. */
  confidenceScore?: ConfidenceScore;
  evidenceCount: number;
  adjustmentsApplied: StrategyAdjustment[]; // what moved the numbers from defaults
  /** The extended portion re-expressed as a temp basal. Null when the meal is
   *  dosed entirely upfront, or when no scheduled basal rate was available to
   *  add it to (an absolute rate is meaningless without one). */
  tempBasal: TempBasalSuggestion | null;
  /** Where the numbers got their evidence, and whether that evidence is real. */
  evidence: StrategyEvidence;
  /** Insulin already working when this was computed. Null when Loop's IOB was
   *  not available — a zero would read as "nothing on board", which is a
   *  different claim from "we could not see". */
  insulinOnBoard: InsulinOnBoardBreakdown | null;
  /**
   * The bolus already delivered for THIS meal, when one is visible.
   *
   * Distinct from insulinOnBoard, which answers "how much less is needed".
   * This answers "has the first delivery already happened" — which changes
   * what the screen should SAY rather than what it should compute. When it
   * covers the up-front portion the sheet must stop presenting that portion
   * as something to do.
   */
  mealBolusGiven: MealBolusDelivery | null;
};

/** How insulin already on board was applied against a meal's dose. */
export type InsulinOnBoardBreakdown = {
  /** 'loop' when Loop published the figure itself; 'reconstructed' when this
   *  app rebuilt it from the insulin history. The two are usually close, and
   *  saying which is which is the difference between a fact and an estimate. */
  source: 'loop' | 'reconstructed';
  /** Units on board, per Loop. */
  onBoardU: number;
  /** Of those, the units already spoken for by other carbs still absorbing. */
  coveringCarbsU: number;
  /** Units of the on-board insulin credited against THIS meal. */
  creditedU: number;
  /** What the meal would have called for with nothing on board. */
  beforeCreditU: number;
};

// ---- Temp basal ----
// The extended portion of a meal dose, expressed the way Loop takes it: an
// absolute rate held for a fixed stretch. Loop's temp basal field is absolute
// U/hr, not a percentage, so the suggestion is stated in the same units the
// user is going to type — a percentage would need mental arithmetic against a
// schedule that changes through the day, which is exactly where mistakes live.
export type TempBasalSuggestion = {
  /** Absolute rate to set, U/hr. Already includes the scheduled rate underneath. */
  rateUPerHr: number;
  /** The scheduled rate this is sitting on top of, U/hr. */
  scheduledRateUPerHr: number;
  /** Extra insulin above schedule, U/hr — rate − scheduledRate. */
  aboveScheduleUPerHr: number;
  durationMinutes: number;
  /** Total extra units the temp basal delivers over its duration. */
  deliveredUnits: number;
  /** True when maxBasalRate clipped the rate, so the tail under-delivers. */
  clampedByMaxBasal: boolean;
  /** Units that could not be delivered inside the duration because of the clamp. */
  undeliveredUnits: number;
};

// ---- Strategy evidence ----
// Every number in a strategy is either measured from this user's own history or
// derived from their settings. Those are very different claims and the panel is
// required to distinguish them: "your last four of these ran low" earns a dose
// change, "here is carbs ÷ ratio" does not.
export type StrategyEvidence = {
  basis: 'exact_name' | 'absorption_profile' | 'none';
  /** Occurrences behind the basis. 0 for a settings-only suggestion. */
  occurrences: number;
  /** True when the numbers come from defaults with no outcome history to back
   *  them. The UI must label these as unproven rather than presenting them
   *  with the same weight as a learned suggestion. */
  unproven: boolean;
  /** Plain-English source line, e.g. "4 past servings of Chicken burrito". */
  label: string;
};

// ---- Per-meal levers ----
// Quick controls that tune THIS meal's strategy without rebuilding it. They
// move the split and the timing, never the dose size (that stays carbs ÷ ratio).
export type SplitBias = 'standard' | 'more_upfront' | 'more_extended';

export type MealLevers = {
  splitBias: SplitBias;
  /** Lead time before the meal to take the upfront dose. */
  preBolusMinutes: 0 | 15 | 20;
};

export const DEFAULT_MEAL_LEVERS: MealLevers = {
  splitBias: 'standard',
  preBolusMinutes: 0,
};

export type StrategyAdjustment = {
  label: string;                // e.g. "High fat content"
  effect: string;               // e.g. "Shifted 10% toward extended"
  source: 'dietary' | 'fitness' | 'pattern' | 'time_of_day';
};

// ---- Loop settings uploads + suggestions ----

export type LoopSettingsUploadKind =
  | 'therapy_settings'      // ISF, carb ratio, target range screenshot
  | 'carb_absorption_model' // absorption curve / default absorption time
  | 'favorite_meal'         // favorite food entry screenshot
  | 'full_picture';         // 6-8h meal outcome screenshot (meal + curve)

export type LoopSettingsUpload = {
  id: string;
  kind: LoopSettingsUploadKind;
  capturedAt: string;       // ISO
  label?: string;           // e.g. "Chicken bowl · 2026-04-14"
  previewUri?: string;      // optional thumbnail
  note?: string;
};

export type LoopSuggestionKind =
  | 'absorption_model'      // tweak carb absorption curve / default time
  | 'favorite_carbs'        // adjust carb estimate on a saved favorite
  | 'base_setting';         // adjust ISF, carb ratio, or target range

// Category lets Insights group suggestions by the kind of change they imply,
// rather than by the underlying Loop setting.
export type SuggestionCategory =
  | 'sensitivity'     // ISF / fitness-driven dosing sensitivity
  | 'timing'          // absorption curves, upfront/extended split
  | 'meal_behavior'   // favorite carbs, meal-specific patterns
  | 'system';         // settings integrity, data gaps, global cadence

export type LoopSuggestionGateKind =
  | 'full_picture_count'    // needs N full-picture uploads to unlock
  | 'favorite_occurrences'  // needs N occurrences of a favorite to unlock
  | 'pattern_confidence';   // needs pattern confidence threshold to unlock

export type LoopSuggestionGate = {
  kind: LoopSuggestionGateKind;
  needed: number;
  have: number;
};

// Where a suggestion's signal is coming from — lets the UI show the
// "cause-effect" trail back to the user's profile / data inputs.
export type SuggestionDriverSource = 'dietary' | 'clinical' | 'fitness' | 'patterns';

export type SuggestionDriver = {
  source: SuggestionDriverSource;
  label: string;     // e.g. "Fat sensitivity: high"
  field?: string;    // optional pointer to the profile field (for future deep-linking)
  evidence?: DriverEvidence; // when present, the chip is tap-to-expand
};

// Evidence detail behind a single driver chip. Surfaces *why* this signal feeds
// the suggestion — the origin, the observation window, how consistent the
// signal has been, and a one-line "why it matters" framing. Any field can be
// omitted; the component only renders the rows that are present.
export type DriverEvidence = {
  origin: string;             // e.g. "From your dietary profile"
  windowDays?: number;        // e.g. 30
  observationCount?: number;  // e.g. 9 (meals / readings / occurrences)
  observationLabel?: string;  // unit for observationCount, e.g. "meals"
  consistencyPct?: number;    // 0-100, how often the signal held in window
  consistencyLabel?: string;  // e.g. "biphasic curves" — context for consistency
  strengthLine: string;       // one short sentence: how this drives the suggestion
  profileLink?: { to: string; label: string }; // optional deep-link
};

// Distinguishes a suggestion backed by *measured* data (carries a confidence
// score + can be implemented) from a *derived context* signal that reflects the
// user's background diet pattern. Context items are shown without a confidence
// ring and are never directly implementable — they inform, they don't prescribe.
// Absent = 'observed' for backwards compatibility with existing pattern data.
export type SuggestionEvidenceBasis = 'observed' | 'context';

export type LoopSuggestion = {
  id: string;
  kind: LoopSuggestionKind;
  category?: SuggestionCategory;  // Insights-screen grouping
  title: string;                  // short headline
  body: string;                   // 1-2 sentence explanation
  evidenceCount: number;          // how many data points back this up
  confidence: ConfidenceLevel;
  confidenceScore?: ConfidenceScore; // 0-100 numeric, drives ring + CTA threshold
  evidenceBasis?: SuggestionEvidenceBasis; // 'context' = unscored background signal
  gate: LoopSuggestionGate | null; // null = ready to review, truthy = still locked
  proposedChange: string;         // human copy, e.g. "Shorten default absorption to 4h"
  rationale: string[];            // evidence-phrased bullets
  drivers?: SuggestionDriver[];   // profile/data inputs that produced this suggestion
};

export type LoopSettingsState = {
  uploads: LoopSettingsUpload[];
  suggestions: LoopSuggestion[];
};

// ---- Meal Memory (Memories screen) ----
// An archetype describes the *shape* of the glucose response, independent of
// which specific food triggered it. Used to cluster meals that behave alike.
export type MealArchetype =
  | 'fast_spike'     // sharp early rise, short tail
  | 'flattened'      // modest rise, low peak — the "ideal" curve
  | 'delayed'        // late rise, peaks after upfront insulin wanes
  | 'biphasic'       // double hump (carb-then-fat/protein)
  | 'stable';        // minimal excursion

export type MealMemoryPattern = {
  id: string;
  label: string;                // e.g. "Late pasta nights"
  archetype: MealArchetype;
  occurrenceCount: number;      // how many meals cluster into this pattern
  windowDays: number;           // observation window (e.g. last 30 days)
  summary: string;              // one-sentence plain-English description
  suggestedStrategyId?: string; // optional pointer to a SuggestedInsulinStrategy
  drivers?: SuggestionDriver[]; // what profile/data inputs shaped this pattern
  confidence: ConfidenceLevel;
  confidenceScore?: ConfidenceScore;
};

// ---- Metrics dashboard (Trends home) ----
// The glanceable daily + long-term view. Combines glucose control, therapy, and
// lifestyle metrics the way a "cockpit" dashboard does, all range-selectable.
export type MetricsRange = 'today' | '3d' | '7d' | '14d' | '30d' | '90d' | '180d';

// 5-band time-in-range distribution (percentages, sum to 100).
export type TimeInRangeBands = {
  veryLow: number;   // <54 mg/dL
  low: number;       // 54–70
  inRange: number;   // 70–180
  high: number;      // 180–250
  veryHigh: number;  // >250
};

// A signed change vs the prior equal-length period, with whether that move is
// good/bad/neutral for the metric (so the UI colors it without re-deriving).
export type MetricDelta = {
  value: number;                          // signed delta in the metric's unit
  direction: 'good' | 'bad' | 'neutral';
};

export type GlucoseMetrics = {
  range: MetricsRange;
  /** In-range boundaries these bands were scored against — the user's target
   *  from Profile → Targets, or consensus 70–180 when unset. */
  targetLowMgdl: number;
  targetHighMgdl: number;
  /** Urgent-low boundary these bands used. */
  urgentLowMgdl: number;
  daysInWindow: number;
  /**
   * Days the window actually contains readings for. Diverges from
   * daysInWindow whenever the fetch is shorter than the selection (a 180-day
   * view over 90 days of history), which the UI must disclose rather than
   * present 90 days of data under a 180-day label.
   */
  daysCovered: number;
  /** True when the preceding window had readings, so deltas mean something. */
  hasPriorWindow: boolean;
  // glucose control
  avgGlucose: number;        // mg/dL
  gmi: number;               // estimated A1c, %
  cv: number;                // coefficient of variation, %
  sd: number;                // standard deviation, mg/dL
  tir: TimeInRangeBands;
  // therapy (per-day averages for multi-day ranges, totals for "today")
  totalInsulin: number;      // U
  basalInsulin: number;
  /** True when basalInsulin came from the Loop schedule, not delivery data. */
  basalIsScheduled?: boolean;      // U
  bolusInsulin: number;      // U
  carbs: number;             // g
  // lifestyle (Apple Health)
  steps: number;
  exerciseMinutes: number;
  sleepHours: number;
  // deltas vs prior equal-length window
  deltas: {
    avgGlucose: MetricDelta;
    inRange: MetricDelta;
    gmi: MetricDelta;
    cv: MetricDelta;
    totalInsulin: MetricDelta;
  };
};

// ---- Favorite Meal Memory (Pool 01) ----
// A per-favorite report card. Clusters every logged occurrence of a saved Loop
// favorite (carb entry + bolus + absorption time) with the CGM outcome that
// followed, and answers three questions directly: how much insulin, over what
// duration, and did the last one run over or under.
export type MealOutcomeVerdict = 'too_much' | 'too_little' | 'on_target' | 'mixed';

// The concrete Loop change a favorite's data points to — the whole reason the
// pool exists. null when the signal isn't strong enough to recommend anything.
export type FavoriteHandoff = {
  kind: 'favorite_carbs' | 'absorption_window';
  label: string;         // e.g. "Tofu rice bowl carbs"
  currentValue: string;  // "55g"
  proposedValue: string; // "50g"
  rationale: string[];
};

export type FavoriteMealMemory = {
  id: string;
  favoriteName: string;              // the saved Loop favorite's name
  archetype: MealArchetype;          // observed glucose shape
  occurrenceCount: number;
  windowDays: number;
  // Observed dose + timing, averaged across occurrences.
  avgUnits: number;                  // avg total insulin per occurrence
  avgCarbs: number;                  // avg carbs actually logged
  storedCarbs: number;               // what the Loop favorite currently stores
  observedAbsorptionHours: number;   // measured absorption tail
  storedAbsorptionHours: number;     // the favorite's set absorption time
  // Outcome distribution across the occurrences in-window.
  outcomes: { inRange: number; low: number; high: number };
  // The most recent occurrence — powers the "last time…" verdict line.
  last: {
    dateIso: string;
    verdict: MealOutcomeVerdict;
    note: string;                    // plain-English, e.g. "ran low after hour 4"
  };
  confidence: ConfidenceLevel;
  confidenceScore?: ConfidenceScore;
  handoff: FavoriteHandoff | null;   // the Loop setting this points at
  drivers?: SuggestionDriver[];
  /**
   * What these servings turned out to need, versus what was given.
   *
   * Answers "I gave 2.4U and went low — what would have held the line?" across
   * repeats, and says whether the lows are early (a split problem) or late (a
   * dose problem), because those want opposite responses.
   */
  insulinNeed?: InsulinNeedPattern;
};

// ---- Fix Log ----
// A staging layer between "LoopStack noticed something" and "I changed Loop."
// Items live here while the user reviews the proposed change; only once they
// tap "Implement in Loop" does it move to the (future) Commit Log.
export type FixLogSourceKind = 'insight' | 'memory' | 'manual';

export type FixLogChangeKind =
  | 'isf'
  | 'carb_ratio'
  | 'absorption_window'
  | 'favorite_carbs'
  | 'schedule_override'
  | 'timing_split';

export type FixLogChange = {
  kind: FixLogChangeKind;
  label: string;        // "ISF", "Chicken bowl carbs", etc.
  currentValue: string; // "50 mg/dL per 1U"
  proposedValue: string;
};

export type FixLogStatus = 'staged' | 'implemented' | 'reverted';

export type FixLogItem = {
  id: string;
  title: string;                 // short headline, mirrors insight title
  source: FixLogSourceKind;
  sourceId?: string;             // insight id / memory id / null for manual
  createdIso: string;
  confidence: ConfidenceLevel;
  confidenceScore?: ConfidenceScore;
  change: FixLogChange;
  explanation: string;           // Claude-ready prose, shown as "Why this?"
  rationale: string[];           // bullet list of evidence
  status: FixLogStatus;
};

// ---- Commit Log ----
// The Git-analogy receipt: every Fix Log item the user chooses to Implement in
// Loop lands here as an immutable-ish entry, with a short hash, timestamp, and
// 14-day outcome tracking. Reverting a commit stages the reverse change back
// into Fix Log and marks the commit as reverted — but the original line stays
// visible in the history.
export type CommitOutcomeStatus =
  | 'tracking'   // within the 14-day observation window
  | 'positive'   // metrics improved after the window
  | 'neutral'    // no meaningful delta
  | 'negative'   // metrics worsened
  | 'reverted';  // user rolled the change back

export type CommitOutcome = {
  status: CommitOutcomeStatus;
  daysElapsed: number;         // since committedIso
  trackingWindowDays: number;  // typically 14
  tirDeltaPct?: number;        // +3.2 = +3.2% time in range vs prior window
  hypoEventsDelta?: number;    // negative = fewer hypos, positive = more
  summary: string;             // one short human line
};

export type CommitLogItem = {
  id: string;
  shortHash: string;           // 6-char display hash, e.g. "c7a9f2"
  fixLogId: string;            // the Fix Log item this came from
  committedIso: string;
  title: string;
  source: FixLogSourceKind;
  confidence: ConfidenceLevel;
  confidenceScore?: ConfidenceScore;
  change: FixLogChange;
  explanation: string;
  rationale: string[];
  outcome: CommitOutcome;
};
