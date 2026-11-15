# Core UI elements

Index of the foundational UI decisions in LoopStack. Read the relevant entry
before building something adjacent to it.

## Accessibility (applies to everything)

- [Interaction baseline](accessibility/interaction-baseline.md) — focus rings,
  reduced motion, tap targets, and the rule that colour never carries state
  alone. **Read this before adding any control.**

## Responsive

- [Horizontal axis lock](responsive/horizontal-axis-lock.md) — the app is a
  fixed-width phone column with the horizontal axis deliberately locked. Covers
  why `clip` and not `hidden`, and how to opt a deliberate carousel back in.

## Components

- [Meal pager](components/meal-pager.md) — prev/next navigation through recent
  meal traces. Inherits the segmented-control track recipe without being a
  segmented control.
- [Therapy field](components/therapy-field.md) — numeric therapy input with
  blur-commit validation. The pattern for any value the user types that feeds
  the suggestion engine.
- [Time in range bar](components/time-in-range-bar.md) — which band boundaries
  move with the user's target and which are clinical consensus.
- [Week rhythm strip](components/week-rhythm.md) — current-week daily TIR rings,
  and the new `--accent-info` azure secondary accent (why green couldn't do it).
- [Loop settings](components/loop-settings.md) — schedule-based therapy data,
  why the dose engine resolves it by time of day, and the resolution priority.

## Patterns

- [Saved desktop layouts](patterns/saved-layouts.md) — named widget views,
  appearance, migration and display-only persistence boundaries.

- [Ask data](patterns/data-chat.md) — retrospective evidence review, explicit
  ChatGPT connection state and deliberate sharing; never a dosing surface.

- [Shared-response attribution](patterns/shared-response-attribution.md) — how
  the UI reports that a glucose curve belongs to more than one meal, and the
  confidence language that goes with it.
- [Evidence-quality section](patterns/evidence-quality-section.md) — reporting
  on the *quality of the evidence* rather than proposing a change.
- [Dose suggestion](patterns/dose-suggestion.md) — the Get-strategy flow. Read
  this before touching anything that produces a number of units. **Safety
  constraints first.**
- [Insulin ledger](patterns/insulin-ledger.md) — Gluroo-style micro-dose
  accounting: hourly accumulation, xtra insulin, and observed carb ratio backed
  out of what Loop actually delivered.
- [AI macro estimation](patterns/ai-macro-estimation.md) — the OpenAI meal
  breakdown in the (+) flow. Estimates nutrition only; feeds the same dose
  engine. The honest facts about "connect ChatGPT" and the clamps that stop a
  hallucination becoming a dose.

## States

- [Data-result states](states/data-result-states.md) — the loading / empty /
  sample / computed ladder every source-backed surface must handle.

## Code snippets

- [CSS module cascade traps](code-snippets/css-module-cascade.md) — the
  same-specificity ordering bug that shipped a broken selected state to
  TestFlight, and how to write chip states so it cannot recur.
