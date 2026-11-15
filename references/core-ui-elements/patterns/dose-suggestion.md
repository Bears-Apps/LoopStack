# Dose suggestion (Get strategy)

`CaptureFlow → StrategyCard`, computed by `src/lib/metabolism/mealStrategy.ts`.

The highest-consequence surface in the app. Everything below is a safety
constraint before it is a design one.

## What it computes

- Dose size — **net** carbs (total − fiber) ÷ the user's carb ratio.
- The upfront / extended split.
- How long the extended tail runs, and the absorption window to hand Loop.

## What it must never compute

| Excluded | Why |
|---|---|
| A correction for current glucose | Needs insulin-on-board, which LoopStack does not track. Stacking a correction on Loop's own is the most dangerous thing this screen could do. |
| A dose cut for planned exercise | Real, but depends on intensity and timing the builder does not capture. Surfaced as a split shift and a written caution, never a silent cut. |

If a future change adds either, it needs IOB and a clinician review, not a
threshold.

## Why net carbs

Fiber is carbohydrate by label and is not absorbed as glucose. On this diet —
legumes, whole grains, chia — fiber routinely runs 15–25% of total carbs, so
dosing on total systematically over-doses. The card **shows the subtraction**
(`76g carbs minus 16g fiber = 60g net`) rather than presenting a net figure
that looks unexplained.

## Fat moves timing, never dose

Fat does not raise glucose but slows gastric emptying. It shifts the split
toward extended and lengthens the window. It must never change `totalUnits`.

## Required framing

The card carries a persistent, non-dismissible safety block:

> **Estimate — check before you dose.** This covers the food only: no
> correction for your current glucose and no insulin-on-board, both of which
> Loop already handles. Nutrition figures are reference averages, not
> measurements of your plate.

Rules:

- Confidence is capped at `medium`. The model has never been scored against
  outcomes, so `high` would be a lie. There is a test asserting this.
- Anything the builder could not put a number on is **named** in the reasoning,
  with "The real total is higher." Silently dropping the free-text field
  produces a confident dose for half a meal.
- "Copy to Loop" copies text. It does not write to Loop and never will.

## States

| State | Treatment |
|---|---|
| Nothing measurable in the builder | Button disabled + "Pick at least one ingredient with an amount" |
| Generated | Card renders above the button; button becomes "Recalculate strategy" |
| Builder edited after generating | Strategy is **cleared**. A stale dose beside changed ingredients is worse than no dose. |
| Flow or context switched | Cleared, same reason |
| Small meal (< 12g net) | Single upfront dose, no split — below the pump's useful resolution |

## Nutrition table

`src/screens/CaptureFlow/MealBuilder/nutrition.ts`. USDA per-100g figures for
the cooked form, converted to the builder's portions. Keys match the builder's
option labels **exactly** — a rename in `mealOptions.ts` silently zeroes an
ingredient, so `mealDraft.test.ts` asserts every builder option has a row.

## When not to reuse this

Do not reuse `StrategyCard` for a retrospective figure. It is styled and worded
for a decision the user is about to make. Past meals use `LatestMealCard`.
