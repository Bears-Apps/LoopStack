import type { NutritionEntry } from './nutrition'
import type { ActivityStatus } from '../lib/activity/activityStatus'

export type GlucoseSample = {
  timestamp: string
  value: number
  unit?: 'mg/dL' | 'mmol/L'
}

export type InsulinEvent = {
  id: string
  timestamp: string
  units: number
  type?: 'bolus' | 'basal' | 'correction' | 'unknown'
  source?: string
}

export type MealTraceAlignmentLabel =
  | 'aligned'
  | 'early_spike'
  | 'late_rise'
  | 'late_drop'
  | 'undercovered'
  | 'overcorrected'
  | 'uncertain'

export type MealWindow = {
  mealId: string
  startTime: string
  endTime: string
  analysisHours: number
  nutrition: NutritionEntry
}

export type MealTraceResult = {
  mealId: string
  mealStartTime: string
  mealEndTime: string
  nutrition: NutritionEntry
  insulinEvents: InsulinEvent[]
  glucoseSamples: GlucoseSample[]
  activityContext?: ActivityStatus
  observed: {
    startingGlucose?: number
    endingGlucose?: number
    peakGlucose?: number
    peakDelta?: number
    peakTimeMinutes?: number
    lowestGlucose?: number
    timeAboveRangeMinutes?: number
    timeBelowRangeMinutes?: number
    lateRiseDetected: boolean
    lateDropDetected: boolean
    returnedToRange: boolean
  }
  alignment: {
    label: MealTraceAlignmentLabel
    score: number
    confidence: number
    reasons: string[]
  }
}
