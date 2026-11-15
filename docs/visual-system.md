# LoopStack — Visual System

> **Reference this doc for every future design implementation request.** The rules below are the north star. Deviations require explicit user direction.

Source of truth:
- **Figma reference board**: `General UX and Design` at https://www.figma.com/design/ny2djQElAu3fHvgoTxhBqX/t1d-AId-%E2%80%94-Prototype-v0?node-id=19-2 — a board of Withings Health Mate (iOS) screens that serve as the visual language target.
- **Brand mark**: LoopStack — stacked diamonds inside a green circular tech-ring, with two orbit dots. See `docs/brand.md` for the full brand spec.
- **Tagline**: `UNDERSTAND. ADAPT. IMPROVE.` — apply with green accent periods in label casing.

---

## 1. Brand identity

- **Product name**: LoopStack
- **Tagline**: UNDERSTAND. ADAPT. IMPROVE. (green-accent periods)
- **Brand mark colors**: light green (`#6DCE3F`) → deep green (`#1F7A2E`) vertical gradient on the mark
- **Brand primary (accent)**: Loop green `#5CC25C` — used for interactive accents, the "AI" in wordmarks, in-range glucose state, and the accent period in tagline treatments
- **Logo usage**:
  - **Full lockup** (mark + "LoopStack" + tagline): splash screen, login screen hero, marketing
  - **Mark only**: app icon, compact nav states, favicon
  - **Wordmark only**: top-of-app header — "LoopStack" with optional colored accent on the "L" or diamond dot

## 2. Typography

The Withings reference uses a tall, airy typography scale with large display headings, medium weight paragraphs, and generous line-height. Match this feel.

| Role | Size | Line-height | Weight | Notes |
|------|------|-------------|--------|-------|
| Display | 34 | 40 | Semi Bold (600) | Screen hero ("Check your email") |
| Title | 22 | 28 | Semi Bold (600) | Section headers, card titles |
| Body | 15 | 22 | Regular (400) | Paragraphs, descriptions |
| Small | 13 | 18 | Regular (400) | Helper text, timestamps |
| Label | 11 | 14 | Medium (500) | UPPERCASE, +0.08em tracking |
| Button | 15 | 18 | Semi Bold (600) | Pill CTA labels |

- **Font family**: `Inter` (system fallback). Reserve weights: 400, 500, 600. Never use 700+.
- **Letter spacing**: `-0.015em` on Display, `-0.01em` on Title, `+0.08em` on Label (uppercase).
- **Body text color**: `--ink-900` for primary, `--ink-500` for secondary / helper.
- **Headings are ALWAYS left-aligned** unless the screen is a centered illustrated onboarding slide.

## 3. Color roles

Tokens live in [src/styles/tokens.css](../src/styles/tokens.css). Do not inline hex values.

- **Surface**:
  - `--surface-0`: `#FFFFFF` — app canvas, cards
  - `--surface-1`: `#F6F7F8` — subtle gray fills, inputs, row highlights
  - `--surface-2`: `#EDEEF0` — dividers, chips
- **Ink (text)**:
  - `--ink-900`: `#0E1216` — primary text, heavy headings (Withings black-body feel)
  - `--ink-700`: `#3C434A` — body copy
  - `--ink-500`: `#7A828A` — helper, meta, placeholder
  - `--ink-300`: `#BEC3CA` — disabled, muted icons
  - `--ink-200`: `#E3E5E8` — hairline borders
- **Brand / accent**:
  - `--brand-primary`: `#5CC25C` — single accent, used sparingly
  - `--brand-primary-hover`: `#48A848`
  - `--brand-primary-soft`: `#E8F6E8` — pill backgrounds, badges
- **Status (glucose range)**:
  - `--range-in`: `#5CC25C` (unified with brand — in-range = desired)
  - `--range-high`: `#F0B429`
  - `--range-low`: `#FC5E5E`

## 4. Spacing & layout

Withings screens are **airy**. Use the spacing tokens literally — don't crunch content.

- Screen gutter: `--space-5` (20px) left/right
- Section separation: `--space-8` (32px) or more
- Card internal padding: `--space-5` (20px)
- Component vertical rhythm: `--space-4` (16px)
- **Status bar + safe top**: 56px top padding on every screen header
- **Bottom safe area**: 24px bottom padding (120px when BottomNav is present)

**Mobile-first frame**: 440px max-width. The whole app sits inside a centered column on larger viewports.

## 5. Components — visual patterns

### Buttons

Three variants only. All are pill-shaped (`border-radius: 999px`), full-width by default.

- **Primary**: solid `--ink-900` background, white text, 52px height, 15px Semi Bold label. Used for screen primary CTA.
- **Secondary**: transparent background with 1.5px `--ink-200` border, `--ink-900` label. Used for "Maybe later" / "Skip" / back-alternatives.
- **Tertiary (text)**: no chrome, label in `--brand-primary-hover` or `--ink-700`. Used inline ("Learn more", "Resend code").

**No outlined black buttons with fill on hover** — keep interactions static until wired to real behavior. Never use a gradient, drop shadow, or icon-only circular button except the capture FAB.

### Inputs

- Label above, 12px gap, input below
- Input: 52px height, `--surface-1` fill or 1px `--ink-200` border, `--radius-input` (14px) corners
- Caret / focus: 2px `--brand-primary` outline ring, no color shift on the fill
- Placeholder text: `--ink-500`
- Chevron inputs (date pickers, selects): trailing `chevron-down` icon in `--ink-500`

