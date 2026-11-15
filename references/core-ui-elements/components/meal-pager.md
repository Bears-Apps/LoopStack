# Meal pager

`LatestMealCard` → `MealPagerBar`. Steps backwards through the recent meal
traces so the card is a short history, not only "the newest thing that happened".

Requested from TestFlight: "Need a way to scan past recent meals to past 3-5."

## When to use

- A card shows the newest item of an ordered series and the previous few are
  equally interesting.
- The series is short and bounded (`RECENT_MEAL_COUNT = 5`).

## When not to use

- More than ~7 items — that is a list screen, not a pager. Meal history beyond
  the last few belongs on Memories.
- Items that are not ordered, or where the user needs to compare two at once.
- As a substitute for filtering or search.

## Anatomy

```
[ ‹ Older ]   3 of 5   [ Newer › ]
```

The card's kicker changes with position: `Latest meal` → `Previous meal` →
`N meals ago`. That, not the pager, is what tells the user where they are; the
pager is the control.

## Visual language

Inherits the `TimeRangeSelector .track` recipe — `--surface-1` field, hairline
`--ink-200` border, 3px inset, pill radius — so the two read as one family.

It is **not** a segmented control. The ends are actions, not selectable
segments, so they get no `segActive` treatment.

## States

| State | Treatment |
|---|---|
| Default | `--ink-700`, weight 600 |
| Hover | `--surface-0` fill, `--ink-900` |
| Focus | inherited `:focus-visible` ring |
| Disabled (at either end) | `--ink-300`, weight drops to 500, `disabled` |
| Single item | the whole bar is not rendered (`count > 1`) |

## Responsive

One row at every width. `min-width: 88px` on the buttons reserves the tap target
so the row does not reflow as the ends of the history are reached. `min-height:
var(--tap-target-min)`.

## Implementation notes

- "Older" advances the index; "Newer" decreases it. Index 0 is newest.
- The count readout is `aria-live="polite"` — position changes without focus
  moving, so it must be announced.
- The owner clamps the index: `Math.min(index, meals.length - 1)`. A refresh can
  shorten the history underneath the current position.
- The pager is presentational. `RecentMeals` in `TrendsHome` owns the index and
  the data-source fallback.
