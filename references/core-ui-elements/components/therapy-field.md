# Therapy field

`Profile → ClinicalSettings → TherapyField`. A numeric therapy value the user
types, which feeds the suggestion engine.

## When to use

Any value that (a) the user must be able to correct, and (b) changes what
LoopStack computes. Currently: target low/high, base ISF, carb ratio, insulin
duration.

## When not to use

- Derived values. Observed ISF stays read-only with its confidence ring — it is
  measured, not set.
- Anything that would write to Loop. LoopStack never does; the Fix Log is the
  only route to a real therapy change, and the section copy says so.

## Commit model

**Commit on blur, not on keystroke.** Typing "120" passes through "1" and "12";
validating those mid-entry fights the user with an error per character.

```
onChange  → hold as draft string
onBlur    → parse, validate, accept or reject
accepted  → clear draft, field re-renders the stored value
rejected  → keep draft, show error, do not persist
```

Drafts are strings, not numbers. A half-typed value is not a number yet.

## Validation

Lives in `src/data/loopTherapyStore.ts`, not the component — the same rules must
hold for any future import path. Each field has `{ min, max, step, unit, label }`.

Target low and high are the one pair that constrain each other: at least
`MIN_TARGET_SPREAD` (10 mg/dL) apart, checked whichever of the two was edited.
An inverted or hairline range would silently break every in-range calculation
downstream.

## States

| State | Treatment |
|---|---|
| Default | `--ink-200` border |
| Focus | `--brand-primary` border + inherited ring |
| Error | `--range-low` border, message below, `aria-invalid`, `aria-describedby` |
| Edited (section level) | "Reset to defaults" appears |

## Responsive

Target low/high sit in one row and stay there at 320px — two `flex: 1` fields
with `min-width: 0`. The `–` separator is `padding-top: 34px` to sit on the
input row rather than the label above it.

## Implementation notes

- `type="number"` + `inputMode="decimal"` — numeric keypad on iOS, and the
  step/min/max are also announced.
- Persisted to `localStorage` and layered over the profile default by
  `applyTherapyOverrides`. Derived fields survive the merge.
- `storage` failures are swallowed: the edit still applies for the session
  rather than taking the screen down.
