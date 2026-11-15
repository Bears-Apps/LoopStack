import type { MealTraceResult } from '../../types/mealTrace'

export type MealFingerprint = {
  carbBand: string
  fatBand: string
  proteinBand: string
  fiberBand: string
  timeOfDay: 'morning' | 'midday' | 'evening' | 'late_night'
  mealNameToken?: string
  activityState: string
  glucoseShape: string
}

function band(value: number | undefined, bands: number[]) {
  const safeValue = value ?? 0

  for (const breakpoint of bands) {
    if (safeValue < breakpoint) return `<${breakpoint}`
  }

  return `${bands[bands.length - 1]}+`
}

function getTimeOfDay(timestamp: string): MealFingerprint['timeOfDay'] {
  const hour = new Date(timestamp).getHours()

  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 16) return 'midday'
  if (hour >= 16 && hour < 22) return 'evening'
  return 'late_night'
}

function normalizeMealName(name?: string) {
  if (!name) return undefined

  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 3)
    .join('-')
}

function getGlucoseShape(trace: MealTraceResult) {
  if (trace.alignment.label === 'late_rise') return 'late-rise'
  if (trace.alignment.label === 'early_spike') return 'early-spike'
  if (trace.alignment.label === 'late_drop') return 'late-drop'
  if (trace.alignment.label === 'aligned') return 'stable'
  return 'variable'
}

export function createMealFingerprint(trace: MealTraceResult): MealFingerprint {
  return {
    carbBand: band(trace.nutrition.carbs, [20, 45, 70, 100]),
    fatBand: band(trace.nutrition.fatGrams, [10, 20, 35, 50]),
    proteinBand: band(trace.nutrition.proteinGrams, [10, 25, 40, 60]),
    fiberBand: band(trace.nutrition.fiberGrams, [5, 10, 15, 25]),
    timeOfDay: getTimeOfDay(trace.mealStartTime),
    mealNameToken: normalizeMealName(trace.nutrition.mealName),
    activityState: trace.activityContext?.state ?? 'none',
    glucoseShape: getGlucoseShape(trace),
  }
}

export function fingerprintKey(fingerprint: MealFingerprint) {
  return [
    fingerprint.mealNameToken ?? 'meal',
    fingerprint.carbBand,
    fingerprint.fatBand,
    fingerprint.proteinBand,
    fingerprint.fiberBand,
    fingerprint.timeOfDay,
    fingerprint.activityState,
  ].join('|')
}
