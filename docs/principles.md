# Principles

The stance the product takes before a single pixel is drawn.

---

## 1. Trends first, logging last

The home screen is a living metabolic dashboard — not an inbox of entries. The user should open the app and learn something about their body in under three seconds. Logging exists to feed the patterns; patterns are the product.

## 2. Memory over logging

A meal isn't an entry. It's a **memory** — a reusable record that gets richer every time that meal is eaten again. The fourth Chipotle bowl should teach the user something the first one couldn't.

## 3. Insight over data volume

Clarity dashboards and Nightscout already show everything. LoopStack shows only what matters *right now*. Density is not a feature.

## 4. Confidence builds trust

Every insight, pattern, and suggestion carries a **confidence badge** and an **evidence count**. If the system has seen something three times, it says so. If it's seen it thirty times, it says that too. The user is never asked to trust an opaque conclusion.

## 5. Recommendations are pattern support, not medical commands

The product never says *"take 0.3U more."* It says *"meals like this had better outcomes when insulin was delivered 15–20 minutes earlier"* — **when something actually measured that.** The user remains the clinician of their own body; the app is a pattern witness.

That second half is not a footnote. The sentence above is this document's own example of compliant copy, and a near-verbatim version of it shipped in the meal strategy engine fired by the user's own pre-bolus lever, on the one code path that passes no history at all. It rendered on the same card as "no matching history yet." Copy that *sounds* like pattern support while inventing the pattern is a worse failure than a plain instruction, because it borrows the credibility of evidence the app does not have.

So the rule has two halves, and both are load-bearing:

- **No dosing commands.** No "take X units", no "increase your basal", no gram count to treat a low, no dose-magnitude qualifier ("a small pre-bolus"). This holds hardest for anything triggered by a live reading, which is read in the moment and acted on immediately.
- **No unmeasured claims.** Past-tense outcome language ("did better", "has matched", "tends to") requires data behind it *on that code path*. A function that cannot see history cannot make a claim about history. If the evidence basis is `none`, the copy says so.

### The one exception: the meal strategy surface

**The meal strategy sheet and CaptureFlow result may state quantities.** This is a deliberate carve-out, decided 2026-08-18, not an oversight — the surface exists to answer "how much, and split how", and a split you cannot read a number off is not a split. Everywhere else, principle 5 applies without exception.

What the carve-out permits and requires:

| | |
| --- | --- |
| **Where** | `MealStrategySheet` and `StrategyCard` only. No other surface may quantify insulin — not the home banner, not an alert, not an inbox card, not a notification. |
| **Framing** | Descriptive, never imperative. "Upfront 1.4 U" is a label on a computed split. "Take the upfront 1.4 U" is an instruction, and is banned — the verb is the whole difference. |
| **Provenance** | The confidence cap (70) and the `Unproven` tag stay. A number here is an estimate of the food, and says so. |
| **Disclaimer** | The check-before-you-dose block is not optional chrome. It is the condition on which this exception rests. |
| **Scope** | Food only. No correction for current glucose, no IOB assumption — Loop owns both, and the sheet states that it is not doing them. |

The reason to write this down rather than leave it as practice: an undocumented exception is indistinguishable from a violation, so the next piece of copy has no rule to be judged against — and the audit that found the banned imperative in `StrategyCard` had no way to tell whether the whole surface was out of policy or just that one verb.

## 6. Screenshots and meal photos are first-class inputs

Most T1D data lives in screenshots — of Loop, of Clarity, of Nightscout. Typing carbs into a form is a last resort, not a primary input. The app accepts the user's existing behavior rather than requiring new behavior.

## 7. Every screen should feel like the app is helping the user remember

Not helping them *record*. Not helping them *analyze*. Helping them **remember what happened the last time they did this**.

---

## What the product is not

- Not a chatbot. AI is embedded, not conversational.
- Not a coach. It does not set goals or nag.
- Not an EHR. It is not a substitute for clinical care.
- Not a tracker. It is an intelligence layer over existing trackers.
- Not gamified. Streaks and badges work against trust in a chronic condition.
