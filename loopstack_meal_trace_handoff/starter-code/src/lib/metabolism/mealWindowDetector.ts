import type { NutritionEntry } from '../../types/nutrition'
import type { MealWindow } from '../../types/mealTrace'

function getAnalysisHours(entry: NutritionEntry): number {
  const fat = entry.fatGrams ?? 0
  const protein = entry.proteinGrams ?? 0
  const fiber = entry.fiberGrams ?? 0

  let hours = 4

  if (fat >= 20) hours += 1
  if (fat >= 40) hours += 1
  if (protein >= 35) hours += 1
  if (fiber >= 12) hours += 0.5

  return Math.min(Math.max(hours, 4), 8)
}

export function detectMealWindows(entries: NutritionEntry[]): MealWindow[] {
  return entries
    .filter((entry) => entry.carbs > 0)
    .map((entry, index) => {
      const analysisHours = getAnalysisHours(entry)
      const start = new Date(entry.timestamp)
      const end = new Date(start.getTime() + analysisHours * 60 * 60 * 1000)

      return {
        mealId: entry.id ?? `meal-${entry.timestamp}-${index}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        analysisHours,
        nutrition: entry,
      }
    })
}
