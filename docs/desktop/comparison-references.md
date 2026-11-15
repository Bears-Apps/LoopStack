# Comparison visuals: references and rules

References for two LoopStack visuals. All apps are rated 4.5 or higher on the
US App Store (checked 2026-11-13) and have a documented planned-vs-actual or
period-comparison view. Borrow the patterns, never the look.

- **(A) What Loop did vs what the settings say:** delivered insulin against
  the scheduled basal, hour by hour.
- **(B) Before and after a settings change:** two periods compared for one
  part of the day, to answer "did that change work?"

## References and how each compiles its comparison

| App (rating) | View | Maps to | How it compiles | Pattern |
|---|---|---|---|---|
| TrainingPeaks (4.7) | Workout compliance | A | Each completed workout against its own planned value. Within about 20% is on plan; 50–79% or 121–150% is off; over 50% off is far off; planned-not-done and done-unplanned are separate states. | Tolerance-band states, planned and completed side by side |
| Copilot Money (4.8) | Spending graph | A | Cumulative actual against an ideal pace across the month. Planned spikes (rent) are pulled out of the line. | Dotted target line, solid actual line ending at "today", one headline verdict |
| YNAB (4.8) | Category progress bars | A | Assigned vs target vs spent per period. Rollover gets its own section. Explicit empty state. | One bar encoding planned, delivered and remaining |
| Monarch (4.9) | Planned / Actual / Remaining | A | Per category per month, as a table. | A plain table people can audit |
| MacroFactor (4.8) | Energy balance, weekly check-in | A and B | Intake against estimated expenditure, on a smoothed trend. Blank days are skipped, partial days flagged, a minimum of 4 logged days a week, and a pause after gaps. "Adherence-neutral": never blames the user. | Stated missing-data rules |
| WHOOP (4.8) | Behaviour impact | B | Days with a behaviour against days without, over 90 days. Needs at least 5 entries on each side. Adjusts for other factors. Says it does not establish causation. | Signed impact bars, a sample gate, a causation caveat |
| Athlytic (4.8) | Recovery vs baseline | B | Today against a rolling 60-day personal average. | Personal band; "normal" means your normal |
| Gentler Streak (4.7) | Activity Path | A | Load against a personal optimal zone, with a short projection. | Banded zone, line through it, plain-language sentence |
| Sense (4.6) | Compare Previous | B | The current period against the prior period of the same type. Users complain that the y-axis rescales between periods. | Period-type alignment; lock the scale |
| Dexcom Clarity (4.6) | Compare, Patterns | B | Two chosen date ranges side by side with the same metrics; contributing days listed. Convention: 14 days, at least 70% sensor wear. | Side-by-side with clinical vocabulary |

Checked and excluded: Garmin Connect (4.4). Oura, Strava, Bevel, Hevy and
AutoSleep pass the rating bar, but no documented period-comparison view was
found.

## Rules for both visuals

1. **One shared, locked scale.** Never rescale between the two things compared.
2. **No dual axes.** Insulin and glucose sit in separate stacked panels on one
   time axis.
3. **State the sample on both sides** before any verdict ("8 of 14 nights
   usable"). Below the minimum, say "not enough yet", not a number.
4. **Missing data is drawn as missing** (hatched or empty) and never counted.
   Gaps are labelled by cause where known.
5. **Colour is never the only signal.** Pair it with a label, icon or position.
6. **A plain-language verdict, hedged honestly.** "After the change, overnight
   lows dropped", not "the change fixed it". Observations, never instructions.
7. **Confounders are marked on the timeline** (exercise, illness, pod or site
   change, missed meals, a different weekday mix).
8. **The raw hours are one tap away.** Smoothing must not hide why a number
   changed.

## Specific to (A)

- Scheduled basal as the reference (a dotted step line or a band); delivered
  as the solid mark.
- Hour states with a tolerance: about as scheduled, more than scheduled, less
  than scheduled, suspended, no data.
- Use the clinicians' terms: algorithm-modulated vs user-initiated insulin,
  time in automation. No bolus/basal ratio.

## Specific to (B)

- Anchor on the date the setting changed. Compare N days before with N days
  after, with a matching weekday mix. Leave out the change day itself.
- Scope to the part of the day the change targeted, with the rest of the day
  available.
- Show who proposed the change and who agreed, and the next review date.
