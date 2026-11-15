# Shared-response attribution

How the UI reports that a glucose curve belongs to more than one meal.

Engine: `src/lib/metabolism/mealOverlap.ts`. UI: `LatestMealCard →
SharedResponseRow`, plus the alignment summary and reasoning list.

## The problem it solves

The engine reads the glucose curve after a meal and scores that meal on it. When
a second meal lands before the first finished absorbing, the curve belongs to
both — but the newest carb entry was being charged for all of it. A 15 g snack
two hours into a 120 g dinner inherited the dinner's whole tail and looked like a
monster; the dinner, judged only until the snack arrived, looked tame. Both bad
readings then fed favourites and confidence.

## The rule

Split the response between meals that were clearly on board together, and point
the split at the **bigger, longer** meal — the one actually driving the curve.
Weight is carb mass × absorption duration, normalised across the stack.

## When to show it

Only when `attribution.stacked` is true. A meal that absorbed alone gets weight
1 and no row — silence is the correct treatment for the normal case.

## Confidence language (Mode C, non-negotiable)

The row must read as **a limit on the evidence**, never as a finding.

| Situation | Copy |
|---|---|
| Dominant, but shared | "Another meal was still absorbing, so this reads as partial evidence." |
| Not dominant | "Another meal was still absorbing and carried most of this response — not scored against this entry." |
| No clear driver | "…on board together with no clear driver — the response is split 50% / 50% and scored as weak evidence for all of them." |

Never write "this meal caused", never imply the split is measured. It is a
model of which meal the response is *read against*.

## Anatomy

```
DROVE A SHARED RESPONSE          88% attributed here
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░
96g over 5h was still absorbing when 18g landed — 88% of
the response is read against the 96g meal.
```

Label + percentage + bar + sentence. The bar is `--ink-300` on `--surface-2`,
deliberately neutral: this is not a good or bad outcome, so it must not borrow
the semantic range colours sitting directly above it in the alignment row.

## Downstream effects to keep consistent

Attribution is not only a card decoration. It also:

- excludes occurrences below `CLEAN_ATTRIBUTION` (0.6) from a favourite's shape
  and outcome read,
- reduces the repetition term in the confidence score,
- and changes the driver label to "3 clean of 5 occurrences".

If the UI ever shows an attribution weight that the scoring ignores, one of the
two is wrong.

## When not to use

Do not reuse this bar for ordinary proportions (basal/bolus split, macro
breakdown). It specifically means "this reading is shared, trust it less".
`InsulinSplit` is the pattern for a plain proportion.
