# Brand — LoopStack

---

## Name

The product is **LoopStack**. The name carries the two things the product does:

- **Loop** — the automated insulin delivery context the app is built around (and the Loop community it serves).
- **Stack** — layered evidence: CGM, meals, fitness, settings, outcomes, all stacked to produce a better next decision.

The tagline — used on the splash screen, login, and marketing surfaces — is:

> **UNDERSTAND. ADAPT. IMPROVE.**

Periods are rendered in `--brand-primary` (green) when space allows. The tagline words stay in `--ink-900`.

---

## Mark

The LoopStack mark is **Concept 07c**, the chosen icon: a green **ring with a speech tail** (an open "C" that reads as a conversation) and three rounded bars coming out of the opening. The top and bottom bars are green and the middle one is ink: the care team's reply comes in from outside the ring.

- The ring and the two green bars use one vertical gradient, `--mark-gradient-start` to `--mark-gradient-end` (`#6DCE3F` to `#1F7A2E`). The middle bar is `--ink-900`.
- Geometry lives in `public/loopstack-mark.svg` (mark only), `desktop/build/icon.svg` (macOS app icon) and `Mark` in `desktop/src/ui/kit.tsx` (in-app tile). They share one set of paths.
- The earlier stacked-diamond ring and the open "C" without a tail are retired. Do not use them in the app, the demos, the case study or the video.

### Mark usage

| Context | Asset |
|---|---|
| App icon | Mark only, on a subtle surface-1 or white square |
| Favicon | The mark on its tile, `favicon.svg` (phone and desktop apps and the portfolio demos) |
| Login / splash | Full lockup: mark + "LoopStack" wordmark + tagline |
| In-app header (root) | Wordmark only: "LoopStack" in `--ink-900`, no mark |
| Nested screens | Back chevron replaces the wordmark |

### Minimum sizes

- Full lockup: 200px wide minimum
- Mark-only: 32px minimum (below this, use the simplified stack-only glyph)
- Wordmark-only: 18px cap-height minimum

---

## Color

The palette is **clinical-lite**: the white/off-white of a modern medical chart, warmed slightly. One brand primary. Three glucose-range colors that carry semantic meaning and appear consistently across every graph in the product.

### Core

| Token | Hex | Role |
|---|---|---|
| `--brand-primary` | `#5CC25C` | Loop-inspired green. Accent, active state, in-range indicator. |
| `--brand-primary-hover` | `#48A848` | Pressed / hovered brand surfaces, brand-colored text. |
| `--brand-primary-soft` | `#E8F6E8` | Brand backgrounds, selected chips, confidence highlights. |
| `--ink-900` | `#0E1216` | Primary text, primary CTA fill. |
| `--ink-700` | `#3C434A` | Body text. |
| `--ink-500` | `#7A828A` | Tertiary / labels / meta. |
| `--ink-300` | `#BEC3CA` | Disabled, muted icons. |
| `--ink-200` | `#E3E5E8` | Hairline dividers, card borders. |
| `--surface-0` | `#FFFFFF` | Cards, app canvas. |
| `--surface-1` | `#F6F7F8` | App background, input fills. |
| `--surface-2` | `#EDEEF0` | Subtle section shading. |

### Mark gradient

| Token | Hex | Position |
|---|---|---|
| `--mark-gradient-start` | `#6DCE3F` | Top of stack, outer ring apex |
| `--mark-gradient-end` | `#1F7A2E` | Bottom of stack, inner ring base |

Used only in the logo mark. Never in product UI.

### Glucose-range semantic colors

These appear in every graph in the product, matching Loop's chart scheme so the app feels native to Loop users.

| Token | Hex | Meaning |
|---|---|---|
| `--range-in` | `#5CC25C` | In-range glucose (70–180 mg/dL default) — same hex as `--brand-primary` |
| `--range-high` | `#F0B429` | Above range |
| `--range-low` | `#FC5E5E` | Below range |
| `--range-band` | `#5CC25C` @ 12% | Target range band fill |

### Why Loop green for the brand primary

The brand color is deliberately the same as `--range-in`. The product thesis is *Loop, understood — stacked evidence that nudges you toward in-range*. The brand color should *be* the target state, not a separate accent. Loop users will recognize the green immediately, which sets expectations for the data conventions across every graph. This is a deliberate choice, not an oversight.

Rules that follow from this:
- Brand primary is used only on **actionable** or **branded** surfaces (mark, primary CTAs, the capture button, selected states, insight strip accents, tagline periods).
- Inside a graph, green means **in-range** — never "tap this."
- When a graph lives inside a card that has a branded accent, the accent uses `--brand-primary-soft` or a left-edge brand stripe so the graph's semantic greens stay unambiguous.

---

## Typography

A single type family, two weights. Restraint is the point.

- **Display / Headings** — Inter, 600 (Semi Bold)
- **Body** — Inter, 400 (Regular)
- **Numerals in graphs / metrics** — Inter, 500 (Medium), tabular figures (`font-variant-numeric: tabular-nums`)

### Scale

| Token | Size / line-height | Use |
|---|---|---|
| `--text-display` | 34 / 40, -0.015em | Screen heroes ("Check your email", current glucose) |
| `--text-title` | 22 / 28, -0.01em | Screen titles, meal names, card titles |
| `--text-body` | 15 / 22 | Default body |
| `--text-small` | 13 / 18 | Secondary body, card labels |
| `--text-label` | 11 / 14, +0.08em tracking, uppercase | Micro labels, badges, pill text |

See [visual-system.md](./visual-system.md) §2 for the full scale + letter-spacing rules.

---

## Spacing, radius, elevation

Withings-inspired airy spacing. Restraint on decoration.

- **Spacing scale**: 4, 8, 12, 16, 20, 24, 32, 48
- **Radius**: cards `20`, inputs `14`, buttons `999` (pill), chips `999`
- **Elevation**: one whisper shadow token — `0 2px 12px rgba(13, 20, 26, 0.04)`

Cards float; the app does not.

---

## Visual tone — inspirations and anti-inspirations

**Yes (ranked by influence):**
- **Withings Health Mate** — primary visual reference (see §1 of `visual-system.md`): airy onboarding, pill CTAs, big headings, soft gray fills
- Apple Health — hierarchy, hero metric, tab-driven time ranges
- Dexcom Clarity — graph legibility, range band
- Levels — narrative insight cards
- Oura — readiness / confidence framing

**No:**
- Generic AI chatbot UI (no floating sparkle icon, no speech bubbles as primary surface)
- Bright / playful / gamified health apps
- Cluttered multi-widget dashboards
- Dense enterprise analytics screens
- Gradient buttons, heavy drop shadows, blurred glassmorphism

---

## Iconography

- Line icons, 1.5px stroke, 24px default, rounded joins.
- One icon set across the whole product (Phosphor or Lucide). No mixing.
- AI-generated content is marked with a small filled dot in `--brand-primary`, never a sparkle or wand.

---

## Motion

- Duration: 120ms for micro-interactions (taps), 280ms for screen transitions
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` for everything. One curve, applied consistently.
- Graphs animate on first render only. They do not re-animate on tab changes.
