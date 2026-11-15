import type {
  GlucoseReading,
  HeartRateSample,
  WorkoutEntry,
} from '@/data/sources/types';

// Unified activity-event stream.
//
// Exercise isn't just recorded workouts: brisk walking without a logged
// workout and sustained heart-rate elevation both move glucose. This module
// merges three signals into one deduplicated event stream —
//   • workout    — logged in HealthKit (confirmed, weight 1.0)
//   • hr_elevated — sustained HR above resting+25 or >120 bpm (suspected, 0.6)
//   • step_burst — ≥1500 steps in an hour with no overlapping event (0.5)
// — then measures the glucose response after each event so "activity lowers
// my glucose" becomes a measured personal number, not folklore.
//
// Every threshold is a first-pass heuristic; tune against real data on-device.

export type ActivityEventKind = 'workout' | 'hr_elevated' | 'step_burst';

export type ActivityEvent = {
  kind: ActivityEventKind;
  startIso: string;
  endIso: string;
  durationMinutes: number;
  /** How much this event counts toward evidence pooling (0–1). */
  confidenceWeight: number;
  label: string;
  /** Glucose response in the RESPONSE_WINDOW after the event ends. */
  response: GlucoseResponse | null;
};

export type GlucoseResponse = {
  baselineMgdl: number;
  nadirMgdl: number;
  dropMgdl: number;          // baseline − nadir (positive = fell)
  minutesToNadir: number;    // from event end
};

export type ActivitySummary = {
  events: ActivityEvent[];
  /** Deduplicated active minutes across all three signals. */
  compositeExerciseMinutes: number;
  /** Workout records dropped as duplicates of another record. Apple Health
   *  keeps one entry per app that wrote the activity, so a single run logged
   *  by both the Watch and a running app arrives twice. */
  duplicateWorkoutsDropped: number;
  workoutMinutes: number;
  hrElevatedMinutes: number;
  stepBurstMinutes: number;
  /** Confidence-weighted average glucose drop after activity; null until
   *  at least one event has a measurable response. */
  avgDropMgdl: number | null;
  avgMinutesToNadir: number | null;
  respondedEventCount: number;
  windowHours: number;
};

export type HourlySteps = { hourIso: string; steps: number };

const HR_OVER_RESTING_BPM = 25;
const HR_ABSOLUTE_BPM = 120;
const HR_MIN_WINDOW_MIN = 10;
// A gap this long between qualifying samples ends the window — HR sampling is
// sparse outside workouts, so two separate exertions must not merge across a
// quiet gap just because nothing was recorded in between.
const HR_MAX_GAP_MIN = 15;
const STEP_BURST_MIN_STEPS = 1500;
const RESPONSE_WINDOW_MIN = 240;   // watch glucose for 4h after an event
const BASELINE_LOOKBACK_MIN = 30;

/** Share of the shorter workout that must overlap the longer one before the
 *  two are treated as the same activity. High enough that a warm-up walk
 *  running into a run stays two events, low enough that the same run logged
 *  twice with slightly different start times collapses to one. */
const WORKOUT_SAME_ACTIVITY_OVERLAP = 0.5;

const WEIGHT: Record<ActivityEventKind, number> = {
  workout: 1.0,
  hr_elevated: 0.6,
  step_burst: 0.5,
};

function ms(iso: string): number {
  return new Date(iso).getTime();
}

type Interval = { startMs: number; endMs: number };

/**
 * Collapse workout records that describe the same activity.
 *
 * Apple Health stores one record per app that wrote it, so a single run logged
 * by the Watch and by a running app is two entries covering the same minutes.
 * Summing both roughly doubles reported exercise — and because exercise is
 * correlated against glucose here, it also halves the apparent glucose effect
 * per minute of activity.
 *
 * Identity is decided by overlap rather than by source or label: the same run
 * can carry different types and slightly different start times depending on
 * which app wrote it, but it cannot occupy two different stretches of the day.
 * The longest record wins, on the reasoning that a truncated duplicate is the
 * more common failure than an inflated one.
 */
