# Insulin ledger (micro-dose accounting)

`src/lib/metabolism/insulinLedger.ts` → `InsulinLedgerCard` (hourly chart) +
two derived tiles on Trends. Inspired by Gluroo's daily insulin accounting.

## The idea

Loop delivers insulin as a stream of tiny automatic doses — a temp basal every
~5 min plus the occasional auto-bolus. Individually they're noise; accumulated
they answer two questions a single "total insulin" number can't:

1. **When** did the day's insulin actually go in? → hourly chart.
2. **What carb ratio did the body actually run at?** → back it out from delivered
   totals rather than the scheduled setting.

## Three figures, all rear-view (never a dose)

| Figure | Formula | Where |
|---|---|---|
| Hourly accumulation | sum micro-doses per hour, basal vs bolus apart | `InsulinLedgerCard`, today |
| Xtra insulin | total delivered − scheduled daily basal (14.82U) | Therapy tile, range-aware |
| Observed carb ratio | carbs ÷ xtra insulin (g/U) | Therapy tile, range-aware |

"Xtra" is the insulin the day needed **beyond baseline** — what covered food and
corrections. The observed ratio is what that xtra actually accompanied, in g/U.

## Why the split of concerns

- **Tiles are range-aware**, computed in `TrendsHome` from the existing
  per-range `metrics` (`totalInsulin`, `carbs`) + the scheduled-basal constant,
  via the pure, tested `observedRatio()`. Selecting "Today" gives today; "7d"
  gives a stable read — a single day's observed ratio is very noisy.
- **The hourly chart is today-only**, from a dedicated since-midnight insulin
  read bucketed by `bucketInsulinByHour()`.

## Honesty guards (all tested)

- `observedRatio` returns **null** when xtra < 1U or carbs = 0 — a day at or
  below baseline basal has no meal-insulin denominator; under ~1U is division
  noise. The tile hides rather than printing a garbage number.
- The observed ratio lumps meal boluses with correction boluses, so it reads a
  little stronger (more g/U) than a pure meal ratio. Stated on the tile
  (`carbs ÷ xtra insulin`), never presented as a settable carb ratio.
- This never suggests a dose or a setting. It reports what was delivered.

## Source availability

| Source | hasBasal | Result |
|---|---|---|
| Apple Health | yes | full ledger; `aggregateInsulinByDay` gives real delivered basal |
| Nightscout | **no** | bolus-only — hourly chart shows bolus spikes; xtra/ratio **hidden** |
| Mock | yes | synthesized day, disclosed as sample |

The Nightscout gate matters: xtra insulin against a bolus-only total would be
`bolus − 14.82`, badly negative and meaningless. Hidden, not faked.

## Colour

Basal = `--ink-300` (neutral background insulin), bolus = `--graph-insulin`
(the active-insulin orange). Stacked, basal under bolus. Not the brand green,
not the new azure — insulin has its own graph colour.

## Data cost

The since-midnight insulin read can return ~300 events (a temp basal every
5 min = 288/day + boluses), deduped by `dedupeInsulinEvents`. Limit 2000. Uses
the existing `HealthDiabetes.readInsulin` — no native change, just a wider
window than the 8h recent read.
