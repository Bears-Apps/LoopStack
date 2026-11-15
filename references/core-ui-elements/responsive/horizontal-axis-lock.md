# Horizontal axis lock

LoopStack is a fixed-width phone column (`--app-max-width: 440px`, centred).
Any sideways movement is either a layout overflow or WKWebView rubber-band, and
both read to the user as the whole UI drifting under their thumb. Reported from
TestFlight as "the app doesn't seem to be locked horizontally leading to left
and right ux drift on all screens".

## The lock

In `src/styles/reset.css`:

```css
html, body, #root {
  width: 100%;
  max-width: 100%;
  overflow-x: clip;
  overscroll-behavior-x: none;
}
body { touch-action: pan-y pinch-zoom; }
```

Three independent defences, on purpose:

| Declaration | Stops |
|---|---|
| `max-width: 100%` | the element itself exceeding the viewport |
| `overflow-x: clip` | a child painting outside it |
| `overscroll-behavior-x: none` | rubber-band past the scroll boundary |
| `touch-action: pan-y pinch-zoom` | the horizontal pan gesture existing at all |

### Why `clip` and not `hidden`

`overflow-x: hidden` forces `overflow-y` to compute to `auto`, turning the
element into a **scroll container**. That has two consequences: `position:
sticky` descendants then resolve against it, and the element joins the scroll
chain. `clip` contains overflow without either side effect.

`.app-container` is the deliberate exception — it is still `hidden`. Changing it
to `clip` would make every `AppHeader` start sticking, because today they
resolve against a container that never scrolls. That is a real improvement and a
real visual change; it belongs in its own change, not smuggled into a drift fix.

## Flex children

`.screen` is a flex column, and a flex item's default `min-width` is `auto` — so
one wide child (a long unbroken string, a chip row, an SVG) can push the column
past the viewport and reintroduce the drift the lock just removed:

```css
.screen, .screen > * { min-width: 0; max-width: 100%; }
```

## Opting a surface back in

A deliberate horizontal carousel must re-enable the gesture the global rule
removed, and contain its own over-scroll so it does not chain to the page:

```css
.scrollRow {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  touch-action: pan-x;
}
```

Currently the only such surface is `MemoriesList .scrollRow`.

## When not to use this

Do not apply the lock to a future tablet or desktop layout with genuine
horizontal panning regions. Scope it to the phone column if that arrives.

## Verify at

320, 375, 424, and 440px. The page body must never scroll horizontally; wide
content scrolls inside its own container.