export function dedupeWorkouts(workouts: WorkoutEntry[]): WorkoutEntry[] {
  const sorted = [...workouts]
    .filter((w) => Number.isFinite(ms(w.startTime)) && Number.isFinite(ms(w.endTime)))
    .sort((a, b) => {
      const spanA = ms(a.endTime) - ms(a.startTime);
      const spanB = ms(b.endTime) - ms(b.startTime);
      return spanB - spanA || ms(a.startTime) - ms(b.startTime);
    });

  const kept: WorkoutEntry[] = [];
  for (const w of sorted) {
    const iv = { startMs: ms(w.startTime), endMs: ms(w.endTime) };
    const span = Math.max(1, iv.endMs - iv.startMs);
    const duplicate = kept.some((k) => {
      const kv = { startMs: ms(k.startTime), endMs: ms(k.endTime) };
      const shared = Math.min(iv.endMs, kv.endMs) - Math.max(iv.startMs, kv.startMs);
      if (shared <= 0) return false;
      const shorter = Math.min(span, Math.max(1, kv.endMs - kv.startMs));
      return shared / shorter >= WORKOUT_SAME_ACTIVITY_OVERLAP;
    });
    if (!duplicate) kept.push(w);
  }

  return kept.sort((a, b) => ms(a.startTime) - ms(b.startTime));
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

/** Sustained HR-elevation windows (same thresholds as the advisory classifier). */
function hrWindows(
  samples: HeartRateSample[],
  restingBpm: number | null,
): Interval[] {
  if (samples.length === 0) return [];
  const threshold = restingBpm != null ? restingBpm + HR_OVER_RESTING_BPM : HR_ABSOLUTE_BPM;
  const sorted = [...samples].sort((a, b) => ms(a.timestamp) - ms(b.timestamp));

  const out: Interval[] = [];
  let run: HeartRateSample[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const startMs = ms(run[0].timestamp);
      const endMs = ms(run[run.length - 1].timestamp);
      if ((endMs - startMs) / 60_000 >= HR_MIN_WINDOW_MIN) out.push({ startMs, endMs });
    }
    run = [];
  };
  for (const s of sorted) {
    if (s.bpm >= threshold || s.bpm >= HR_ABSOLUTE_BPM) {
      const prev = run[run.length - 1];
      if (prev && ms(s.timestamp) - ms(prev.timestamp) > HR_MAX_GAP_MIN * 60_000) {
        flush();
      }
      run.push(s);
    } else {
      flush();
    }
  }
  flush();
  return out;
}

function glucoseResponse(
  eventEndMs: number,
  glucose: GlucoseReading[],
): GlucoseResponse | null {
  const pre = glucose
    .filter((g) => {
      const t = ms(g.iso);
      return t <= eventEndMs && t >= eventEndMs - BASELINE_LOOKBACK_MIN * 60_000;
    })
    .sort((a, b) => ms(b.iso) - ms(a.iso));
  const baseline = pre[0]?.mgdl;
  if (baseline == null) return null;

  const post = glucose
    .filter((g) => {
      const t = ms(g.iso);
      return t > eventEndMs && t <= eventEndMs + RESPONSE_WINDOW_MIN * 60_000;
    })
    .sort((a, b) => ms(a.iso) - ms(b.iso));
  if (post.length < 3) return null; // too sparse to call a response

  let nadir = post[0];
  for (const g of post) if (g.mgdl < nadir.mgdl) nadir = g;

  return {
    baselineMgdl: baseline,
    nadirMgdl: nadir.mgdl,
    dropMgdl: baseline - nadir.mgdl,
    minutesToNadir: Math.round((ms(nadir.iso) - eventEndMs) / 60_000),
  };
}

