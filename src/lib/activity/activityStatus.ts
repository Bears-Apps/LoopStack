// Activity classifier.
//
// Pure function: takes raw HealthKit reads (workouts, heart-rate samples,
// resting HR) and returns a structured ActivityStatus describing what the
// user has been doing and how that may affect insulin sensitivity in the
// near term.
//
// Conservative-by-design:
//   • All advisory copy is phrased as may/consider/possible — never imperative.
//   • The isfModifier is a *suggestion* the strategy engine reads through
//     `profile.fitness.isfMultiplier`. The classifier never claims a dosing
//     change; it offers a sensitivity hint.
//   • Confidence drops sharply for HR-only "suspected" activity since stress,
//     caffeine, and illness can mimic the same signal.
//
// Adopted from the handoff starter package with two fixes:
//   1. `active_now` is now actually emitted (was declared, never returned).
//   2. `overnight_low_risk` is now actually emitted when cardio coincides
//      with the typical 18:00–02:00 bedtime window.

import type {
  HeartRateSample,
  WorkoutEntry,
  WorkoutType,
} from '@/data/sources/types';

export type ActivityState =
  | 'none'
  | 'active_now'
  | 'recent_cardio'
  | 'recent_endurance'
  | 'recent_strength'
  | 'recent_hiit'
  | 'suspected_activity'
  | 'overnight_low_risk';

export type HRWindow = {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  averageBpm: number;
  peakBpm: number;
  reason: string;
};

export type ActivityStatus = {
  /** Workouts logged in the last 24h, ordered ascending by endTime. */
  confirmed: WorkoutEntry[];
  /** Sustained HR-elevated windows that don't overlap a logged workout. */
  suspected: HRWindow[];
  state: ActivityState;
  /** Suggested multiplier on insulin sensitivity (1 = no change, <1 = more
   *  sensitive). Read by the strategy engine through profile.fitness.isfMultiplier. */
  isfModifier: number;
  /** 0–1 self-assessed confidence in the classification. */
  confidence: number;
  /** Short user-facing line. Always conservative phrasing. */
  advisory: string;
  /** Machine-readable flags downstream code can branch on. */
  strategyFlags: string[];
};

type ClassifyActivityInput = {
  workouts: WorkoutEntry[];
  heartRateSamples: HeartRateSample[];
  restingHeartRate?: number | null;
  /** Optional override for "now" — useful for tests + deterministic snapshots. */
  currentTime?: string;
};

// ── Tunable constants ────────────────────────────────────────────────────────
const RECENT_WORKOUT_LOOKBACK_HOURS = 24;
const ACTIVE_NOW_TOLERANCE_MIN = 5;
const RECENT_CARDIO_WINDOW_MIN = 30;
const RECENT_TYPE_WINDOW_MIN = 6 * 60;
const HR_MIN_WINDOW_MIN = 10;
const HR_DEFAULT_THRESHOLD_BPM = 120;
const HR_OFFSET_OVER_RESTING_BPM = 25;
// Hours of the day (local) considered "around bedtime" for overnight-low risk.
// Hardcoded for now; should pull from profile preferences in a future pass.
const BEDTIME_START_HOUR = 18;
const BEDTIME_END_HOUR = 2; // exclusive; wraps midnight

// ── Helpers ──────────────────────────────────────────────────────────────────

function minutesAgo(timestamp: string, now: Date): number {
  return Math.round((now.getTime() - new Date(timestamp).getTime()) / 60_000);
}

function isCardioLike(type: WorkoutType): boolean {
  return type === 'running' || type === 'walking' || type === 'cycling' || type === 'swimming' || type === 'cardio';
}

function isInProgress(workout: WorkoutEntry, now: Date): boolean {
  // endedAgo is negative when endTime is in the future (workout still active).
  // Tolerate small clock drift / ~5 min "still warm" tail.
  const endedAgo = minutesAgo(workout.endTime, now);
  return endedAgo <= ACTIVE_NOW_TOLERANCE_MIN;
}

function isWithinBedtimeWindow(now: Date): boolean {
  const hour = now.getHours();
  // Window wraps midnight: hour >= 18 OR hour < 2
  return hour >= BEDTIME_START_HOUR || hour < BEDTIME_END_HOUR;
}

/** Detect contiguous HR-elevated windows >= HR_MIN_WINDOW_MIN. */
function findSuspectedHRWindows(
  samples: HeartRateSample[],
  restingHeartRate?: number | null,
): HRWindow[] {
  if (!samples.length) return [];

  const threshold = restingHeartRate
    ? restingHeartRate + HR_OFFSET_OVER_RESTING_BPM
    : HR_DEFAULT_THRESHOLD_BPM;

  const sorted = [...samples].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const windows: HRWindow[] = [];
  let active: HeartRateSample[] = [];

  for (const sample of sorted) {
    const qualifies = sample.bpm >= threshold || sample.bpm >= HR_DEFAULT_THRESHOLD_BPM;
    if (qualifies) {
      active.push(sample);
    } else {
      maybePushWindow(active, windows);
      active = [];
    }
  }
  maybePushWindow(active, windows);
  return windows;
}

function maybePushWindow(samples: HeartRateSample[], windows: HRWindow[]): void {
  if (samples.length < 2) return;

  const start = samples[0];
  const end = samples[samples.length - 1];
  const durationMinutes = Math.round(
    (new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime()) /
      60_000,
  );
  if (durationMinutes < HR_MIN_WINDOW_MIN) return;

  const bpms = samples.map((s) => s.bpm);
  const averageBpm = Math.round(bpms.reduce((sum, b) => sum + b, 0) / bpms.length);

  windows.push({
    startTime: start.timestamp,
    endTime: end.timestamp,
    durationMinutes,
    averageBpm,
    peakBpm: Math.max(...bpms),
    reason: 'Sustained elevated heart rate without a matching logged workout.',
  });
}

