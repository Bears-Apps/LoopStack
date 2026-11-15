# Screens

Screen-by-screen specification. Each screen lists: purpose, structure, key components, and data.

---

## 1. Trends Home

**Tab root.** The app's front door. A living metabolic dashboard, not an inbox.

### Structure (top to bottom)

1. **App header** — LoopStack wordmark left (`Loop` in brand green, `Stack` in ink-900), date right.
2. **Current glucose hero**
   - Large number + unit (`142 mg/dL`)
   - Trend arrow + rate of change
   - Time since last reading
3. **Glucose graph (last 6h)**
   - `GlucoseGraph` component
   - `TargetRangeBand` overlay (70–180 default)
   - `EventMarker`s for meals, insulin, activity
   - Tap-and-hold for scrubbing
4. **Key insight card** — the single most important thing today
   - Headline · confidence badge · evidence count
   - Tap → pattern or memory detail
5. **Recent meal impact carousel** — horizontal scroll
   - `RecentMealCard`s — meal name, outcome chip, peak value, tap to open memory
6. **Pattern cards** — 2–3 active patterns
   - Direction indicator (rising / falling / stable)
   - Mini chart, confidence badge
7. **Prepare for visit** CTA (contextual, shown if appointment in next 7 days or manually triggered)

### Components used
`AppHeader`, `GlucoseGraph`, `TargetRangeBand`, `EventMarker`, `InsightCard`, `ConfidenceBadge`, `RecentMealCard`, `PatternCard`, `BottomNav`

---

## 2. Meal Memory Detail

**Pushed from:** Memory list, Trends Home recent meal, Capture flow save, Pattern detail related memory.

### Structure

1. **MealMemoryHeader**
   - Meal photo (or generated thumbnail)
   - Meal name
   - Subtitle: "4th time · last eaten 2 days ago"
2. **OutcomeSummaryCard**
   - Chip row: carbs, insulin delivered, peak glucose, time-to-peak, return-to-range
   - Outcome phrase: "Typical spike, returned to range in 3h 40m"
3. **Hero glucose graph**
   - `GlucoseGraph` of this occurrence
   - Meal start marker, insulin marker, activity overlay
4. **CarbAbsorptionCard**
   - Estimated carbs vs observed absorption equivalent
   - Absorption duration
   - Visual: dual bar / dual curve
5. **InsulinSummaryCard**
   - Recommended vs delivered
   - Active insulin peak, timing
6. **AI insight card (InsightCard)**
   - "Delayed glucose spike occurs 2–3 hours after similar meals."
   - Confidence badge, evidence count
7. **SuggestedApproachCard**
   - Recommendation bullets (evidence-based phrasing)
   - [Compare similar meals] [View why]
8. **Compare section** — horizontal row of prior occurrences → Compare Meals
9. **Notes section** — free text, timestamped
10. **Similar meals** — tag-matched rows

### Components used
`MealMemoryHeader`, `OutcomeSummaryCard`, `GlucoseGraph`, `TargetRangeBand`, `EventMarker`, `CarbAbsorptionCard`, `InsulinSummaryCard`, `InsightCard`, `ConfidenceBadge`, `SuggestedApproachCard`

---

## 3. Compare Meals

**Pushed from:** Meal Memory Detail compare section.

### Structure

1. **Selector bar** — 2 to 4 memory chips, reorderable.
2. **Overlay graph** — `ComparisonGraph`
   - All curves **aligned to meal start time**, not clock time
   - Each curve color-coded to its chip
   - Target range band shared
3. **Summary cards row** — one `ComparisonSummaryCard` per memory
   - Peak, time-to-peak, return-to-range, carbs, insulin
4. **Delta insights**
   - "Pre-bolus reduced peak by 28 mg/dL"
   - "10-min walk reduced return-to-range by 65 min"
5. **Context comparison table**
   - Carbs · insulin · pre-bolus time · activity · time of day · sleep
6. **CTA row**
   - "Save as preferred version" · "Export summary"

### Components used
`ComparisonGraph`, `ComparisonSummaryCard`, `InsightCard`, `ConfidenceBadge`

---

## 4. Suggested Approach

**Appears as:** card inside Meal Memory Detail, and as full sheet on "View why."

### Card structure

- Header: "Suggested approach"
- 1–3 recommendation bullets, evidence-based phrasing:
  - "Meals like this had better outcomes when insulin was delivered 15–20 minutes earlier."
  - "A short walk after eating was associated with faster return to range."
- `ConfidenceBadge` + evidence count ("Based on 4 occurrences")
- [Compare similar meals] [View why]

### Full sheet ("View why")

- Reasoning summary in plain language
- List of evidence entries (meal memories) that support the suggestion
- Each evidence entry is tappable to its detail

### Phrasing rules (non-negotiable)
- Never prescribe a dose.
- Never use "should" — use "meals like this had better outcomes when…"
- Always attribute to observed data — "based on 4 similar meals."

### Components used
`SuggestedApproachCard`, `ConfidenceBadge`, `InsightCard`

---

## 5. Pattern Timeline

**Tab root.**

### Structure

1. **Range selector** — segmented: 7d · 14d · 30d · 90d
2. **Headline summary banner**
   - e.g. "3 patterns shifted this month. Mornings are rising; dinners are improving."
3. **TimelineChart** — a stacked mini-chart showing multiple metrics over the range
4. **Timeline feed** — vertical list of `PatternCard`s in chronological order
   - Direction indicator (↑ rising / ↓ falling / → stable)
   - Mini chart
   - Confidence badge
   - Tap → Pattern detail
5. **Pattern detail (pushed)**
   - Full explanation
   - Supporting memories
   - First seen / last seen dates
   - `SuggestedApproachCard` if applicable

### Example pattern types
- Morning highs rising
- Pizza spikes recurring
- Dinner meals with activity improving
- Lower sleep linked to more variability

### Components used
`TimelineChart`, `PatternCard`, `ConfidenceBadge`, `InsightCard`, `SuggestedApproachCard`

---

## 6. Capture Flow

**Entered from:** center `+` button in bottom nav, or iOS/Android share sheet.

### Steps

1. **Chooser sheet** — Import screenshot · Take meal photo · Connect data · Manual add
2. **Classification step** (AI)
   - Shows detected context: "Detected: Chipotle Bowl (seen 3 times before)"
   - Estimated carbs, linked glucose slice, insulin context
   - [Looks right] [Edit]
3. **Review step**
   - Full preview of the meal memory being created
   - Edit any field inline
4. **Save** → pushes to Meal Memory Detail

### Key principle
AI is shown as embedded classification, not a chat. There is no conversation UI here.

---

## 7. Doctor Summary / Export

**Pushed from:** Profile tab → "Prepare for visit." Or contextual CTA on Trends Home.

### Structure

1. **Header** — patient name + date range
2. **Top-line summary** — 2–3 sentences, plain language
3. **Key repeated patterns** — top 3 with confidence, frequency, example memory
4. **Trend observations** — what's changed over the range
5. **Example meals** — 3–5 most instructive meal memories, compact cards
6. **Patient notes section** — free text Maya can fill in before the visit
7. **Export row** — [Export PDF] [Copy shareable link] [Email to doctor]

### Printable view
- Same content, reformatted for letter-size paper
- No app chrome

### Components used
`ExportSummaryCard`, `PatternCard`, `InsightCard`, `ConfidenceBadge`
