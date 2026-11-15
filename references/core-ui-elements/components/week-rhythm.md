# Week rhythm strip

`WeekRhythm`, on the Trends screen under "Glucose control". Fed by
`timeTrends.weekRhythm`.

First build from the Alma/Runna dashboard-direction study — the cheapest of the
five moves because the data engine already existed.

## What it is

Seven rings, Monday-first, one per day of the **current calendar week**. Each
ring shows that day's time in range. Today is emphasized; days that haven't
happened yet are drawn empty (a `·`), not zero.

## Why calendar week, not day-of-week

`timeTrends.byDayOfWeek` averages every Monday together — that is the Insights
**Day of week** tab. This strip is the *current* week (dated days), so it
complements that tab rather than duplicating it. "How's this week going, and
which day slipped" vs "what do my Mondays look like in general".

## Colour — and the new secondary accent

- **Rings are semantic**, using the same TIR thresholds as the Hourly/Day tabs
  (≥70 in-range green, ≥50 high amber, else low red). A day is not an action, so
  it never uses the brand green as an accent — only as the in-range status.
- **The module's own chrome uses `--accent-info`** (azure `#3E6FA8`), the
  secondary accent added with this work. See below.

### Why a new accent existed to be added

Brand green is overloaded: it means both **primary action** and **in range**.
So green cannot also carry "this is an informational/insight module" without
blurring one of its two existing jobs. The azure `--accent-info` family fills
that third role:

| Token | Hex | Use |
|---|---|---|
| `--accent-info` | `#3E6FA8` | insight emphasis, secondary interactive cues |
| `--accent-info-hover` | `#325B8A` | hover |
| `--accent-info-soft` | `#EAF0F7` | tints, the "today" ring halo |
| `--accent-info-ink` | `#2B527D` | text on light (AA on white) |

It is **not** a status colour (that's `--range-*` / `--confidence-*`) and never
competes with green for the primary action. In this component it colours the
"This week" label and the today marker — so the module reads as insight, and
"today" is marked without a green halo that would misread as "in range".

## Takeaway sentence

One plain line above the rings (Mode-C "takeaway before the data"): the week's
average TIR across days-with-data, and — only when a completed day dragged the
week down by ≥15 points — that day named. Never invents a trend from one day.

## States

| State | Treatment |
|---|---|
| No readings this week | The whole card is not rendered (guarded in TrendsHome) |
| Some days logged | Logged days coloured, future days empty, today haloed |
| Sample source | "Sample" tag; rings still drawn |

## When not to use

Do not reuse these rings for anything without a 0–100 bounded value and a real
per-day denominator. Rings imply "progress toward a whole"; a raw count or an
unbounded metric should be a bar, not a ring.
