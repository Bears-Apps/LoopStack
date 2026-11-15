import { describe, expect, it } from 'vitest';
import { computeActivitySummary, dedupeWorkouts, type HourlySteps } from './activityEvents';
import type {
  GlucoseReading,
  HeartRateSample,
  WorkoutEntry,
} from '@/data/sources/types';

const T0 = new Date('2026-07-21T08:00:00Z').getTime();
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

function workout(startMin: number, endMin: number): WorkoutEntry {
  return {
    id: `w_${startMin}`,
    type: 'cycling',
    startTime: iso(startMin),
    endTime: iso(endMin),
    durationMinutes: endMin - startMin,
  };
}

/** HR samples every 5 min across [startMin, endMin] at the given bpm. */
function hrRun(startMin: number, endMin: number, bpm: number): HeartRateSample[] {
  const out: HeartRateSample[] = [];
  for (let m = startMin; m <= endMin; m += 5) out.push({ timestamp: iso(m), bpm });
  return out;
}

/** Flat glucose at 130, dropping to 90 between dropStart and dropEnd minutes. */
function glucoseWithDrop(dropStartMin: number, dropEndMin: number): GlucoseReading[] {
  const out: GlucoseReading[] = [];
  for (let m = -60; m <= 600; m += 5) {
    const inDrop = m >= dropStartMin && m <= dropEndMin;
    out.push({ iso: iso(m), mgdl: inDrop ? 90 : 130 });
  }
  return out;
}

describe('computeActivitySummary', () => {
  it('merges all three signals, deduplicated', () => {
    const s = computeActivitySummary({
      workouts: [workout(0, 45)],
      // HR elevated during the workout (should dedupe) AND later standalone.
      heartRate: [...hrRun(10, 40, 140), ...hrRun(180, 200, 130)],
      restingBpm: 60,
      hourlySteps: [
        { hourIso: iso(360), steps: 2200 },       // standalone burst
        { hourIso: iso(0), steps: 3000 },          // overlaps workout → dropped
      ] satisfies HourlySteps[],
      glucose: glucoseWithDrop(60, 120),
      windowHours: 12,
    });

    expect(s.events.map((e) => e.kind).sort()).toEqual([
      'hr_elevated',
      'step_burst',
      'workout',
    ]);
    expect(s.workoutMinutes).toBe(45);
    expect(s.hrElevatedMinutes).toBe(20);
    expect(s.stepBurstMinutes).toBe(60);
    expect(s.compositeExerciseMinutes).toBe(125);
  });

  it('measures the glucose drop after an event', () => {
    const s = computeActivitySummary({
      workouts: [workout(0, 45)],
      heartRate: [],
      restingBpm: 60,
      hourlySteps: [],
      glucose: glucoseWithDrop(60, 120), // drop starts 15 min after workout end
      windowHours: 12,
    });
    const w = s.events[0];
    expect(w.response?.baselineMgdl).toBe(130);
    expect(w.response?.nadirMgdl).toBe(90);
    expect(w.response?.dropMgdl).toBe(40);
    expect(s.avgDropMgdl).toBe(40);
    expect(s.respondedEventCount).toBe(1);
  });

  it('no glucose fall → null averages, not zero', () => {
    const flat: GlucoseReading[] = [];
    for (let m = -60; m <= 600; m += 5) flat.push({ iso: iso(m), mgdl: 130 });
    const s = computeActivitySummary({
      workouts: [workout(0, 45)],
      heartRate: [],
      restingBpm: null,
      hourlySteps: [],
      glucose: flat,
      windowHours: 12,
    });
    expect(s.avgDropMgdl).toBeNull();
    expect(s.respondedEventCount).toBe(0);
  });

  it('empty inputs → empty summary, no crash', () => {
    const s = computeActivitySummary({
      workouts: [],
      heartRate: [],
      restingBpm: null,
      hourlySteps: [],
      glucose: [],
      windowHours: 12,
    });
    expect(s.events).toEqual([]);
    expect(s.compositeExerciseMinutes).toBe(0);
    expect(s.avgDropMgdl).toBeNull();
  });

  it('sub-threshold steps and short HR runs are ignored', () => {
    const s = computeActivitySummary({
      workouts: [],
      heartRate: hrRun(0, 5, 140), // only 5 min — under the 10-min floor
      restingBpm: 60,
      hourlySteps: [{ hourIso: iso(0), steps: 900 }],
      glucose: [],
      windowHours: 12,
    });
    expect(s.events).toEqual([]);
  });
});

