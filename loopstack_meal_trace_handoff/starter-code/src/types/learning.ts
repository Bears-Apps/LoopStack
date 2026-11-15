import type { MealTraceAlignmentLabel } from './mealTrace'

export type MealMemoryConfidenceLabel =
  | 'anecdotal'
  | 'early_pattern'
  | 'moderate_confidence'
  | 'strong_pattern'

export type MealMemoryPattern = {
  id: string
  title: string
  occurrenceCount: number
  consistencyScore: number
  commonAlignment: MealTraceAlignmentLabel
  commonGlucoseShape: string
  confidenceLabel: MealMemoryConfidenceLabel
  suggestion: string
  reasons: string[]
  relatedMealIds: string[]
}
