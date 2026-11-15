# AI macro estimation

`CaptureFlow` AI section → `src/lib/ai/macroEstimator.ts`, configured in
`src/data/aiConfig.ts`, settings UI in `SourcesSettings`.

Read [dose-suggestion.md](dose-suggestion.md) first — this feeds that engine and
inherits all of its safety constraints.

## What it is, honestly

An OpenAI call that turns a plain-English meal description into per-item
macros (carbs / fiber / fat / protein) and an absorption-time guess. It is a
faster, smarter alternative to the structured builder for producing the `Macros`
that feed `computeMealStrategy`.

## The hard facts about "connect ChatGPT"

- This nutrition implementation uses an API key from platform.openai.com,
  billed separately from ChatGPT. OpenAI introduced Sign in with ChatGPT for
  eligible apps in September 2026; that is a separate integration, not this key.
  See [data chat](data-chat.md) and `docs/chatgpt-data-chat.md` for current requirements.
- OpenAI **blocks browser-origin API calls** (CORS). On device the call routes
  through `CapacitorHttp` (native, no CORS); in the web preview it will fail.
  That is expected — web preview is mock-only anyway.
- The key is stored in `localStorage` on device. Acceptable for a personal
  single-user tool; do not reuse this pattern for a multi-user product.

## Safety model — non-negotiable

The model estimates **nutrition only**. It never returns a dose. Its numbers
flow through the same `computeMealStrategy`, so the real time-of-day carb ratio,
net-carb logic, split rules, and "estimate — check before you dose" framing all
still apply.

Two arithmetic guarantees enforced in `parseEstimate`, which is pure and tested:

1. **The total is summed in-app from the per-item numbers**, never read from any
   model-provided `total`. The app owns the arithmetic that becomes a dose.
2. **Every value is clamped.** Per-item carbs/grams capped at 400; fiber clamped
   to ≤ carbs so net carbs can't go negative; absorption to [1, 8]. A
   hallucinated 4000g item is rejected, not dosed.

Model confidence maps to honesty downstream: a non-`high` estimate passes its
caveats as `unquantifiedNotes`, which lowers the dose card's own (still-capped)
confidence. A meal the model was unsure about produces a visibly less confident
dose.

## Fallback

No key / disabled → the AI section shows a link to Settings and the
deterministic builder below works unchanged. The AI is strictly additive; the
app is fully functional without it.

## What is unit-tested vs not

- Tested (pure): `parseEstimate` (all clamps, the self-summed total, bad JSON,
  empty items) and `buildMessages` (strict-JSON + no-dosing instructions).
- Not tested: the live network call. It is isolated in `estimateMacros` behind
  friendly errors so a failure falls back to the builder rather than crashing.

## When not to use

Do not let AI output bypass `computeMealStrategy` to produce a dose directly,
and do not raise the confidence cap because "the AI seemed sure." The model
estimates food; the engine and the human own the dose.
