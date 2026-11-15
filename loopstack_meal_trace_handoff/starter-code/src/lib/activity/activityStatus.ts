import type { HeartRateSample, WorkoutEntry } from '../../types/activity'

export type ActivityState =
  | 'none'
  | 'active_now'
  | 'recent_cardio'
  | 'recent_endurance'
  | 'recent_strength'
  | 'recent_hiit'
  | 'suspected_activity'
  | 'overnight_low_risk'

export type HRWindow = {
  startTime: string
  endTime: string
  durationMinutes: number
  averageBpm: number
  peakBpm: number
  reason: string
}

export type ActivityStatus = {
  confirmed: WorkoutEntry[]
  suspected: HRWindow[]
  state: ActivityState
  isfModifier: number
  confidence: number
  advisory: string
  strategyFlags: string[]
}

type ClassifyActivityInput = {
  workouts: WorkoutEntry[]
  heartRateSamples: HeartRateSample[]
  restingHeartRate?: number
  currentTime?: string
}

function minutesAgo(timestamp: string, now: Date): number {
  return Math.round((now.getTime() - new Date(timestamp).getTime()) / 60000)
}

function isCardioLike(type: WorkoutEntry['type']) {
  return ['running', 'walking', 'cycling', 'swimming', 'cardio'].includes(type)
}

function findSuspectedHRWindows(samples: HeartRateSample[], restingHeartRate?: number): HRWindow[] {
  if (!samples.length) return []

  const threshold = restingHeartRate ? restingHeartRate + 25 : 120
  const sorted = [...samples].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  const windows: HRWindow[] = []
  let activeWindow: HeartRateSample[] = []

  for (const sample of sorted) {
    const qualifies = sample.bpm >= threshold || sample.bpm >= 120
    if (qualifies) {
      activeWindow.push(sample)
    } else {
      maybePushWindow(activeWindow, windows)
      activeWindow = []
    }
  }

  maybePushWindow(activeWindow, windows)
  return windows
}

function maybePushWindow(samples: HeartRateSample[], windows: HRWindow[]) {
  if (samples.length < 2) return

  const start = samples[0]
  const end = samples[samples.length - 1]
  const durationMinutes = Math.round((new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime()) / 60000)

  if (durationMinutes < 10) return

  const bpmValues = samples.map((sample) => sample.bpm)
  const averageBpm = Math.round(bpmValues.reduce((sum, bpm) => sum + bpm, 0) / bpmValues.length)

  windows.push({
    startTime: start.timestamp,
    endTime: end.timestamp,
    durationMinutes,
    averageBpm,
    peakBpm: Math.max(...bpmValues),
    reason: 'Sustained elevated heart rate without a matching logged workout.',
  })
}

export function classifyActivity(input: ClassifyActivityInput): ActivityStatus {
  const now = new Date(input.currentTime ?? new Date().toISOString())

  const recentWorkouts = input.workouts.filter((workout) => {
    const endedAgo = minutesAgo(workout.endTime, now)
    return endedAgo >= 0 && endedAgo <= 24 * 60
  })

  const suspected = findSuspectedHRWindows(input.heartRateSamples, input.restingHeartRate)

  const recentCardio = recentWorkouts.find((workout) => isCardioLike(workout.type) && minutesAgo(workout.endTime, now) <= 30)
  const recentEndurance = recentWorkouts.find((workout) => isCardioLike(workout.type) && minutesAgo(workout.endTime, now) <= 6 * 60)
  const recentStrength = recentWorkouts.find((workout) => workout.type === 'strength' && minutesAgo(workout.endTime, now) <= 6 * 60)
  const recentHiit = recentWorkouts.find((workout) => workout.type === 'hiit' && minutesAgo(workout.endTime, now) <= 6 * 60)

  if (recentCardio) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_cardio',
      isfModifier: 0.9,
      confidence: 0.8,
      advisory: 'Recent cardio may increase insulin sensitivity during this meal window.',
      strategyFlags: ['sensitivity_may_be_elevated', 'watch_late_drop'],
    }
  }

  if (recentHiit) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_hiit',
      isfModifier: 0.95,
      confidence: 0.75,
      advisory: 'Recent high-intensity activity may cause an early rise followed by later sensitivity.',
      strategyFlags: ['possible_early_rise', 'watch_late_drop'],
    }
  }

  if (recentStrength) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_strength',
      isfModifier: 0.95,
      confidence: 0.7,
      advisory: 'Recent strength training may affect glucose differently during the next several hours.',
      strategyFlags: ['activity_context_present', 'watch_delayed_sensitivity'],
    }
  }

  if (recentEndurance) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'recent_endurance',
      isfModifier: 0.9,
      confidence: 0.75,
      advisory: 'Recent endurance activity may increase sensitivity during this meal window.',
      strategyFlags: ['sensitivity_may_be_elevated'],
    }
  }

  if (suspected.length > 0) {
    return {
      confirmed: recentWorkouts,
      suspected,
      state: 'suspected_activity',
      isfModifier: 0.97,
      confidence: 0.45,
      advisory: 'Elevated heart rate was detected. This may reflect activity, stress, caffeine, or another factor.',
      strategyFlags: ['lower_confidence', 'possible_activity_context'],
    }
  }

  return {
    confirmed: recentWorkouts,
    suspected: [],
    state: 'none',
    isfModifier: 1,
    confidence: 0.85,
    advisory: 'No recent activity signal detected.',
    strategyFlags: [],
  }
}
