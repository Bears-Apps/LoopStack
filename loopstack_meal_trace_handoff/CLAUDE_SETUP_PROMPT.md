# LoopStack Meal Trace + Learning Architecture Pass

You are helping build the next architecture pass for LoopStack.

LoopStack currently has a working deterministic insulin strategy engine in:

`src/data/insulinStrategy.ts`

It takes meal input such as carbs, fatGrams, proteinGrams and profile data such as carb ratio, ISF, fat sensitivity, fitness multiplier, and dietary pattern. It returns a suggested upfront/extended strategy, hourly bars, absorption duration, and explanation copy.

Current real data layer:

- Apple Health `bloodGlucose` is live.
- 5-min and 20-min glucose trends are computed from recent samples.
- Apple Health `insulinDelivery` is being read, but not yet fully rendered or used.
- Apple Health `dietaryCarbohydrates` is being read, but not yet fully connected.
- Meal memory patterns and latest meal absorption curves are currently mocked in `src/data/mealMemoryPatterns.ts` and `src/data/latestMeal.ts`.

The goal is to move LoopStack from mocked meal memory into a real meal trace + learning algorithm system.

The app should:

1. Detect meal windows from nutrition/carb entries.
2. Attach nearby insulin events.
3. Pull CGM samples after the meal.
4. Compare expected vs observed glucose behavior.
5. Score the meal strategy alignment.
6. Cluster similar meals over time.
7. Replace mocked “meal memory” cards with computed patterns when real data exists.
8. Keep the existing rule-based `insulinStrategy` engine intact.

## Important process requirement

Work one step at a time.

For each step:

1. Read the relevant existing project files first.
2. Compare the current codebase to the suggested starter files in this handoff.
3. Provide a short pre-summary before editing:
   - files read
   - files you expect to create or modify
   - any concerns, edge cases, or naming conflicts
   - whether you recommend adjusting the suggested code
4. Ask for confirmation if the step affects app architecture, HealthKit permissions, data persistence, or medical-adjacent copy.
5. After confirmation, execute that step only.
6. After the step, summarize:
   - files changed
   - what was implemented
   - what remains mocked
   - what should be validated in Xcode or the browser

Do not jump ahead. Do not implement all steps at once unless explicitly instructed.

## Medical-adjacent safety rule

Use conservative advisory language.

The app can say:

- “Pattern suggests…”
- “May fit this meal better…”
- “Confidence is lower because…”
- “Consider reviewing recurring patterns with your clinician…”

The app should not say:

- “Take X units”
- “Reduce insulin by X%”
- “Increase insulin by X%”
- “Change your ISF to…”
- “Change your carb ratio to…”

The deterministic strategy engine may calculate suggestions, but the user-facing copy should frame results as pattern insight and strategy context, not medical instruction.

## Before Step 1

First, review the full plan and the starter code bundle. Then provide:

1. Your critique of the architecture.
2. Improvements you recommend before implementation.
3. Whether the build order should change.
4. Any risks around HealthKit data availability, permissions, medical language, or technical debt.
5. A recommended first step.

Then wait for confirmation before editing.

## Suggested build order

### Step 1 — Nutrition data model

Create or align a nutrition data model with support for:

- carbs
- fatGrams
- proteinGrams
- fiberGrams
- calories
- source
- confidence
- timestamp

Support values from Apple Health where available and manual fallback where not available.

Suggested starter file:

`starter-code/src/types/nutrition.ts`

### Step 2 — Health snapshot reads

Extend HealthKit reads if supported by the current plugin to include:

- dietaryCarbohydrates
- dietaryFatTotal
- dietaryProtein
- dietaryFiber
- dietaryEnergyConsumed
- workouts
- heartRate
- restingHeartRate
- insulinDelivery
- bloodGlucose

Read the existing HealthKit integration first and use exact plugin API names. Do not blindly copy placeholder functions.

Suggested starter files:

- `starter-code/src/types/activity.ts`
- `starter-code/src/lib/health/readHealthSnapshot.ts`

### Step 3 — Activity classifier

Create:

`src/lib/activity/activityStatus.ts`

Implement `classifyActivity()` that accepts workouts, heartRate samples, restingHeartRate, and current time.

