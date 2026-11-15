// Example only. Adapt this mapper to the existing LatestMealCard data shape.

import type { MealTraceResult } from '../types/mealTrace'

export function mapMealTraceToLatestMealCard(trace?: MealTraceResult, mockLatestMeal?: unknown) {
  if (!trace) {
    return mockLatestMeal
  }

  return {
    id: trace.mealId,
    title: trace.nutrition.mealName ?? 'Latest meal',
    timestamp: trace.mealStartTime,
    macros: {
      carbs: trace.nutrition.carbs,
      fatGrams: trace.nutrition.fatGrams,
      proteinGrams: trace.nutrition.proteinGrams,
      fiberGrams: trace.nutrition.fiberGrams,
    },
    glucose: {
      startingGlucose: trace.observed.startingGlucose,
      peakGlucose: trace.observed.peakGlucose,
      peakDelta: trace.observed.peakDelta,
      peakTimeMinutes: trace.observed.peakTimeMinutes,
      returnedToRange: trace.observed.returnedToRange,
    },
    alignment: {
      label: trace.alignment.label,
      score: trace.alignment.score,
      confidence: trace.alignment.confidence,
      reasons: trace.alignment.reasons,
    },
    activityContext: trace.activityContext
      ? {
          state: trace.activityContext.state,
          advisory: trace.activityContext.advisory,
          confidence: trace.activityContext.confidence,
        }
      : undefined,
  }
}
