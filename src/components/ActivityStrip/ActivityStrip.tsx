import type {
  ActivityState,
  ActivityStatus,
} from '@/lib/activity/activityStatus';
import type { WorkoutType } from '@/data/sources/types';
import styles from './ActivityStrip.module.css';

type Props = {
  activity: ActivityStatus;
};

const stateLabel: Record<ActivityState, string> = {
  none: 'No recent activity',
  active_now: 'Active now',
  recent_cardio: 'Recent cardio',
  recent_endurance: 'Recent endurance',
  recent_strength: 'Recent strength',
  recent_hiit: 'Recent high-intensity',
  suspected_activity: 'Possible activity',
  overnight_low_risk: 'Activity before bedtime',
};

// Maps workout type → user-facing label. Kept short for chip display.
function formatWorkoutLabel(type: WorkoutType): string {
  switch (type) {
    case 'running':
      return 'Run';
    case 'walking':
      return 'Walk';
    case 'cycling':
      return 'Cycle';
    case 'swimming':
      return 'Swim';
    case 'strength':
      return 'Strength';
    case 'hiit':
      return 'HIIT';
    case 'cardio':
      return 'Cardio';
    case 'other':
      return 'Workout';
    case 'unknown':
    default:
      return 'Workout';
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function ActivityStrip({ activity }: Props) {
  // Don't render at all when there's truly nothing to show.
  if (
    activity.state === 'none' &&
    activity.confirmed.length === 0 &&
    activity.suspected.length === 0
  ) {
    return null;
  }

  return (
    <section
      className={`${styles.strip} ${styles[`state_${activity.state}`]}`}
      aria-label="Activity context"
    >
      <header className={styles.head}>
        <span className={styles.eyebrow}>Activity context</span>
        <span className={styles.stateLabel}>{stateLabel[activity.state]}</span>
        <span className={styles.confidence}>
          {Math.round(activity.confidence * 100)}% confidence
        </span>
      </header>

      {activity.confirmed.length > 0 ? (
        <div className={styles.chips}>
          {activity.confirmed.slice(0, 3).map((workout) => (
            <span className={styles.chip} key={workout.id}>
              {formatWorkoutLabel(workout.type)} · {formatMinutes(workout.durationMinutes)}
            </span>
          ))}
        </div>
      ) : null}

      {activity.suspected.length > 0 ? (
        <div className={styles.suspectedRow}>
          {activity.suspected.slice(0, 2).map((win) => (
            <span className={styles.suspectedChip} key={win.startTime}>
              Possible activity · {formatMinutes(win.durationMinutes)} · avg {win.averageBpm} bpm
            </span>
          ))}
        </div>
      ) : null}

      <p className={styles.advisory}>{activity.advisory}</p>
    </section>
  );
}
