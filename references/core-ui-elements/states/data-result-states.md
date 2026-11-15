# Data-result states

Every source-backed surface reads a `DataResult<T>` and must handle four
outcomes. Getting this wrong is how a product starts asserting sample data as
fact.

```ts
type DataResult<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  lastUpdatedIso: string | null;
  isStale: boolean;
  origin?: 'sample' | 'computed';
};
```

## The ladder

| Condition | Treatment |
|---|---|
| `loading` and no data | `SectionSkeleton` naming what is being computed — "Computing metrics from your health data…", not a spinner |
| `error` | the error's own message, which sources write to be actionable (CORS hint, "needs iOS", "no URL configured") |
| no data, not loading | an empty state naming the **real dependency** — "Closed-loop tracking needs the Nightscout source — Loop posts its status there, not to Apple Health." |
| data, `origin !== 'computed'` | `SampleTag` / `SampleNote` |
| data, `origin === 'computed'` | confidence ring or "Measured" badge |

## The disclosure rule

`isSample()` returns true unless the source **explicitly** claims `'computed'`.
The honest default is to disclose. Never let a surface imply real data because
a field happened to be populated.

Sample data never carries a confidence claim. Where computed data shows a
`ConfidenceRing`, sample data shows `SampleTag` in the same slot — never a ring
with an invented score.

## Empty states must name the dependency

Bad: "No data yet."
Good: "No glucose history yet — metrics appear once Apple Health has readings to
compute from."

The user can act on the second one.

## Fallback across fields

`RecentMeals` shows the shape: prefer `recentMeals`, fall back to `latestMeal`
for a source that only publishes one trace, and take the origin from whichever
was used. Do not merge origins — a computed list next to a sample single would
otherwise silently upgrade the sample.

## Staleness

Separate from loading. `isStale` means the data arrived but is old; the glucose
hero shows the value *and* a "Stale" tag rather than hiding it. Never suppress a
real reading because it aged.
