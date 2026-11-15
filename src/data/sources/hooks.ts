import { useSyncExternalStore } from 'react';
import { useDataSourceContext } from './DataSourceContext';
import type { DataResult, DataSnapshot } from './types';

// Hook layer screens consume. Each hook returns a DataResult<T> so the UI can
// branch on loading / error / staleness without knowing which source is in
// play. Mock returns fresh data instantly; real sources fill in over time.

function useSnapshotField<K extends keyof DataSnapshot>(
  field: K,
): DataSnapshot[K] {
  const { source } = useDataSourceContext();
  return useSyncExternalStore(
    (cb) => source.subscribe(cb),
    () => source.getSnapshot()[field],
    () => source.getSnapshot()[field],
  );
}

export function useCurrentGlucose(): DataSnapshot['currentGlucose'] {
  return useSnapshotField('currentGlucose');
}

export function useTimeTrends(): DataSnapshot['timeTrends'] {
  return useSnapshotField('timeTrends');
}

export function useInsulinLedger(): DataSnapshot['insulinLedger'] {
  return useSnapshotField('insulinLedger');
}

export function useRecentGlucose(): DataSnapshot['recentGlucose'] {
  return useSnapshotField('recentGlucose');
}

export function useRecentInsulin(): DataSnapshot['recentInsulin'] {
  return useSnapshotField('recentInsulin');
}

export function useCurrentLoopIob(): DataSnapshot['currentLoopIob'] {
  return useSnapshotField('currentLoopIob');
}

export function useRecentCarbs(): DataSnapshot['recentCarbs'] {
  return useSnapshotField('recentCarbs');
}

export function useRecentWorkouts(): DataSnapshot['recentWorkouts'] {
  return useSnapshotField('recentWorkouts');
}

export function useRecentHeartRate(): DataSnapshot['recentHeartRate'] {
  return useSnapshotField('recentHeartRate');
}

export function useRestingHeartRate(): DataSnapshot['restingHeartRate'] {
  return useSnapshotField('restingHeartRate');
}

export function useMetrics(): DataSnapshot['metrics'] {
  return useSnapshotField('metrics');
}

export function useActivitySummary(): DataSnapshot['activitySummary'] {
  return useSnapshotField('activitySummary');
}

export function useLoopMode(): DataSnapshot['loopMode'] {
  return useSnapshotField('loopMode');
}

export function useBasalInsights(): DataSnapshot['basalInsights'] {
  return useSnapshotField('basalInsights');
}

export function useAutosens(): DataSnapshot['autosens'] {
  return useSnapshotField('autosens');
}

export function useAutotune(): DataSnapshot['autotune'] {
  return useSnapshotField('autotune');
}

export function useAbsorptionInsights(): DataSnapshot['absorptionInsights'] {
  return useSnapshotField('absorptionInsights');
}

export function useSettingsReview(): DataSnapshot['settingsReview'] {
  return useSnapshotField('settingsReview');
}

export function useRiskWindows(): DataSnapshot['riskWindows'] {
  return useSnapshotField('riskWindows');
}

export function useDayHourGrid(): DataSnapshot['dayHourGrid'] {
  return useSnapshotField('dayHourGrid');
}

export function useWeekdayHourly(): DataSnapshot['weekdayHourly'] {
  return useSnapshotField('weekdayHourly');
}

export function useWeekdayExercise(): DataSnapshot['weekdayExercise'] {
  return useSnapshotField('weekdayExercise');
}

/** True unless the source explicitly computed this result from real data. */
export function isSample<T>(result: DataResult<T>): boolean {
  return result.origin !== 'computed';
}

// Convenience predicate — common branching the UI does.
export function isReady<T>(result: DataResult<T>): result is DataResult<T> & {
  data: T;
} {
  return result.data != null && !result.loading;
}
