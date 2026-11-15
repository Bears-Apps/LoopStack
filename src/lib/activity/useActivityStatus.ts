import { useMemo } from 'react';
import {
  useRecentHeartRate,
  useRecentWorkouts,
  useRestingHeartRate,
} from '@/data/sources/hooks';
import { classifyActivity, type ActivityStatus } from './activityStatus';

// React hook layered on top of the three data-source hooks. Recomputes only
// when one of the underlying snapshot fields changes, so the classifier
// itself doesn't run on every TrendsHome render.

export function useActivityStatus(): ActivityStatus {
  const workouts = useRecentWorkouts();
  const heartRate = useRecentHeartRate();
  const restingHr = useRestingHeartRate();

  return useMemo(
    () =>
      classifyActivity({
        workouts: workouts.data ?? [],
        heartRateSamples: heartRate.data ?? [],
        restingHeartRate: restingHr.data ?? null,
      }),
    [workouts.data, heartRate.data, restingHr.data],
  );
}
