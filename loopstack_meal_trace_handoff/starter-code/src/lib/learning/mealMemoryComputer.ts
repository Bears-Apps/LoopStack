import type { MealTraceResult, MealTraceAlignmentLabel } from '../../types/mealTrace'
import type { MealMemoryPattern, MealMemoryConfidenceLabel } from '../../types/learning'
import { createMealFingerprint, fingerprintKey } from './mealFingerprint'

function mostCommon<T extends string>(items: T[]): T {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1
    return acc
  }, {})

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as T
}

function getConfidenceLabel(occurrenceCount: number, consistencyScore: number): MealMemoryConfidenceLabel {
  if (occurrenceCount < 3) return 'anecdotal'
  if (occurrenceCount < 6) return 'early_pattern'
  if (occurrenceCount < 10 || consistencyScore < 70) return 'moderate_confidence'
  return 'strong_pattern'
}

function getSuggestion(label: MealTraceAlignmentLabel): string {
  switch (label) {
    case 'late_rise':
      return 'Pattern suggests this meal may benefit from a longer absorption strategy.'
    case 'early_spike':
      return 'Pattern suggests the early part of this meal window may need closer attention.'
    case 'late_drop':
      return 'Pattern suggests sensitivity or activity context may be affecting the later meal window.'
    case 'undercovered':
      return 'Pattern suggests this meal often runs higher than expected.'
    case 'overcorrected':
      return 'Pattern suggests this meal window may be followed by a drop.'
    case 'aligned':
      return 'Pattern suggests the current strategy often fits this meal well.'
    default:
      return 'More examples are needed before making a stronger pattern call.'
  }
}

function getPatternTitle(trace: MealTraceResult) {
  if (trace.nutrition.mealName) return trace.nutrition.mealName

  const carbs = Math.round(trace.nutrition.carbs)
  const fat = trace.nutrition.fatGrams ? Math.round(trace.nutrition.fatGrams) : undefined

  if (fat && fat >= 25) return `${carbs}g carb / higher-fat meals`
  return `${carbs}g carb meals`
}

export function computeMealMemoryPatterns(traces: MealTraceResult[]): MealMemoryPattern[] {
  const grouped = traces.reduce<Record<string, MealTraceResult[]>>((acc, trace) => {
    const key = fingerprintKey(createMealFingerprint(trace))
    acc[key] = acc[key] ?? []
    acc[key].push(trace)
    return acc
  }, {})

  return Object.entries(grouped)
    .filter(([, group]) => group.length >= 3)
    .map(([key, group]) => {
      const labels = group.map((trace) => trace.alignment.label)
      const commonAlignment = mostCommon(labels)
      const matchingCount = labels.filter((label) => label === commonAlignment).length
      const consistencyScore = Math.round((matchingCount / group.length) * 100)
      const firstTrace = group[0]
      const confidenceLabel = getConfidenceLabel(group.length, consistencyScore)

      const reasons = [
        `${matchingCount} of ${group.length} similar meals showed a ${commonAlignment.replace('_', ' ')} pattern.`,
      ]

      if (firstTrace.activityContext?.state && firstTrace.activityContext.state !== 'none') {
        reasons.push('Activity context was present in this meal cluster.')
      }

      return {
        id: `pattern-${key}`,
        title: getPatternTitle(firstTrace),
        occurrenceCount: group.length,
        consistencyScore,
        commonAlignment,
        commonGlucoseShape: commonAlignment.replace('_', '-'),
        confidenceLabel,
        suggestion: getSuggestion(commonAlignment),
        reasons,
        relatedMealIds: group.map((trace) => trace.mealId),
      }
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.consistencyScore - a.consistencyScore)
}
