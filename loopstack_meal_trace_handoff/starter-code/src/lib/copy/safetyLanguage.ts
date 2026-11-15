const blockedPhrases = [
  'take x units',
  'take this dose',
  'reduce insulin by',
  'increase insulin by',
  'change your isf',
  'change your carb ratio',
  'you should dose',
]

export function softenMedicalLanguage(copy: string): string {
  let result = copy

  result = result.replace(/you should take/gi, 'you may want to review')
  result = result.replace(/take ([\d.]+) units/gi, 'review this suggested strategy')
  result = result.replace(/reduce insulin by/gi, 'consider whether less insulin may be appropriate with your care team')
  result = result.replace(/increase insulin by/gi, 'consider whether more coverage may be appropriate with your care team')
  result = result.replace(/change your ISF/gi, 'review your ISF setting with your clinician')
  result = result.replace(/change your carb ratio/gi, 'review your carb ratio with your clinician')

  return result
}

export function hasRiskyMedicalLanguage(copy: string): boolean {
  const normalized = copy.toLowerCase()
  return blockedPhrases.some((phrase) => normalized.includes(phrase))
}

export const safePhraseBank = {
  patternSuggests: 'Pattern suggests this meal may behave differently than expected.',
  mayFitBetter: 'A different strategy may fit this meal better.',
  confidenceLower: 'Confidence is lower because some context is incomplete.',
  clinicianReview: 'Consider reviewing recurring patterns with your clinician.',
}
