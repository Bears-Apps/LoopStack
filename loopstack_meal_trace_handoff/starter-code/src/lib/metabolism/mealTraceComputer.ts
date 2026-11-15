import type { GlucoseSample, InsulinEvent, MealTraceResult } from '../../types/mealTrace'
import type { NutritionEntry } from '../../types/nutrition'
import type { ActivityStatus } from '../activity/activityStatus'
import { detectMealWindows } from './mealWindowDetector'
import { scoreMealAlignment } from './alignmentScore'

type ComputeMealTracesInput = {
  nutritionEntries: NutritionEntry[]
  insulinEvents: InsulinEvent[]
  glucoseSamples: GlucoseSample[]
  activityContext?: ActivityStatus
}

function isWithinWindow(timestamp: string, start: string, end: string) {
  const time = new Date(timestamp).getTime()
  return time >= new Date(start).getTime() && time <= new Date(end).getTime()
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(new Date(timestamp).getTime() + minutes * 60000).toISOString()
}

export function computeMealTraces(input: ComputeMealTracesInput): MealTraceResult[] {
  const windows = detectMealWindows(input.nutritionEntries)

  return windows.map((window) => {
    const insulinWindowStart = addMinutes(window.startTime, -45)
    const insulinWindowEnd = window.endTime

    const matchingInsulin = input.insulinEvents.filter((event) =>
      isWithinWindow(event.timestamp, insulinWindowStart, insulinWindowEnd)
    )

    const matchingGlucose = input.glucoseSamples.filter((sample) =>
      isWithinWindow(sample.timestamp, window.startTime, window.endTime)
    )

    const scored = scoreMealAlignment({
      nutrition: window.nutrition,
      insulinEvents: matchingInsulin,
      glucoseSamples: matchingGlucose,
      activityContext: input.activityContext,
    })

    return {
      mealId: window.mealId,
      mealStartTime: window.startTime,
      mealEndTime: window.endTime,
      nutrition: window.nutrition,
      insulinEvents: matchingInsulin,
      glucoseSamples: matchingGlucose,
      activityContext: input.activityContext,
      observed: scored.observed,
      alignment: scored.alignment,
    }
  })
}

export function getLatestMealTrace(traces: MealTraceResult[]): MealTraceResult | undefined {
  return [...traces].sort(
    (a, b) => new Date(b.mealStartTime).getTime() - new Date(a.mealStartTime).getTime()
  )[0]
}
