# Information Architecture

---

## Navigation model

A four-tab bottom navigation with a floating capture button in the center. No hamburger menu, no side drawer.

```
┌───────────────────────────────────────────────────┐
│                                                   │
│                  SCREEN CONTENT                   │
│                                                   │
│                                                   │
├───────────────────────────────────────────────────┤
│  Trends   Memories  ( + )  Patterns   Profile     │
└───────────────────────────────────────────────────┘
```

| Tab | Primary screen | What lives here |
|---|---|---|
| **Trends** | Trends Home | Daily dashboard, hero glucose graph, today's insights |
| **Memories** | Meal Memory list | All meal memories, grouped by frequency and recency |
| **+ Capture** | Capture Flow | Camera, share-target, manual add |
| **Patterns** | Pattern Timeline | Long-view of how the user's responses are changing |
| **Profile** | Profile + Connections | Data sources, doctor summary, settings |

The center **+** is visually the brand primary color — the AI aid, the thing that makes new memory.

---

## Screen map

```
Trends (tab)
├── Trends Home
│   ├── Insight detail (modal sheet)
│   ├── Pattern detail (push)
│   └── Recent meal → Meal Memory Detail (push)
│
Memories (tab)
├── Memory list
│   ├── Meal Memory Detail (push)
│   │   ├── Compare Meals (push)
│   │   ├── Suggested Approach detail (modal sheet)
│   │   ├── View why / evidence (modal sheet)
│   │   └── Edit notes (modal sheet)
│   └── Filter (modal sheet)
│
Capture (fab)
├── Capture chooser (modal sheet)
│   ├── Screenshot import flow (push)
│   ├── Meal photo flow (push)
│   └── Manual add (push)
│       └── Review detected → save as Memory
│
Patterns (tab)
├── Pattern Timeline
│   ├── Range selector (7d / 14d / 30d / 90d)
│   ├── Pattern detail (push)
│   └── Related memories (push)
│
Profile (tab)
├── Profile home
│   ├── Connections (Dexcom, Apple Health, Loop, Nightscout)
│   ├── Doctor Summary / Export (push)
│   │   └── Export preview (modal sheet)
│   ├── Preferences (target range, notifications, units)
│   └── About
```

---

## Navigation patterns

- **Push** for deep-drill screens (memory → compare, pattern → detail).
- **Modal sheets** for transient decisions (insight detail, evidence, editing). Sheets dismiss by drag-down.
- **Tab switches** never push. Switching tabs returns to the tab's root, preserving scroll position.
- **Back always works.** No dead-ends. The header back button is always visible on push screens.

---

## Header behavior

- **Tab roots** — no back button. Screen title left-aligned. Optional right-side action (e.g. filter).
- **Pushed screens** — back chevron left, title centered, right-side action context-dependent.
- **Capture flow** — close (×) instead of back. Progress indicator across the top.

---

## Empty states

Every screen has a designed empty state. The home screen's empty state is a *guided preview*, not a blank canvas (see [user-journey.md](user-journey.md#first-run-journey-jordan-day-one)).

| Screen | Empty state treatment |
|---|---|
| Trends Home | Sample insights with "Preview — based on example data" badge |
| Memory list | Three example memories + "Save your first memory" CTA |
| Patterns | "We need ~14 days of data before patterns appear" + progress indicator |
| Compare Meals | "Save at least two memories of the same meal to compare" |

---

## Notification taxonomy

Push notifications are rare and valuable. Three types only:

1. **New pattern detected** — "We noticed something about your mornings."
2. **Meal memory ready** — "Your Chipotle bowl memory is complete. Want to see how it compared?"
3. **Doctor summary ready** — triggered on-demand, not scheduled.

No daily reminders. No streaks. No "you haven't logged in three days."
