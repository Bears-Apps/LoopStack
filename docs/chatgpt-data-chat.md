# Ask your data: implementation and connection requirements

Verified October 4, 2026 against official OpenAI documentation.

## Release verification

Version 0.1.0 build 26 was archived with Xcode 26.6 / iOS 26.5 SDK and
uploaded to App Store Connect on October 4, 2026. Xcode reported
`Upload succeeded` and `Uploaded package is processing` at 07:59 local time.
This confirms upload, not completed Apple processing or tester-group availability.
All 652 tests and the production build passed before native sync and archive.
The release includes local evidence review, not a live ChatGPT connection.

## What is implemented

`/app/chat`, labelled **Ask data** in the five-item footer, is an on-device
evidence review. It runs against the active DataSource snapshot and its existing
one-owner-per-stream policy. Profile provides a second entry point.

Two reports work now: the last three combined sittings containing an exact written
food label, and weekday/hour glucose patterns over 30, 90 or 180 selected days.
The question is carried into a copyable ChatGPT prompt; the local summary answers
the selected report topic, not arbitrary natural-language follow-up questions.
Session history is ephemeral and resets on a source switch. Nothing on this screen
calls OpenAI. Copying a report is the explicit sharing action; no health-data URL
parameters or automatic uploads. A failed clipboard write exposes selectable text.

This is a working foundation, **not a completed ChatGPT connection**. No live OAuth,
token storage, inference transport or model conversation is implemented yet.

## Official integration facts

- [Quickstart](https://developers.openai.com/siwc/quickstart): eligible Plus/Pro
  users can authorize plan usage separately from identity. Signing in does not
  grant access to ChatGPT conversations.
- [Availability](https://developers.openai.com/siwc/token-sharing-open-source):
  the direct flow is documented for open-source and locally hosted apps; paid or
  remotely hosted apps use the interest/approval path. A personal iPhone install
  is not automatically established as eligible by these docs. Confirm native
  distribution eligibility before choosing the auth implementation. Publishing
  this private repository as open source requires a separate explicit decision.
- [Registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in):
  system browser, Authorization Code + PKCE/S256, state and nonce, persisted
  installation host UUID, dynamically issued client ID, verified ID token/JWKS
  and granted scopes. The documented direct callback is HTTP **127.0.0.1**, not
  an invented `loopstack://` callback. A native loopback listener plus browser
  return/lifecycle handling needs device validation or an approved alternate
  client/callback. No client secret is used by the direct flow.
- [Inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference):
  discover models with the account's token at `/v1/models`; call public
  `/v1/responses` with `store:false`, `stream:true`. Success requires
  `response.completed`; interrupted/failed/incomplete streams are failures even
  if they emitted text. Model slugs must come from the account catalog.
- [Preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations):
  send context/history on every HTTP request. No persistent hosted conversation,
  `previous_response_id`, hosted MCP, file search, Code Interpreter or tool search.
  Use instructions/developer messages; omit unsupported request fields.
- [UX](https://developers.openai.com/siwc/ui-ux-guidelines): approved **Continue
  with ChatGPT** button, first-use plan confirmation, connected account,
  **Using ChatGPT plan**, Manage usage and honest limit/recovery states.

## What remains to enable in-app AI

1. Confirm eligibility for this private TestFlight native app (or obtain approval).
   Obtain the approved client/callback contract if the direct flow is unsuitable.
2. Implement auth and token refresh in a native protected runtime. Store credentials
   in iOS Keychain, not WebView localStorage; isolate state/PKCE attempts, verify
   issuer/audience/nonce/expiry/signature and scopes, handle denied consent and logout.
3. Implement a native streaming transport with cancellation, expiration/refresh,
   quota/usage-unavailable recovery and terminal-event validation. Do not repurpose
   the nutrition API key setting or switch to separate billing silently.
4. Wire the tested request/stream contract into that transport. Per-question
   evidence preview and permission must precede health-data transmission. Keep
   conversation memory local, scoped to source/account, deletable and bounded.
5. Generalize retrieval via read-only local functions for meals, hourly samples,
   activity/steps/HR/sleep, settings history, absorption observations and overrides.
   Tool arguments need validation and date/sample limits. Models explain app-derived
   evidence; they must not invent delivery or perform therapy arithmetic.
6. Evaluate with missing insulin, duplicate records, similar food names, combo
   meals, sensor gaps, source mismatch, DST, incorrect ISF, usage limits and prompt
   injection in food labels. Verify on device; no clinical accuracy claim from tests.

## Evidence boundaries in this release

Food identity is exact normalized text, not absorption icons or fuzzy similarity.
Carb entries chain within two hours using the existing combined-meal rule. Bolus
records include a 30-minute pre-meal window and the logged absorption horizon,
cut off at the next sitting or now. Insulin timing is **not causal attribution**.
No absence of records is labelled zero delivered insulin.

Explicit temp basals are integrated against the current user-transcribed schedule.
A replacement cancels the old temp permanently. Above- and below-schedule insulin
are separate, gaps remain unknown, and records missing duration/rate invalidate the
comparison. Historic schedule changes and full scheduled delivery remain unavailable.
Glucose peak is labelled glucose peak, never measured carb absorption.

Weekday/hour patterns require six readings in each of three independent weeks.
The app displays low reading share, not time-weighted low time or diagnosed episodes.
Coverage uses occupied five-minute slots across the selected interval, not elapsed
span between first and last reading. Fetch caps can still truncate history.

Steps/HR/sleep, overrides, illness and historic settings are explicitly absent from
this first report. No sensitivity or therapy adjustments are derived here. Chat
allows historical insulin quantities but no prospective dosing, timing prescriptions
or generated Loop code changes; the meal-strategy carve-out does not extend to chat.