// ── duplicate workouts ─────────────────────────────────────────────────────
//
// Apple Health keeps one record per app that wrote an activity. A single run
// tracked by the Watch and by a running app arrives as two workouts covering
// the same minutes, and summing both roughly doubles reported exercise.

describe('duplicate workouts', () => {
  const at = (h: number, m = 0) => new Date(2026, 3, 1, h, m).toISOString();

  const run = (start: string, end: string, type = 'running', source = 'Watch') => ({
    id: `${start}-${source}`,
    type,
    startTime: start,
    endTime: end,
    durationMinutes: Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) / 60_000,
    ),
    source,
  }) as WorkoutEntry;

  it('collapses the same run written by two apps', () => {
    const kept = dedupeWorkouts([
      run(at(7, 0), at(7, 45), 'running', 'Apple Watch'),
      run(at(7, 1), at(7, 44), 'running', 'Strava'),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('keeps the longer record when two disagree', () => {
    const kept = dedupeWorkouts([
      run(at(7, 5), at(7, 30), 'running', 'Truncated'),
      run(at(7, 0), at(7, 45), 'running', 'Full'),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].source).toBe('Full');
  });

  it('collapses across different labels — one activity, two names', () => {
    const kept = dedupeWorkouts([
      run(at(7, 0), at(7, 45), 'running', 'Watch'),
      run(at(7, 0), at(7, 45), 'cardio', 'Gym app'),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('keeps genuinely separate sessions', () => {
    const kept = dedupeWorkouts([
      run(at(7, 0), at(7, 45)),
      run(at(18, 0), at(18, 40)),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('keeps a warm-up that merely touches the main session', () => {
    // Back-to-back activities share a boundary but not their duration.
    const kept = dedupeWorkouts([
      run(at(7, 0), at(7, 15), 'walking'),
      run(at(7, 14), at(8, 0), 'running'),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('drops records with unusable timestamps rather than counting them', () => {
    const kept = dedupeWorkouts([
      run(at(7, 0), at(7, 45)),
      run('not-a-date', 'also-bad'),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('returns them in time order', () => {
    const kept = dedupeWorkouts([run(at(18, 0), at(18, 40)), run(at(7, 0), at(7, 45))]);
    expect(new Date(kept[0].startTime).getHours()).toBe(7);
  });

  it('does not double-count exercise minutes in the summary', () => {
    const duplicated = [
      run(at(7, 0), at(7, 45), 'running', 'Apple Watch'),
      run(at(7, 0), at(7, 45), 'running', 'Strava'),
    ];
    const summary = computeActivitySummary({
      workouts: duplicated,
      heartRate: [],
      restingBpm: 60,
      hourlySteps: [],
      glucose: [],
      windowHours: 72,
    });
    expect(summary.workoutMinutes).toBe(45);
    expect(summary.compositeExerciseMinutes).toBe(45);
    expect(summary.duplicateWorkoutsDropped).toBe(1);
    expect(summary.events).toHaveLength(1);
  });

  it('reports nothing dropped when every workout is distinct', () => {
    const summary = computeActivitySummary({
      workouts: [run(at(7, 0), at(7, 45)), run(at(18, 0), at(18, 40))],
      heartRate: [],
      restingBpm: 60,
      hourlySteps: [],
      glucose: [],
      windowHours: 72,
    });
    expect(summary.duplicateWorkoutsDropped).toBe(0);
    expect(summary.workoutMinutes).toBe(85);
  });
});
