// Example only. Adapt this to the current shape of src/data/insulinStrategy.ts.

import type { ActivityStatus } from '../activity/activityStatus'

type SuggestStrategyInput<UserProfile> = {
  meal: {
    carbs: number
    fatGrams?: number
    proteinGrams?: number
    fiberGrams?: number
  }
  profile: UserProfile & {
    fitness?: {
      isfMultiplier?: number
    }
  }
  activityContext?: ActivityStatus
}

export function getActivityStrategyCopy(activityContext?: ActivityStatus): string | undefined {
  if (!activityContext || activityContext.state === 'none') return undefined

  if (activityContext.confidence < 0.5) {
    return 'Possible activity was detected from heart-rate patterns, so confidence is slightly lower.'
  }

  return activityContext.advisory
}

export function exampleActivityMerge<UserProfile>(input: SuggestStrategyInput<UserProfile>) {
  return {
    ...input.profile,
    fitness: {
      ...input.profile.fitness,
      isfMultiplier:
        input.activityContext?.isfModifier ?? input.profile.fitness?.isfMultiplier ?? 1,
    },
  }
}