Return:

```ts
{
  confirmed: WorkoutEntry[],
  suspected: HRWindow[],
  state,
  isfModifier,
  confidence,
  advisory,
  strategyFlags
}
```

Rules:

- Logged workout in last 24h = confirmed activity.
- Cardio within last 30 min = active/recent cardio and higher sensitivity warning.
- Endurance/Z2/Z3 within last 6h = elevated sensitivity.
- HIIT or strength may produce early glucose rise then later sensitivity.
- Late-night cardio within 6h of bedtime = overnight low-risk flag.
- Sustained HR above resting + 25 bpm or absolute >120 bpm for >10 min without workout = suspected activity, lower confidence.
- Do not make medical dosing claims. Return advisory language only.

Suggested starter file:

`starter-code/src/lib/activity/activityStatus.ts`

### Step 4 — Wire activity into insulin strategy

Wire `activityStatus.isfModifier` into the existing insulin strategy engine through `profile.fitness.isfMultiplier`.

Also pass the full `activityContext` into `suggestInsulinStrategy()` so explanation copy can mention why confidence changed.

Read `src/data/insulinStrategy.ts` first. Make the smallest safe change.

Suggested starter reference:

`starter-code/src/lib/metabolism/strategyActivityIntegration.example.ts`

### Step 5 — ActivityStrip UI

Create an `ActivityStrip` component and place it on `TrendsHome` between the glucose hero and `LatestMealCard`.

Show confirmed workout chips prominently. Show suspected HR-only activity in a quieter secondary row. Show one short advisory line.

Suggested starter files:

- `starter-code/src/components/ActivityStrip.tsx`
- `starter-code/src/components/ActivityStrip.css`

### Step 6 — Meal trace computer

Create:

- `src/lib/metabolism/mealWindowDetector.ts`
- `src/lib/metabolism/alignmentScore.ts`
- `src/lib/metabolism/mealTraceComputer.ts`

Implement a first version that:

- Finds meal windows from carb/nutrition entries.
- Attaches insulin events within a pre-bolus and post-meal correction window.
- Pulls CGM samples for 4–8 hours after the meal depending on fat/protein/fiber.
- Calculates actual peak delta, peak time, time above range, late rise, late drop, and return-to-range.
- Generates an alignment label:
  - aligned
  - early_spike
  - late_rise
  - late_drop
  - undercovered
  - overcorrected
  - uncertain
- Generates a 0–100 alignment score and confidence score.
- Returns reasons as plain English strings.

Suggested starter files:

- `starter-code/src/types/mealTrace.ts`
- `starter-code/src/lib/metabolism/mealWindowDetector.ts`
- `starter-code/src/lib/metabolism/alignmentScore.ts`
- `starter-code/src/lib/metabolism/mealTraceComputer.ts`

### Step 7 — Replace mocked LatestMealCard data

Replace mocked latest meal data with computed latest meal trace when available. Keep mock fallback only for demo mode or when no trace data exists.

Suggested starter reference:

`starter-code/src/data/latestMealMapper.example.ts`

### Step 8 — Meal fingerprint helper

Create a meal fingerprint helper that groups similar meals by:

- carb range
- fat range
- protein range
- fiber range
- time of day
- meal label/name
- activity state
- strategy type, if available
- observed glucose shape

Suggested starter file:

`starter-code/src/lib/learning/mealFingerprint.ts`

### Step 9 — Meal memory computation

When 3+ similar meal traces exist, generate a pattern summary:

- occurrence count
- consistency score
- common glucose shape
- common strategy outcome
- suggestion for next time
- confidence label: anecdotal, early pattern, moderate confidence, strong pattern

Suggested starter files:

- `starter-code/src/types/learning.ts`
- `starter-code/src/lib/learning/mealMemoryComputer.ts`

### Step 10 — Conservative copy helper

Add a small copy helper if useful so risky phrasing is centralized.

Suggested starter file:

`starter-code/src/lib/copy/safetyLanguage.ts`

## Final instruction

Proceed carefully, one step at a time.

For every step, read first, suggest improvements, provide a pre-summary, wait for approval if needed, then execute.
