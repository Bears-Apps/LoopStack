# Interaction baseline

Applies to every control in the app. Defined once in `src/styles/reset.css` and
`src/styles/tokens.css` so components inherit it instead of re-deciding.

## Focus

`reset.css` strips `button { border: 0; background: none }`, which removes the
affordance browsers lean on. The app therefore draws its own ring:

```css
:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
  border-radius: var(--radius-input);
}
```

- `:focus-visible`, never `:focus` — the ring is for keyboard and iOS Switch
  Control users, and must not flash on every touch.
- Do not set `outline: none` on a component. If a control needs a different
  ring, override the tokens for that control, keep a visible ring.
- Inputs may add a `:focus` border colour **in addition to** the ring, as
  `.therapyInput` does. That is a fill affordance, not a replacement.

## Reduced motion

Every transition in LoopStack is feedback on a state change — none of it
carries information on its own. So all of it collapses under
`prefers-reduced-motion: reduce` in `reset.css`.

**When not to rely on this:** if you ever add motion that *is* the information
(a value animating between two readings), it needs a static equivalent, not a
global duration override.

## Tap targets

`--tap-target-min: 44px` (iOS HIG). Any control the user taps should reach it
via `min-height` or padding.

Known debt: `TimeRangeSelector .seg` and `LatestMealCard .ghostBtn` sit at
~34px. They predate this rule. Do not copy them; fix them when next touched.

## Colour is never the only state signal

Every state pairs colour with text, weight, icon, or position:

| Surface | Colour | Second signal |
|---|---|---|
| Pager, at end of history | `--ink-300` | `disabled`, weight drops to 500, label unreachable |
| Stacked-meal verdict | green / amber | the words "Clear driver" / "Ambiguous" |
| Dominant meal chip | inverted fill | weight 600 + the explicit `%` |
| Therapy field error | `--range-low` | `role="alert"` message + `aria-invalid` |
| Meal alignment row | status tint | icon + status title + summary sentence |

This matters more than usual here: `--brand-primary` is deliberately the same
green as `--range-in`, so green alone is ambiguous between "this is the action"
and "this glucose is in range".

## Checklist for a new control

- [ ] Reaches `--tap-target-min`.
- [ ] Visible `:focus-visible` ring (inherited is fine).
- [ ] Disabled state readable without colour.
- [ ] `aria-label` when the visible label is an icon or a glyph.
- [ ] `aria-live` on any value that changes without the user moving focus
      (the pager's "3 of 5" readout does this).
