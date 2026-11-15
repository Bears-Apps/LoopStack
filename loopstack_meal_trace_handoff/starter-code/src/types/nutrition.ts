export type NutritionSource =
  | 'apple_health'
  | 'manual'
  | 'ai_estimate'
  | 'imported'
  | 'mock'

export type NutritionConfidence =
  | 'confirmed'
  | 'estimated'
  | 'partial'
  | 'unknown'

export type NutritionEntry = {
  id: string
  timestamp: string
  mealName?: string
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unknown'
  carbs: number
  fatGrams?: number
  proteinGrams?: number
  fiberGrams?: number
  calories?: number
  source: NutritionSource
  confidence: number
  confidenceLabel?: NutritionConfidence
  notes?: string[]
}

export function normalizeNutritionEntry(entry: Partial<NutritionEntry>): NutritionEntry {
  return {
    id: entry.id ?? `nutrition-${entry.timestamp ?? Date.now()}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    mealName: entry.mealName,
    mealType: entry.mealType ?? 'unknown',
    carbs: Math.max(entry.carbs ?? 0, 0),
    fatGrams: entry.fatGrams,
    proteinGrams: entry.proteinGrams,
    fiberGrams: entry.fiberGrams,
    calories: entry.calories,
    source: entry.source ?? 'manual',
    confidence: entry.confidence ?? 0.5,
    confidenceLabel: entry.confidenceLabel ?? 'unknown',
    notes: entry.notes ?? [],
  }
}
