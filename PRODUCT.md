# Product

Who LoopStack is for, what they promise, the clinical-safety
commitments, and the process, stated once. DESIGN.md holds the visual rules.
Every named rule has a stable id the governance server checks against.

## Platform

- **LoopStack:** a local app (iOS via Capacitor, plus the web build on the
  owner's own computer). The owner's own data from Apple Health and/or
  Nightscout. Nothing goes to a shared service.
- **LoopStack on the desktop:** a downloadable desktop app (Electron, macOS
  first) with two views: *My dashboard*, a fully customizable layout for the
  person who loops, and *Care-team review*, the clinician's read of a review
  packet the person chose to share. The portfolio build runs on synthetic
  patients. It never writes to a pump, pod or CGM. Changes to Loop go only
  through the person's own Loop build (SAFE-3).
- One name, two surfaces. The phone is the glance; the desktop is where people
  review, arrange and share. The first pass treated the care-team product as a
  phone-width web app ("LoopStack+"); that was corrected on 2026-11-13.

## Users

People with type 1 diabetes who use open-source Loop (and Trio, iAPS,
AndroidAPS), parents and caregivers who loop for a child, and their care
team: endocrinologists, diabetes educators (CDCES), primary care.

## Product Purpose

Help people who loop organize, understand and share their data around what
they want to know, and act on it on their own and with their care team.

## Positioning

- **Definition line:** *The companion app for people who loop.*
- **Promise:** **Organize. Understand. Share.**
- **Compatibility line, before sign-in:** *Works with Loop · Trio · iAPS ·
  AndroidAPS.*
- **For clinicians:** *A 1–2 minute read of your patient's Loop data, in the
  report format you already use.*

### Named Rules
- **BRAND-1 Names.** "LoopStack", for the phone app and the desktop app
  alike. No other product names: no "LoopStack+" (retired), no "Loopstack" or
  "Loop Stack".
- **BRAND-2 Independent.** Never imply affiliation with LoopKit, Tidepool,
  Dexcom or Insulet ("official", "by LoopKit", "endorsed"). The store listing,
  the desktop account menu and Settings > About carry: *Independent · not affiliated with LoopKit, Tidepool,
  Dexcom or Insulet · never changes your pump · changes to Loop only through
  your own reviewed build.*

## Operating Context

The clinic has nothing to download from a Loop user, and its tools (Glooko,
Dexcom Clarity) can't read DIY data. The relationship tends to "don't ask,
don't tell". Settings change between visits with no shared record. Clinicians
review in 1–2 minutes, in a fixed order. The research behind this is in
`diy-loop-clinician-research/` and summarised in
`docs/desktop/research-report.md`.

## Capabilities and Constraints

- Read-only toward devices: nothing in either surface writes to a pump, a
  pod, a CGM or Nightscout.
- Real health data never goes to a shared service. The one exception is the
  AI connector, on the person's request, with their own key (SAFE-7).
- Loop is changed only as code, on the person's own Loop fork, through their
  own build (SAFE-3). Decided by Ryan on 2026-11-13, reversing the earlier
  "never writes to Loop": the desktop app may connect to the person's GitHub
  Loop branch, use their own AI keys, and add community features to it.
- The desktop build uses synthetic patients until HIPAA and FDA
  clinical-decision-support questions are answered.
- Apple Health carries no therapy settings, overrides or Loop status;
  Nightscout does. Screens say which source a view needs.

## Clinical safety

These block a change. They are the reason the product can exist.

### Named Rules
- **SAFE-1 Observations, never instructions.** No dosing commands: no "take X
  units", no "increase/lower your basal", no gram count to treat a low, no
  dose-magnitude qualifier. Say what Loop or the glucose did, not what to do.
  (From `docs/principles.md` §5.)
- **SAFE-2 No unmeasured claims.** Past-tense outcome language ("did better",
  "tends to", "has matched") needs data behind it on that code path. If the
  evidence basis is none, the copy says so.
- **SAFE-3 Loop changes only through the person's own build.** Nothing writes
  to a pump, pod, CGM or Nightscout, and nothing changes Loop live or on the
  phone. A change to Loop is a commit on the person's own Loop fork, shown as
  a diff they approve, built by their own GitHub Actions and installed by them
  from TestFlight. Changes to dosing code (the algorithm, dose maths, safety
  limits) are marked and need a second, separate confirmation. Therapy
  settings stay in Loop's own settings screens; no copy or control suggests
  the app sets them ("we'll update your settings", "apply to pump").
- **SAFE-4 No causal overclaims.** A before-and-after shows what happened
  after a change, not that the change caused it ("fixed", "caused", "because
  of the change" are out).
- **SAFE-5a Measured suggestions may reach the build (decided by Ryan on
  2026-11-15).** Narrows SAFE-5 and the "therapy settings stay in Loop"
  line of SAFE-3, desktop only. LoopStack may suggest a therapy setting or
  favorite-food value, and the person may add it to their next build, only
  when all of these hold:
  the value comes from LoopStack's measured readings (the Tuning engine, the
  meal ledger), never from a language model;
  the reading is at the top confidence grade, with its evidence shown;
  the step is at most 20% from the value on file;
  it is never a safety limit (glucose safety limit, maximum basal, maximum
  bolus, guardrails), which stay refused;
  in Loop it arrives as a proposal the person confirms in Loop's own settings
  screen, under Loop's guardrails, never as a silent overwrite;
  and adding it takes a reviewed diff plus the separate dosing confirmation.
  Copy still says what the data shows ("a reading of 1:9 on 11 of 13 days"),
  not "change your ratio" (SAFE-1).
- **SAFE-5 No AI settings advice.** No feature generates settings values. (In
  one 2026 test, an AI settings tool suggested max IOB from 4 to 15 U across
  50 runs.) AI may write feature code for the person's Loop branch; it never
  picks therapy values, and its changes go through SAFE-3 like any other.
- **SAFE-7 AI sees only what the person sends, with their own key.** The
  AI connector uses the person's own Anthropic API key (in the keychain).
  Nothing goes to a model on its own: each question sends a summary of the
  numbers on the dashboard (no raw readings, no Nightscout address or token),
  shown before it is sent. A feature request sends the description and the
  Loop source files it needs. Answers are checked against SAFE-1, SAFE-3 and
  SAFE-5 before they are shown, and a drafted patch goes through SAFE-3 like
  any other change.
- **SAFE-6 Every outside change shows its source.** A community feature
  names its author, source repository, last update, and the files it
  touches before it can be added. Nothing is added without its diff.

### Data vocabulary
- **DATA-1 No bolus/basal ratio.** Under Loop it mostly measures the
  algorithm.
- **DATA-2 Clinician terms.** Clinician-facing copy uses *time in automation*
  and *algorithm-modulated vs user-initiated insulin*, not "basal/bolus split".

## Brand Commitments

- Every finding links to its evidence (the weeks, the readings).
- Every settings change carries its source (self, parent, peer, clinician,
  algorithm, AI) without judgement.
- Patients choose what they share. *Prescriptions and supplies only* is a
  valid level, so supplies never depend on full disclosure.
- The clinician never needs the patient's Nightscout address or API secret.

## Evidence on Hand

- 16 research topics, 284 unique sources: `diy-loop-clinician-research/`.
- The actionable report: `docs/desktop/research-report.md`.
- 4.5-star comparison references: `docs/desktop/comparison-references.md`.
- The desktop brief: `docs/desktop/brief.md`.

## The Process, Stated Once

Work comes in three sizes; `get_checklist` says how much to check at each.

1. **Sketch:** a canvas board, a mockup, a spike. Tokens and the safety rules
   are fixed; everything else is loose.
2. **Playground:** in the app on a branch or a TestFlight build. Real
   components, tokens, safety and data-visual rules.
3. **Production:** what ships to the App Store or to a clinician. Everything
   in DESIGN.md and PRODUCT.md, the registry updated, and `system:review`
   clean.

Decisions that need the owner go in `DECISIONS-PENDING.md`.

## Product Principles

From `docs/principles.md`: trends first, logging last; memory over logging;
insight over data volume; confidence builds trust; recommendations are
pattern support, not medical commands; screenshots are first-class inputs;
every screen helps the user remember.

For the desktop app (`docs/desktop/brief.md` §2): detail complexity while
showing simplicity; the patient chooses what they track; beautiful and quick
to read; familiar to Loop users; 10× simpler for the care team.

### Named Rules
- **PROD-1 The patient view is customizable; the clinician view is fixed.**
- **PROD-2 Non-negotiables.** Daily trend alerts and the day tracker
  (glucose, insulin on board, carbs on board, exercise by weekday hour) are
  on every patient dashboard. Reorderable, not removable.

## Accessibility & Inclusion

- **A11Y-1** Images and meaningful SVG have text alternatives.
- **A11Y-2** Interactive things are real `<button>`, `<a href>` or inputs;
  never a click handler on a `div` or `span`.
- **A11Y-3** No positive `tabIndex`.
- **A11Y-4** Text contrast at least 4.5:1 (COL-4); tap targets at least 44px.
- **A11Y-5** Respect reduced motion and Dynamic Type.