export function computeActivitySummary(input: {
  workouts: WorkoutEntry[];
  heartRate: HeartRateSample[];
  restingBpm: number | null;
  hourlySteps: HourlySteps[];
  glucose: GlucoseReading[];
  windowHours: number;
}): ActivitySummary {
  const events: ActivityEvent[] = [];
  const claimed: Interval[] = [];

  // 1. Workouts claim their windows first — the confirmed signal wins overlaps.
  //    Deduplicated before they claim anything, or the same activity written by
  //    two apps is counted twice over.
  const workouts = dedupeWorkouts(input.workouts);
  const duplicateWorkoutsDropped = input.workouts.length - workouts.length;
  for (const w of workouts) {
    const iv = { startMs: ms(w.startTime), endMs: ms(w.endTime) };
    claimed.push(iv);
    events.push({
      kind: 'workout',
      startIso: w.startTime,
      endIso: w.endTime,
      durationMinutes: w.durationMinutes,
      confidenceWeight: WEIGHT.workout,
      label: w.type,
      response: glucoseResponse(iv.endMs, input.glucose),
    });
  }

  // 2. HR windows that don't overlap a workout.
  for (const iv of hrWindows(input.heartRate, input.restingBpm)) {
    if (claimed.some((c) => overlaps(c, iv))) continue;
    claimed.push(iv);
    events.push({
      kind: 'hr_elevated',
      startIso: new Date(iv.startMs).toISOString(),
      endIso: new Date(iv.endMs).toISOString(),
      durationMinutes: Math.round((iv.endMs - iv.startMs) / 60_000),
      confidenceWeight: WEIGHT.hr_elevated,
      label: 'elevated heart rate',
      response: glucoseResponse(iv.endMs, input.glucose),
    });
  }

  // 3. Step bursts in hours no other event claimed.
  for (const bucket of input.hourlySteps) {
    if (bucket.steps < STEP_BURST_MIN_STEPS) continue;
    const startMs = ms(bucket.hourIso);
    const iv = { startMs, endMs: startMs + 3600_000 };
    if (claimed.some((c) => overlaps(c, iv))) continue;
    claimed.push(iv);
    events.push({
      kind: 'step_burst',
      startIso: bucket.hourIso,
      endIso: new Date(iv.endMs).toISOString(),
      durationMinutes: 60,
      confidenceWeight: WEIGHT.step_burst,
      label: `${bucket.steps.toLocaleString()} steps in an hour`,
      response: glucoseResponse(iv.endMs, input.glucose),
    });
  }

  events.sort((a, b) => ms(a.startIso) - ms(b.startIso));

  const minutesOf = (kind: ActivityEventKind) =>
    events.filter((e) => e.kind === kind).reduce((a, e) => a + e.durationMinutes, 0);
  const workoutMinutes = minutesOf('workout');
  const hrElevatedMinutes = minutesOf('hr_elevated');
  const stepBurstMinutes = minutesOf('step_burst');

  // Confidence-weighted response averages. Only events where glucose actually
  // fell count toward the "drop" number — rises after activity are real (HIIT)
  // but belong to a separate signal, not this average.
  const responded = events.filter((e) => e.response && e.response.dropMgdl > 0);
  const weightSum = responded.reduce((a, e) => a + e.confidenceWeight, 0);
  const avgDropMgdl =
    responded.length > 0
      ? Math.round(
          responded.reduce((a, e) => a + e.response!.dropMgdl * e.confidenceWeight, 0) /
            weightSum,
        )
      : null;
  const avgMinutesToNadir =
    responded.length > 0
      ? Math.round(
          responded.reduce(
            (a, e) => a + e.response!.minutesToNadir * e.confidenceWeight,
            0,
          ) / weightSum,
        )
      : null;

  return {
    events,
    compositeExerciseMinutes: workoutMinutes + hrElevatedMinutes + stepBurstMinutes,
    duplicateWorkoutsDropped,
    workoutMinutes,
    hrElevatedMinutes,
    stepBurstMinutes,
    avgDropMgdl,
    avgMinutesToNadir,
    respondedEventCount: responded.length,
    windowHours: input.windowHours,
  };
}