### Cards

- `--surface-0` or `--surface-1` fill
- 1px `--ink-200` border
- `--radius-card` (20px) corners
- Shadow: `0 2px 12px rgba(13, 20, 26, 0.04)` — whisper-light, never heavy
- Internal padding: `--space-5` (20px)

### Lists (rows)

- 56px min height
- Left-aligned icon (20px) → label (ink-900, 15px Medium) → trailing chevron or toggle
- Hairline `--ink-200` divider between rows (but not above first or below last)
- Tap feedback: `--surface-1` fill

### Toggles

- 52×32px track, 28px thumb
- Off: `--ink-200` track, white thumb
- On: `--brand-primary` track, white thumb
- Match Withings — smooth, no icon inside the thumb

### Badges / pills (status)

- 4px vertical × 10px horizontal padding
- `--radius-pill` (999px)
- Label: 11px Medium, UPPERCASE, +0.08em tracking
- Color pairs:
  - Neutral: `--surface-2` bg + `--ink-500` text
  - Brand: `--brand-primary-soft` bg + `--brand-primary-hover` text
  - Warning: `#FEF3DC` bg + `#946800` text
  - Alert: `#FDE8E8` bg + `#8C2424` text

### App header (in-app)

- 56px top safe-area padding, 16px bottom padding
- Left: back chevron (24px, `--ink-900`) OR LoopStack wordmark when at root
- Right: overflow dots, avatar, or close X — whichever fits the screen context
- No bottom border — use whitespace as the separator

### Bottom navigation

- 4 tabs + floating capture FAB in center
- 88px total height (64 content + 24 safe-area)
- Icon-only with label below (10px Medium), active state: `--brand-primary-hover` label + filled brand primary dot/icon
- 1px `--ink-200` top hairline

### Floating Action Button (capture)

- 64px circle, `--brand-primary` fill, white + icon
- 4px `--surface-0` ring for lift
- Soft green shadow (`rgba(92, 194, 92, 0.35)`, `0 6px 18px`)
- Sits centered on the BottomNav with 22px overhang

## 6. Illustration & iconography

- **Icons**: 24px line icons, 1.5px stroke weight. `--ink-900` at rest, `--brand-primary` for active/accent. Prefer Phosphor or Lucide. Never mix icon families.
- **Onboarding illustrations**: simple flat vector with a single accent color (brand green). Match the Withings style — warm, friendly, calm, no 3D or gradients.
- **Photography**: only for meal captures. Rendered at card-radius with a subtle `--ink-200` ring.

## 7. Motion

- **Duration**: `--dur-fast` 120ms (taps/micro), `--dur-screen` 280ms (screen transitions)
- **Easing**: `cubic-bezier(0.22, 1, 0.36, 1)` — fast-out, slow-in
- **Screen transitions**: horizontal slide for push navigation, vertical slide for modals/capture
- **Never animate** color, opacity, or scale for ambient purposes. Motion only happens in response to user intent.

## 8. Onboarding flow — shape

From the Withings reference, the canonical onboarding arc is:

1. **Welcome carousel** (3 slides) — big photo/illustration, title, body, dot indicator, single "Get started" primary
2. **Continue with…** — Email input + Apple + Google options, dark divider between
3. **Check your email** — code input (6 digits), "Didn't get a code?" link
4. **Agreements** — Privacy policy + Terms + Communications consent, each as a row with "Agree" pill
5. **Profile** — name → DOB → sex → height/weight, one field per screen, progress indicated by the navigation
6. **MFA / Auth** — optional, gated with illustration
7. **Connect Apple Health** — category list with toggles ("Turn on all" affordance at top), sync progress, done state
8. **Done** — brief celebration screen, primary CTA leads into the app

Every onboarding screen:
- Has a **back chevron** top-left and optional **Cancel** top-right
- Shows **one primary CTA** at the bottom (or two stacked if dual-path)
- Uses **generous whitespace** — never crowd the frame
- Places the **illustration/hero image ~20% from the top**, never full-bleed

## 9. Screen-level checklist

Before merging any screen, verify:

- [ ] Uses tokens only — no raw hex, rem, or px-in-component values for color/spacing
- [ ] Typography matches the scale in §2
- [ ] Has correct 56px safe-area top padding (or safe-area-inset env var)
- [ ] Primary CTA is pill, full-width, ink-900 fill
- [ ] Cards use the hairline border + whisper shadow pattern
- [ ] No drop shadows heavier than §5 spec
- [ ] Navigation: back chevron top-left OR LoopStack wordmark at root
- [ ] Bottom safe-area accounted for (120px content padding when BottomNav present)
- [ ] All tap targets ≥ 44×44px
- [ ] Hairline dividers are 1px `--ink-200`, never thicker

## 10. Anti-patterns

Do **not**:

- Use gradient fills on cards, buttons, or icons (brand mark is the only exception)
- Use drop shadows heavier than `0 2px 12px rgba(0,0,0,0.04)` on a surface card
- Use colored card backgrounds except `--brand-primary-soft` for "in-range / positive" callouts
- Use emojis as UI icons
- Show more than one primary CTA per screen
- Use 700+ font weights
- Add border-radius smaller than 10px on any interactive surface
- Use system blue as a link color — links use `--brand-primary-hover`

---

*This doc is the contract. If a request contradicts it, call that out before coding and ask the user to confirm the override.*
