# Data Model

Five core objects. Everything in the app is a composition of these.

---

## Object relationship

```
RawEntry ──────┐
                ├──► MealMemory ──► SuggestedApproach
RawEntry ──────┘         │
                         └──► Pattern ──► Trend
```

- `RawEntry` — any inbound data point (screenshot, CGM slice, meal photo, manual note).
- `MealMemory` — a curated composition of multiple RawEntries around one meal.
- `Pattern` — an observation across many MealMemories (or other entries).
- `Trend` — a direction of change in a metric over a time range.
- `SuggestedApproach` — evidence-based guidance attached to a MealMemory.

---

## `RawEntry`

```ts
type RawEntry = {
  id: string;
  type: 'screenshot' | 'meal_photo' | 'cgm_slice' | 'note' | 'imported_data';
  source: 'dexcom' | 'apple_health' | 'loop' | 'nightscout' | 'user' | 'share';
  timestamp: string; // ISO 8601
  metadata: Record<string, unknown>;
};
```

## `MealMemory`

```ts
type MealMemory = {
  id: string;
  title: string;                       // e.g. "Chipotle Bowl"
  image?: string;                      // URL or generated thumbnail
  timestamp: string;                   // when the meal started
  estimatedCarbs: number;              // grams
  linkedEntries: string[];             // RawEntry ids
  glucoseCurve: GlucoseReading[];
  insulinDelivered: number;            // units
  insulinRecommended: number;          // units
  activityContext?: ActivityContext;
  tags: string[];                      // e.g. ['bowl', 'mexican', 'lunch']
  notes?: string;
  outcomeSummary: string;              // one-line phrase
  confidenceScore: 'low' | 'medium' | 'high';
};

type GlucoseReading = { t: string; mgdl: number };
type ActivityContext = {
  prePrandialWalkMinutes?: number;
  postPrandialWalkMinutes?: number;
  heartRateAvg?: number;
};
```

## `Pattern`

```ts
type Pattern = {
  id: string;
  type: 'meal' | 'fasting' | 'activity' | 'time_of_day' | 'insulin';
  description: string;
  frequency: number;                   // number of supporting observations
  confidenceScore: 'low' | 'medium' | 'high';
  relatedMealMemories: string[];       // MealMemory ids
  suggestedAction?: string;
  firstSeen: string;                   // ISO 8601
  lastSeen: string;                    // ISO 8601
};
```

## `Trend`

```ts
type Trend = {
  id: string;
  metric: 'morning_glucose' | 'time_in_range' | 'peak_after_meal' | 'variability' | string;
  direction: 'up' | 'down' | 'stable';
  timeframe: '7d' | '14d' | '30d' | '90d';
  significance: 'low' | 'medium' | 'high';
  summary: string;                     // one-line plain-language summary
};
```

## `SuggestedApproach`

```ts
type SuggestedApproach = {
  id: string;
  mealMemoryId: string;
  recommendation: string[];            // 1–3 evidence-phrased bullets
  evidenceCount: number;               // how many memories support this
  confidence: 'low' | 'medium' | 'high';
  recentTrendAdjustment?: string;      // optional note on recent trend
  supportReasoning: string;            // plain-language "why"
};
```

---

## Sample seed data

### Chipotle Bowl (occurrence 4 of 4)

```ts
const chipotleMemory4: MealMemory = {
  id: 'mm_chipotle_04',
  title: 'Chipotle Bowl',
  timestamp: '2026-04-18T12:40:00Z',
  estimatedCarbs: 100,
  linkedEntries: ['re_scr_0041', 're_cgm_slice_0041', 're_photo_0041'],
  glucoseCurve: [
    { t: '2026-04-18T12:40:00Z', mgdl: 110 },
    { t: '2026-04-18T13:10:00Z', mgdl: 138 },
    { t: '2026-04-18T13:40:00Z', mgdl: 167 },
    { t: '2026-04-18T14:05:00Z', mgdl: 182 },
    { t: '2026-04-18T15:30:00Z', mgdl: 154 },
    { t: '2026-04-18T16:20:00Z', mgdl: 132 },
  ],
  insulinDelivered: 1.2,
  insulinRecommended: 1.2,
  activityContext: { postPrandialWalkMinutes: 0 },
  tags: ['bowl', 'mexican', 'lunch'],
  outcomeSummary: 'Typical spike, returned to range in 3h 40m.',
  confidenceScore: 'high',
};
```

