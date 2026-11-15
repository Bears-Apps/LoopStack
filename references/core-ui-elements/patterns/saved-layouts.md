# Saved desktop layouts and appearance

Use the dashboard's **Layouts & appearance** control for named arrangements.
Do not use layout persistence for patient data, connections, therapy values or
the care-team report structure. This extends the existing desktop dashboard,
not the phone app's navigation.

The design read is an operational desktop workspace in LoopStack's calm
data-product mode. Variance 4, motion 1, density 7, system rigor 9.
The established buttons, field shapes, Inter type and semantic tokens remain.

## Interaction

- Light, Dark and System apply immediately. System listens for OS changes.
- Save as new captures the current view. Names are unique, 1–60 characters.
  There is no two-layout limit.
- Switching applies widget visibility, order, dimensions and supported hour-view
  preferences together with appearance. Layouts do not change the data source.
- Arrange/edit actions update the working view, not the saved snapshot.
  Update saved layout replaces that snapshot. Revert changes restores it.
- Rename changes the name only. Delete requires confirmation and keeps the
  current widgets as an unnamed working view.
- Reset restores the everyday working view and System appearance, keeping
  named layouts. Existing built-in starting presets also remain available.

## Persistence and migration

`desktop/src/layout/saved.ts` owns `loopstack.desktop.views.v1`. It stores a
working view, active ID and named snapshots. An explicit allowlist includes
only tile IDs, widths/heights, preset identifier, appearance, and the existing
What Loop did hour/block mode and selected column. Transient detail panels,
patients, raw readings, care messages, source URLs, keys and therapy do not enter
this store. Currently no other per-widget settings exist in the layout model.

On first launch without the new key, the existing
`loopstack.desktop.layout.v1` layout is normalized and preserved. Its old key
is not removed. Unknown/retired and duplicate tiles are skipped, minimum sizes
are applied, and mandatory daily heads-ups/day-tracker tiles stay present.
Malformed storage falls back safely. Failed writes display a persistent warning
that the session's changes will not survive restart.

## States and accessibility

Empty list, dirty saved view, duplicate/empty name, storage failure and delete
confirmation each have explicit text. Native inputs/selects and real buttons
retain focus rings and minimum 44px hit targets. A status region announces
save, apply, rename and delete. No new motion is introduced.

The panel is inline below the toolbar so the canvas stays in context, with
bounded vertical scrolling in short windows. Fields use three columns, then
two at narrow desktop width. The desktop app retains its existing 1024px
minimum; this feature does not claim a phone layout editor.

Dark mode overrides semantic tokens in `src/styles/tokens.css` only when the
desktop sets `data-theme=dark`. The phone's default palette stays unchanged.
Graph series keep their meaning. Main text, helpers, borders, solid surfaces,
link colours and glass fallbacks are all themed rather than applying a filter.
