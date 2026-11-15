# CSS module cascade traps

## The bug that shipped

TestFlight report: "Bug here where amount selection de-selects." The tap
registered and state updated correctly. The selected style never rendered.

`primitives.module.css` had:

```css
.chipActive { background: var(--ink-900); color: var(--surface-0); }  /* line 97  */
.amountChip { background: var(--surface-0); color: var(--ink-700); }  /* line 115 */
```

Applied as `className={`${styles.amountChip} ${active ? styles.chipActive : ''}`}`.

Both are single-class selectors, so **specificity ties and source order wins**.
`.amountChip` is declared later, so it reset the selected chip straight back to
the unselected pill. Ingredient chips were fine only because `.ingredientChip`
happened to be declared *before* `.chipActive`.

The class order in the `className` string is irrelevant. Only stylesheet order
matters.

## The fix

Compound the state selector so it cannot tie:

```css
.ingredientChip.chipActive,
.amountChip.chipActive {
  background: var(--ink-900);
  border-color: var(--ink-900);
  color: var(--surface-0);
}
```

## Rules

1. **A state class must out-specify every base it can be applied to.** Write
   `.base.state`, not a bare `.state`.
2. **Declare state after base**, as a second line of defence.
3. **A shared state class is a liability.** `.chipActive` was shared by three
   pickers with two different bases. Either compound it against each base (as
   above) or give each base its own state class.
4. Same rule for `:hover` overrides — `.chipActive:hover` must also be
   compounded, or the base hover wins on re-entry.

## How to catch it

Toggling a selected state in devtools and seeing the rule **present but struck
through** is the signature. If state is correct in React DevTools but the pixel
is wrong, suspect the cascade before suspecting the handler.
