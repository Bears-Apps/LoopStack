import type {
  GlucoseSample,
  InsulinEvent,
  MealTraceAlignmentLabel,
  MealTraceResult,
} from '../../types/mealTrace'
import type { NutritionEntry } from '../../types/nutrition'
import type { ActivityStatus } from '../activity/activityStatus'

type AlignmentInput = {
  nutrition: NutritionEntry
  insulinEvents: InsulinEvent[]
  glucoseSamples: GlucoseSample[]
  activityContext?: ActivityStatus
  targetLow?: number
  targetHigh?: number
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function scoreMealAlignment(input: AlignmentInput): {
  observed: MealTraceResult['observed']
  alignment: MealTraceResult['alignment']
} {
  const {
    nutrition,
    insulinEvents,
    glucoseSamples,
    activityContext,
    targetLow = 70,
    targetHigh = 180,
  } = input

  if (glucoseSamples.length < 6) {
    return {
      observed: {
        lateRiseDetected: false,
        lateDropDetected: false,
        returnedToRange: false,
      },
      alignment: {
        label: 'uncertain',
        score: 30,
        confidence: 20,
        reasons: ['Not enough CGM data was available after this meal.'],
      },
    }
  }

  const sorted = [...glucoseSamples].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  const start = sorted[0]
  const end = sorted[sorted.length - 1]
  const peak = sorted.reduce((max, sample) => (sample.value > max.value ? sample : max), start)
  const low = sorted.reduce((min, sample) => (sample.value < min.value ? sample : min), start)

  const peakDelta = peak.value - start.value
  const peakTimeMinutes = minutesBetween(start.timestamp, peak.timestamp)
  const timeAboveRangeMinutes = sorted.filter((sample) => sample.value > targetHigh).length * 5
  const timeBelowRangeMinutes = sorted.filter((sample) => sample.value < targetLow).length * 5

  const lateSamples = sorted.filter((sample) => minutesBetween(start.timestamp, sample.timestamp) >= 180)
  const lateRiseDetected = lateSamples.length > 0 && lateSamples.some((sample) => sample.value - start.value > 40)
  const lateDropDetected = lateSamples.length > 0 && lateSamples.some((sample) => start.value - sample.value > 35 || sample.value < targetLow)
  const returnedToRange = end.value >= targetLow && end.value <= targetHigh

  let label: MealTraceAlignmentLabel = 'aligned'
  const reasons: string[] = []

  if (peakDelta > 60 && peakTimeMinutes <= 90) {
    label = 'early_spike'
    reasons.push('Glucose rose quickly in the first part of the meal window.')
  }

  if (lateRiseDetected) {
    label = 'late_rise'
    reasons.push('Glucose rose later in the meal window, which can happen with slower absorption meals.')
  }

  if (lateDropDetected || timeBelowRangeMinutes >= 15) {
    label = 'late_drop'
    reasons.push('Glucose dropped later in the meal window.')
  }

  if (timeAboveRangeMinutes >= 120 && !lateDropDetected) {
    label = 'undercovered'
    reasons.push('Glucose stayed above range for an extended part of the meal window.')
  }

  if (timeBelowRangeMinutes >= 30) {
    label = 'overcorrected'
    reasons.push('Glucose spent meaningful time below range after the meal.')
  }

  if (label === 'aligned') {
    reasons.push('Observed glucose stayed reasonably close to the expected meal window.')
  }

  if ((nutrition.fatGrams ?? 0) >= 25 && lateRiseDetected) {
    reasons.push('Higher fat content may have contributed to delayed absorption.')
  }

  if (activityContext && activityContext.state !== 'none') {
    reasons.push(activityContext.advisory)
  }

  const scorePenalty =
    timeAboveRangeMinutes * 0.25 +
    timeBelowRangeMinutes * 0.5 +
    Math.max(peakDelta - 40, 0) * 0.4

  const score = clamp(Math.round(100 - scorePenalty), 0, 100)
  const confidence = clamp(
    Math.round(
      50 +
        Math.min(glucoseSamples.length, 48) +
        (insulinEvents.length > 0 ? 10 : -10) +
        (nutrition.confidence ?? 0.5) * 10 -
        (activityContext?.confidence && activityContext.confidence < 0.5 ? 10 : 0)
    ),
    0,
    100
  )

  return {
    observed: {
      startingGlucose: start.value,
      endingGlucose: end.value,
      peakGlucose: peak.value,
      peakDelta,
      peakTimeMinutes,
      lowestGlucose: low.value,
      timeAboveRangeMinutes,
      timeBelowRangeMinutes,
      lateRiseDetected,
      lateDropDetected,
      returnedToRange,
    },
    alignment: {
      label,
      score,
      confidence,
      reasons,
    },
  }
}
