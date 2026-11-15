# Evidence-quality section

A section that reports on **the quality of the evidence** rather than proposing
a change. Currently: Insights → "Meals on board together".

## When to use

When the product has learned something about its own confidence that the user
should be able to audit — how often the data was ambiguous, and how it resolved
the ambiguity.

## When not to use

- As a suggestion. Nothing here proposes an action, so it carries no Fix Log
  path, no track/dismiss, no `InsightCard`.
- As a general stats dump. Each figure must change how the user reads the rest
  of the screen.

## Placement

Last on Insights, after the actionable categories. Mode C hierarchy puts current
state → trend → why → evidence → next step → raw detail; this is meta-evidence
and sits below the things the user can act on.

## Anatomy

1. Section header stating the rule in plain language ("LoopStack splits the
   response toward the larger, longer meal instead of charging it all to the
   newest entry").
2. Four stat tiles — each answers a distinct question: how often, what share,
   how decisively, how much overlap.
3. Up to five instances, newest first, as **rows not cards** — they share one
   hierarchy and are read by scanning.
4. `SampleNote` when the source is not computed.

## States

| State | Treatment |
|---|---|
| Loading | "Scanning your meal history…" |
| Computed, none found | "No overlapping meals in the last 30 days — every meal was scored on a curve of its own." A real, reassuring answer, not an empty box. |
| No source | "Needs meal history from a connected source." |
| Populated | stats + instance rows |

The zero state is the one most likely to be shown and the easiest to get wrong.
It must state what was checked and over what window.

## Responsive

Stat tiles are 2×2 below 400px, 4-across above. Four columns inside the 440px
column leaves ~74px per tile; at 320px it leaves ~55px and every label wraps to
three lines.

## Instance row

Date + verdict chip, then one chip per meal (`96g · 5h · 88%`), then the
explanation. The dominant meal's chip is inverted fill + weight 600 — colour is
not doing the work alone.
