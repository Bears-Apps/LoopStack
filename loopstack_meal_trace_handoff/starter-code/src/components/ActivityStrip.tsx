import type { ActivityStatus } from '../lib/activity/activityStatus'
import './ActivityStrip.css'

type ActivityStripProps = {
  activity: ActivityStatus
}

function formatWorkoutLabel(type: string) {
  return type.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

export function ActivityStrip({ activity }: ActivityStripProps) {
  if (
    activity.state === 'none' &&
    activity.confirmed.length === 0 &&
    activity.suspected.length === 0
  ) {
    return null
  }

  return (
    <section className="activity-strip" aria-label="Activity context">
      <div className="activity-strip__header">
        <span className="activity-strip__eyebrow">Activity context</span>
        <span className="activity-strip__confidence">
          {Math.round(activity.confidence * 100)}% confidence
        </span>
      </div>

      {activity.confirmed.length > 0 && (
        <div className="activity-strip__chips">
          {activity.confirmed.slice(0, 3).map((workout) => (
            <span className="activity-strip__chip" key={workout.id}>
              {formatWorkoutLabel(workout.type)} · {formatMinutes(workout.durationMinutes)}
            </span>
          ))}
        </div>
      )}

      {activity.suspected.length > 0 && (
        <div className="activity-strip__suspected">
          {activity.suspected.slice(0, 2).map((window) => (
            <span className="activity-strip__suspected-chip" key={window.startTime}>
              Possible activity · {formatMinutes(window.durationMinutes)} · avg {window.averageBpm} bpm
            </span>
          ))}
        </div>
      )}

      <p className="activity-strip__advisory">{activity.advisory}</p>
    </section>
  )
}