/** Filter out HR windows that overlap a logged workout. */
function dropOverlappingWithWorkouts(
  hrWindows: HRWindow[],
  workouts: WorkoutEntry[],
): HRWindow[] {
  if (hrWindows.length === 0 || workouts.length === 0) return hrWindows;
  const ranges = workouts.map((w) => ({
    start: new Date(w.startTime).getTime(),
    end: new Date(w.endTime).getTime(),
  }));
  return hrWindows.filter((win) => {
    const ws = new Date(win.startTime).getTime();
    const we = new Date(win.endTime).getTime();
    return !ranges.some((r) => ws < r.end && we > r.start);
  });
}

// ── Main classifier ──────────────────────────────────────────────────────────

export function classifyActivity(input: ClassifyActivityInput): ActivityStatus {
  const now = new Date(input.currentTime ?? new Date().toISOString());

  const recentWorkouts = input.workouts
    .filter((w) => {
      // Include in-progress (negative endedAgo) AND ended within last 24h.
      const endedAgo = minutesAgo(w.endTime, now);
      return endedAgo <= RECENT_WORKOUT_LOOKBACK_HOURS * 60;
    })
    .sort(
      (a, b) =>
        new Date(a.endTime).getTime() - new Date(b.endTime).getTime(),
    );

  const suspectedAll = findSuspectedHRWindows(
    input.heartRateSamples,
    input.restingHeartRate,
  );
  const suspected = dropOverlappingWithWorkouts(suspectedAll, recentWorkouts);

  // Pre-compute candidates by type/recency.
  const inProgressCardio = recentWorkouts.find(
    (w) => isCardioLike(w.type) && isInProgress(w, now),
  );
  const recentCardio = recentWorkouts.find(
    (w) =>
      isCardioLike(w.type) && minutesAgo(w.endTime, now) <= RECENT_CARDIO_WINDOW_MIN,
  );
  const recentEndurance = recentWorkouts.find(
    (w) =>
      isCardioLike(w.type) && minutesAgo(w.endTime, now) <= RECENT_TYPE_WINDOW_MIN,
  );
  const recentStrength = recentWorkouts.find(
    (w) => w.type === 'strength' && minutesAgo(w.endTime, now) <= RECENT_TYPE_WINDOW_MIN,
  );
  const recentHiit = recentWorkouts.find(
    (w) => w.type === 'hiit' && minutesAgo(w.endTime, now) <= RECENT_TYPE_WINDOW_MIN,
  );

  // 1. Active right now — strongest signal, takes priority.
  if (inProgressCardio) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'active_now',
      isfModifier: 0.85,
      confidence: 0.85,
      advisory:
        'Cardio appears to be active or just-finished. Sensitivity may be elevated for the next several hours.',
      strategyFlags: [
        'sensitivity_may_be_elevated',
        'hold_pre_bolus',
        'watch_late_drop',
      ],
    };
  }

  // 2. Overnight-low risk — cardio/endurance/HIIT in last 6h AND late local hour.
  const overnightCandidate = recentCardio ?? recentEndurance ?? recentHiit;
  if (overnightCandidate && isWithinBedtimeWindow(now)) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'overnight_low_risk',
      isfModifier: 0.88,
      confidence: 0.72,
      advisory:
        'Recent activity falls within typical evening hours. Overnight glucose may run lower than usual — worth keeping an eye on.',
      strategyFlags: [
        'sensitivity_may_be_elevated',
        'overnight_low_risk',
        'watch_late_drop',
      ],
    };
  }

  // 3. Recent cardio (≤30 min post).
  if (recentCardio) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_cardio',
      isfModifier: 0.9,
      confidence: 0.8,
      advisory:
        'Recent cardio may increase insulin sensitivity during this meal window.',
      strategyFlags: ['sensitivity_may_be_elevated', 'watch_late_drop'],
    };
  }

  // 4. Recent HIIT.
  if (recentHiit) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_hiit',
      isfModifier: 0.95,
      confidence: 0.75,
      advisory:
        'Recent high-intensity activity may cause an early rise followed by later sensitivity.',
      strategyFlags: ['possible_early_rise', 'watch_late_drop'],
    };
  }

  // 5. Recent strength.
  if (recentStrength) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_strength',
      isfModifier: 0.95,
      confidence: 0.7,
      advisory:
        'Recent strength training may affect glucose differently during the next several hours.',
      strategyFlags: ['activity_context_present', 'watch_delayed_sensitivity'],
    };
  }

  // 6. Recent endurance (cardio-like in last 6h, not within last 30 min).
  if (recentEndurance) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_endurance',
      isfModifier: 0.9,
      confidence: 0.75,
      advisory:
        'Recent endurance activity may increase sensitivity during this meal window.',
      strategyFlags: ['sensitivity_may_be_elevated'],
    };
  }

  // 7. Suspected (HR-only, no logged workout).
  if (suspected.length > 0) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'suspected_activity',
      isfModifier: 0.97,
      confidence: 0.45,
      advisory:
        'Elevated heart rate was detected without a logged workout. This may reflect activity, stress, caffeine, or another factor.',
      strategyFlags: ['lower_confidence', 'possible_activity_context'],
    };
  }

  // 8. Nothing.
  return {
    confirmed: recentWorkouts,
    suspected: [],
    state: 'none',
    isfModifier: 1,
    confidence: 0.85,
    advisory: 'No recent activity signal detected.',
    strategyFlags: [],
  };
}
