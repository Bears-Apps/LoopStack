# Ask data

Use for retrospective questions where the person needs the source evidence next
to a conclusion. Do not use for current low/high treatment or dosing instructions.

Mode: calm data product. Variance 4, motion 1 (reduced from 3 for reading), density
7, system rigor 9. Uses LoopStack tokens, AppHeader, Button, SampleNote, footer.

Hierarchy: connection status → question and selected evidence scope → local
answer → dated records and gaps → deliberate copy/share. The local summary is
labelled calculated on device and never passed off as a model response. Pending
connection is explained plainly; no nonfunctional sign-in button.

States: unavailable credentials, source loading/error/stale, no named meals,
no matching sittings, insufficient weeks, sample, partial and computed evidence,
clipboard denied, selected report with changed composer, source switch reset.
Question editing does not rewrite an already generated report.

Responsive: phone column at 320–440px; wrapping labels, two-column definition
lists, select controls for weekday/hour, long evidence in selectable text.
Every destination keeps a text label. Buttons/selects/summary hit areas ≥44px.
Keyboard focus inherits the interaction baseline; answer and copy status are
announced, charts never rely on colour. No decorative motion.

Implementation: `src/screens/DataChat/`, pure retrieval in
`src/lib/ai/reviewEvidence.ts`. No auth tokens or source credentials in evidence.
Detailed integration requirements: `docs/chatgpt-data-chat.md`.
