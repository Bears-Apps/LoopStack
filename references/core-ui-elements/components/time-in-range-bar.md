# Time in range bar

`TimeInRangeBar`, fed by `computeMetrics`.

## The bands are personal, the extremes are not

| Band | Boundary | Moves with the user's target? |
|---|---|---|
| Very low | under 54 | **No** — clinical consensus (AGP) |
| Low | 54 → target low | Upper edge moves |
| In range | target low → target high | **Yes** |
| High | target high → 250 | Lower edge moves |
| Very high | over 250 | **No** — clinical consensus |

Severe hypo and severe hyper are safety thresholds, not preferences. A user
setting a 80–160 target is saying what *good* looks like for them; they are not
redefining what a dangerous low is.

Setting 80–160 means a reading of 75 is time spent low **for this user**, even
though the consensus band would call it in range. That is the point.

## Guard rails

`bandsFor` clamps so a target outside the severe thresholds cannot invert a
band:

- target low below 54 → the low band collapses to zero width, not negative
- target high above 250 → very-high starts at the target instead

Both are covered by tests, including that the five bands always sum to 100.

## Labelling

The component takes `targetLowMgdl` / `targetHighMgdl` and renders them. It must
never hardcode "70–180" — labelling one range while the percentages were counted
against another is the single failure this component exists to avoid. Each
legend row also carries its numeric threshold, so "Low" is falsifiable.

## Where the target comes from

`Profile → Targets` → `localStorage` → `loadTargetRange()` inside the data
source → `MetricsInputs.targetRange`. Sources run outside React, so **Profile
calls `refresh()` after a save** — without that the dashboard keeps last read's
boundaries.

## Deliberately NOT tied to the target

`glucoseStatus.ts` keeps its own thresholds (low 70, elevated 100, urgent-high
120). That is an **alerting envelope**, deliberately tighter than the TIR
target, and a hypo-alert threshold should not move as a side effect of a
display preference. If these are ever unified it should be a considered change
with its own reasoning, not drift.
