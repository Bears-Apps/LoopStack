# Components

Reusable component inventory. Each component has one job, consistent props, and shared tokens from [brand.md](brand.md).

---

## Layout & navigation

### `AppHeader`
Props: `title?`, `showBack?`, `rightAction?`
- Tab roots: wordmark left, optional action right.
- Pushed screens: back chevron, centered title.

### `BottomNav`
Props: `active: 'trends' | 'memories' | 'patterns' | 'profile'`
- Four tabs + floating center capture button.
- Center button is brand primary.

---

## Graphs

### `GlucoseGraph`
Props: `readings[]`, `rangeMin`, `rangeMax`, `events?[]`, `height`
- Smooth line, 2px, brand primary by default.
- Y-axis labels right-aligned, tabular figures.
- Scrub interaction with haptic tick on iOS.

### `TargetRangeBand`
Props: `low`, `high` (default 70, 180)
- Horizontal band, `--range-band` fill at 10% opacity.
- Renders inside any graph that accepts an overlay.

### `EventMarker`
Props: `type: 'meal' | 'insulin' | 'activity' | 'note'`, `timestamp`, `label?`
- Tiny glyph on the x-axis.
- Tap opens a popover with the raw event.

### `ComparisonGraph`
Props: `series[]` (each with id, color, readings[]), `alignTo: 'meal_start' | 'clock'`
- Default alignment is `meal_start`.
- Legend of chips below graph.

### `TimelineChart`
Props: `metrics[]`, `range: '7d' | '14d' | '30d' | '90d'`
- Stacked mini-charts, one per metric.
- No axis labels at small sizes; full labels at 90d.

---

## Cards

### `OutcomeSummaryCard`
Props: `carbs`, `insulin`, `peak`, `timeToPeak`, `returnToRange`, `phrase`
- Chip row + one-line narrative outcome.

### `InsightCard`
Props: `headline`, `confidence`, `evidenceCount`, `onTap?`
- One headline, one confidence badge, one evidence count.
- Brand primary accent strip on the left.

### `ConfidenceBadge`
Props: `level: 'low' | 'medium' | 'high'`, `evidenceCount?`
- Filled pill, uses `--brand-primary-soft` bg and `--brand-primary` text for high.
- Medium uses neutral; low uses outline only.

### `MealMemoryHeader`
Props: `title`, `photoUrl?`, `occurrenceCount`, `lastEaten`
- Photo left (or generated thumbnail), title + count right.

### `CarbAbsorptionCard`
Props: `estimatedCarbs`, `observedEquivalent`, `durationMinutes`
- Dual value display + small horizontal bar visualization.

### `InsulinSummaryCard`
Props: `recommended`, `delivered`, `activePeak`, `peakTimeMinutes`
- Compact stat grid.

### `ComparisonSummaryCard`
Props: `memoryId`, `color`, `peak`, `timeToPeak`, `returnToRange`, `carbs`, `insulin`
- Color dot matches its curve in `ComparisonGraph`.

### `SuggestedApproachCard`
Props: `recommendations[]`, `confidence`, `evidenceCount`, `onCompare`, `onViewWhy`
- 1–3 bullets, two CTAs.

### `PatternCard`
Props: `title`, `direction: 'up' | 'down' | 'stable'`, `confidence`, `miniChart`, `onTap`
- Title + direction chevron + mini chart.

### `RecentMealCard`
Props: `mealName`, `outcomeChip`, `peak`, `photoUrl?`, `onTap`
- Horizontal-scrolling card, ~140px wide.

### `ExportSummaryCard`
Props: `title`, `body`, `onExport`
- Print-safe version renders without shadows or rounded corners.

---

## Primitives

### `Chip`
Props: `label`, `tone?: 'neutral' | 'brand' | 'range-in' | 'range-high' | 'range-low'`
- 999 radius, 12px label.

### `Button`
Props: `variant: 'primary' | 'secondary' | 'ghost'`, `size: 'sm' | 'md' | 'lg'`
- Primary is brand; secondary is ink outline; ghost is text-only.

### `Sheet` (modal)
Props: `open`, `onClose`, `title?`
- Drag-to-dismiss. 16px radius top corners.

---

## Component composition map

```
Trends Home
├── AppHeader
├── GlucoseGraph + TargetRangeBand + EventMarker(s)
├── InsightCard × 1
├── RecentMealCard × N (carousel)
├── PatternCard × 2–3
└── BottomNav

Meal Memory Detail
├── AppHeader (back)
├── MealMemoryHeader
├── OutcomeSummaryCard
├── GlucoseGraph + TargetRangeBand + EventMarker(s)
├── CarbAbsorptionCard
├── InsulinSummaryCard
├── InsightCard
├── SuggestedApproachCard
├── (compare strip of RecentMealCards)
└── BottomNav

Compare Meals
├── AppHeader (back)
├── Chip selector row
├── ComparisonGraph
├── ComparisonSummaryCard × 2–4
├── InsightCard × N (deltas)
└── BottomNav

Pattern Timeline
├── AppHeader
├── Segmented range selector
├── TimelineChart
├── PatternCard × N (feed)
└── BottomNav

Doctor Summary
├── AppHeader (back)
├── ExportSummaryCard (top-line)
├── PatternCard × 3
├── InsightCard × N (trend observations)
├── RecentMealCard × 3–5
└── BottomNav
```