### Chipotle Bowl — improved version (20-min pre-bolus + 10-min walk)

```ts
const chipotleMemoryImproved: MealMemory = {
  id: 'mm_chipotle_05',
  title: 'Chipotle Bowl',
  timestamp: '2026-04-20T12:20:00Z',
  estimatedCarbs: 100,
  linkedEntries: ['re_scr_0050', 're_cgm_slice_0050'],
  glucoseCurve: [
    { t: '2026-04-20T12:20:00Z', mgdl: 108 },
    { t: '2026-04-20T12:50:00Z', mgdl: 124 },
    { t: '2026-04-20T13:20:00Z', mgdl: 148 },
    { t: '2026-04-20T13:45:00Z', mgdl: 154 },
    { t: '2026-04-20T14:30:00Z', mgdl: 128 },
    { t: '2026-04-20T15:00:00Z', mgdl: 114 },
  ],
  insulinDelivered: 1.2,
  insulinRecommended: 1.2,
  activityContext: { postPrandialWalkMinutes: 10 },
  tags: ['bowl', 'mexican', 'lunch', 'pre-bolus'],
  notes: '20 min pre-bolus. 10 min walk after.',
  outcomeSummary: 'Lower peak, returned to range in 2h 35m.',
  confidenceScore: 'high',
};
```

### Pattern — morning highs rising

```ts
const patternMorningHighs: Pattern = {
  id: 'p_morning_highs_01',
  type: 'time_of_day',
  description: 'Morning glucose is trending higher over the last 14 days.',
  frequency: 11,
  confidenceScore: 'medium',
  relatedMealMemories: [],
  suggestedAction: 'Consider reviewing overnight basal with your clinician.',
  firstSeen: '2026-04-07T00:00:00Z',
  lastSeen: '2026-04-20T00:00:00Z',
};
```

### Pattern — Chipotle meals improving

```ts
const patternChipotleImproving: Pattern = {
  id: 'p_chipotle_improving_01',
  type: 'meal',
  description: 'Chipotle bowls are showing lower peaks when pre-bolused.',
  frequency: 4,
  confidenceScore: 'high',
  relatedMealMemories: ['mm_chipotle_02', 'mm_chipotle_03', 'mm_chipotle_04', 'mm_chipotle_05'],
  suggestedAction: undefined,
  firstSeen: '2026-03-22T00:00:00Z',
  lastSeen: '2026-04-20T00:00:00Z',
};
```

### Suggested Approach — Chipotle Bowl

```ts
const suggestedChipotle: SuggestedApproach = {
  id: 'sa_chipotle_01',
  mealMemoryId: 'mm_chipotle_04',
  recommendation: [
    'Meals like this had better outcomes when insulin was delivered 15–20 minutes earlier.',
    'A short walk after eating was associated with faster return to range.',
  ],
  evidenceCount: 4,
  confidence: 'high',
  recentTrendAdjustment: 'Most recent occurrence (20-min pre-bolus) peaked 28 mg/dL lower.',
  supportReasoning:
    'Across 4 prior Chipotle bowls, peak glucose averaged 176 mg/dL. When insulin was delivered 15–20 min before the meal, peaks averaged 151 mg/dL and return-to-range was ~65 min faster.',
};
```

### Trend — time in range

```ts
const trendTimeInRange: Trend = {
  id: 't_tir_01',
  metric: 'time_in_range',
  direction: 'up',
  timeframe: '30d',
  significance: 'medium',
  summary: 'Time in range is up 6 points over the last 30 days.',
};
```

---

## Storage approach (prototype)

For the portfolio prototype, all data is in-memory with seed modules:

```
/src/data/
  ├── rawEntries.ts
  ├── mealMemories.ts
  ├── patterns.ts
  ├── trends.ts
  └── suggestedApproaches.ts
```

No backend required for the prototype. When we move to real, we'll swap the in-memory stores for a local-first store (SQLite or IndexedDB) before any server sync.
