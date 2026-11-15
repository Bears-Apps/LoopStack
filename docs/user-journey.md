# User Journey

Three personas, three core paths. Everything else is supporting behavior.

---

## Personas

### Maya — the pattern-seeking patient
34, diagnosed at 19, on Loop, wears a Dexcom G7. Screenshots her Loop screen constantly. Eats the same ~12 meals in rotation. Wants to know *why* the same Chipotle bowl spikes differently on Tuesday vs Sunday.

### Dr. Chen — the endocrinologist
Sees 22 T1D patients per week in 15-minute appointments. Needs a 90-second summary of what's actually been happening between visits — not a data dump.

### Jordan — the newly diagnosed
28, diagnosed six months ago. Still learning. Needs the app to teach them without lecturing.

---

## The three core paths

### Path 1 — The daily open ("What happened with my body?")

**Trigger:** Maya opens the app during her morning coffee.
**Goal:** Learn something useful in under 10 seconds.

```
App open
   │
   ▼
Trends Home (default tab)
   │  Hero glucose graph animates in
   │  Key insight card sits under the hero
   │  "Morning highs have risen 12 mg/dL avg over 14 days"
   │
   ▼
Tap insight → Pattern Detail
   │  Supporting mini charts, evidence count, related meals
   │
   ▼
Tap related meal → Meal Memory Detail
   │  Hero glucose curve of the last occurrence
   │  "You've eaten this 4 times. Here's what tends to happen."
```

**What she doesn't do:** log anything. The app already knows.

---

### Path 2 — The meal capture ("Remember this meal")

**Trigger:** Maya just ate a Chipotle bowl. She screenshots her Loop screen.
**Goal:** Save it as a memory, compare to past occurrences, get a suggested approach.

```
Share screenshot to LoopStack  ─── or ───  Capture from inside app
   │                                          │
   └──────────────┬───────────────────────────┘
                  ▼
         Capture Flow (AI classifies)
         │  "Detected: Chipotle Bowl (seen 3 times before)"
         │  "Estimated carbs: 100g · Insulin: 1.2U"
         │  [Review] [Edit] [Save as Memory]
                  │
                  ▼
         Meal Memory Detail
         │  Header: "Chipotle Bowl · 4th time"
         │  Outcome summary card (prior occurrences)
         │  Glucose curve (not yet complete — filling live)
         │  Suggested Approach card
         │     "Meals like this had better outcomes when insulin
         │      was delivered 15–20 min earlier."
         │     [Compare prior versions] [View why]
                  │
                  ▼
         Compare Meals (optional)
         │  Overlay of all 4 occurrences, aligned to meal start
         │  Best version surfaced, delta insights below
```

**What's new:** the meal already has context before the glucose curve finishes. The app recognizes it, not just records it.

---

### Path 3 — The doctor visit ("Hand this to my endo")

**Trigger:** Maya has an appointment with Dr. Chen tomorrow.
**Goal:** Export a human-readable summary of the last 30 days.

```
Trends Home
   │
   ▼
Tap "Prepare for visit" in menu
   │
   ▼
Doctor Summary screen
   │  Headline: "3 repeated patterns · 2 trend shifts · 12 meal memories"
   │  Key repeated patterns (with confidence)
   │  Trend observations over 30 days
   │  Example meals with outcomes
   │  [Export PDF] [Share link]
   │
   ▼
Dr. Chen opens link on her laptop
   │  Same summary, printable layout
   │  Patient's notes section at the bottom
```

**What's missing on purpose:** no raw CGM download, no A1c calculator, no dosing recommendations. The export is a *narrative*, not a data file.

---

## First-run journey (Jordan, day one)

```
Install
   │
   ▼
Welcome — "LoopStack learns from what you already do."
   │  No email required to start (local-only mode option)
   │
   ▼
Connect data sources
   │  [Dexcom] [Apple Health] [Loop / Nightscout] [Skip for now]
   │
   ▼
Import a screenshot (optional, recommended)
   │  "Got a screenshot of your Loop screen? We'll learn from it."
   │
   ▼
Empty-state Trends Home
   │  "We need about 3 days of data before patterns appear."
   │  In the meantime: sample meal memories are shown as examples.
   │
   ▼
Day 3 — first real pattern card appears
   │  Push notification: "We noticed something about your mornings."
```

The empty state is not empty — it's a guided preview of what the app will become.

---

## Cross-path behaviors

- **Every screen** has access to Capture (camera / share sheet target) from the bottom nav center button.
- **Every memory** can be compared, exported, or re-classified at any point.
- **Every insight** can be expanded into evidence ("View why") and traced back to the raw entries that produced it.
- **Nothing is destructive.** There is no delete — only *archive* and *unlink*. A memory is a compound of entries; removing the memory doesn't remove the underlying data.

---

## Success signals

- Maya opens the app daily without being prompted.
- Maya eats a recurring meal and feels the app knew what it was.
- Dr. Chen reads a summary in 90 seconds and asks one informed question she couldn't have asked from Clarity alone.
- Jordan makes it to day 14 without feeling lectured.
