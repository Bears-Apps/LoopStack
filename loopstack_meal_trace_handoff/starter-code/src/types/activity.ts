export type WorkoutType =
  | 'running'
  | 'walking'
  | 'cycling'
  | 'swimming'
  | 'strength'
  | 'hiit'
  | 'cardio'
  | 'other'
  | 'unknown'

export type WorkoutEntry = {
  id: string
  type: WorkoutType
  startTime: string
  endTime: string
  durationMinutes: number
  calories?: number
  distanceMeters?: number
  source?: string
}

export type HeartRateSample = {
  timestamp: string
  bpm: number
  source?: string
}

export type HealthSnapshot = {
  bloodGlucoseSamples: Array<{
    timestamp: string
    value: number
    unit?: 'mg/dL' | 'mmol/L'
  }>
  insulinEvents: Array<{
    id: string
    timestamp: string
    units: number
    type?: 'bolus' | 'basal' | 'correction' | 'unknown'
    source?: string
  }>
  nutritionEntries: Array<{
    id: string
    timestamp: string
    carbs: number
    fatGrams?: number
    proteinGrams?: number
    fiberGrams?: number
    calories?: number
    source?: string
  }>
  workouts: WorkoutEntry[]
  heartRateSamples: HeartRateSample[]
  restingHeartRate?: number
}
