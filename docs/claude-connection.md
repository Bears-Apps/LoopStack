# Claude connection and clinic report

Researched October 28, 2026 against Anthropic, Apple and Claude support documentation.

## What is implemented

- **Profile → Claude** (`/app/settings/claude`). The user pastes a Claude Console API key and picks a model: Opus 5.5 (the default), Sonnet 5.5 or Haiku 5.5. They give explicit consent to sending data to a third-party AI, and can test the key. The test reads model metadata only, so it spends no tokens. Config lives in `src/data/claudeConfig.ts`.
- **Transport** (`src/lib/ai/claudeClient.ts`):
  - Uses the official `@anthropic-ai/sdk`, streamed, with `dangerouslyAllowBrowser`. WKWebView is a browser to the SDK, and Anthropic's CORS preflight allows the `capacitor://localhost` origin. This was checked with curl on 2026-10-28.
  - Effort is `high`.
  - Server-side refusal fallbacks (`fallbacks: "default"`) are on for Opus and Sonnet. Haiku has none.
  - An answer counts only if the final message has `stop_reason: end_turn`. A refusal, a `max_tokens` stop or an interrupted stream is an error, never a partial answer.
  - The SDK chunk (≈226 kB) is lazy-loaded on first use.
- **Clinic report** (`/app/report`; `src/lib/report/`). One pure builder, `buildClinicReport`, feeds three renderers: on-screen tabs of dropdowns, the jsPDF file, and a self-contained HTML dashboard. Because every renderer reads the same model, they can never disagree.
  - **Tabs** follow the clinician patient view endocrinologists know from Glooko and Omnipod Discover, in the order clinicians are taught to review AID data (PANTHER and the 2023 AID consensus: sufficiency → lows → highs → Loop use → settings):
    - **Summary**: the home screen's glance across 3/7/30/90/180 days with its thresholds, an AGP-style time-in-ranges column with goals, CGM wear, lows and hypo events, then insulin, carbs and Loop use.
    - **Overview (AGP)**: the AGP percentile curve, 24 hourly stacked bars and meal panels.
    - **Daily**: the last 7 and 30 days day by day, by weekday, and the weekday × hour grid (median mg/dL in every cell).
    - **Insights**: what to act on, lows first, each naming the lever to review (never a value); Claude's notes; in Full, correction-bolus outcomes.
    - **Devices & settings**: Omnipod Discover-style Start | End | value tables.
    - **Analyses**: Full mode only.
  - **HTML dashboard layout**: a Glooko-style clinician view. A patient band with context chips, underlined tabs, and a card grid where short cards pair up and charts or wide tables span the row. Method notes fold away, and a Print / Save as PDF button prints every tab. The layout is like Glooko's; the branding stays LoopStack.
  - **Modes.** Brief opens every section. Full opens the read-first tabs and adds every schedule segment and all analyses.
  - **Options.** A 14, 30 or 90 day period, and an optional patient name, printed on the exports only.
  - **Sample data** is labelled on the screen and in both exports.
  - **Export** on iOS goes Filesystem cache → iOS share sheet; in the web preview it downloads. The HTML dashboard makes no network requests and is marked `noindex`.
  - A `3d` metrics range was added to the shared engine for the glance. The home selector's own range list is unchanged.
- **Claude discussion notes** on the report:
  - Uses structured outputs (`FEEDBACK_SCHEMA`) and a validated parser.
  - The user previews the exact JSON before sending. The patient name is never included.
  - Notes appear as a dashed "AI-generated · not clinician-reviewed" section and can be left out of the PDF.
- **Ask data → Ask Claude.** Sends the same allowlisted evidence as the copy button, after a preview. The answer streams in and is marked provisional until the model finishes.

## Apple Health and Claude: research findings

- **Claude's own iPhone app has an Apple Health connector.** It is in beta, for Pro/Max, US only, and launched 2026-01. It reads activity, workouts, vitals, body measurements, sleep and nutrition. **Blood glucose and insulin are not listed**, and a third-party app cannot feed data into it. The practical bridge is to export the PDF here and attach it to a Claude conversation. ([support](https://support.claude.com/en/articles/11869619-use-claude-with-ios-apps), [launch](https://www.anthropic.com/news/healthcare-life-sciences))
- **There is no "Sign in with Claude" for third-party apps.** Subscription OAuth is reserved for Anthropic's own apps, and API keys are the sanctioned route. ([support](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account))
- **App Attest is the only path without an on-device key.** It issues 1-hour tokens but is only available through the beta "Claude for Foundation Models" Swift package on iOS 27, so it can't be used from this WebView yet. ([docs](https://platform.claude.com/docs/en/manage-claude/app-attest))
- **An MCP connector would need a public HTTPS server.** Claude only reaches remote MCP servers, so derived health data would leave the phone for a server before reaching Anthropic. That isn't worth it for a personal app.
- **Anthropic does not train on API data by default.** Its retention pages disagree: one says 30 days, another says not retained by default. The in-app copy therefore makes no retention claim. ([privacy](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training))

## Compliance notes (App Store / HealthKit)

- **App Review 5.1.2(i)** requires disclosing third-party AI and getting explicit permission. The consent checkbox names Anthropic's Claude, and each request has its own preview and send button.
- **HealthKit guidance:** HealthKit data may be shared with a third party only with express permission, and only "if they also provide a health or fitness service". How App Review applies this to a general AI processor is untested. For TestFlight-external or App Store distribution, the privacy policy must name Anthropic.
- Health data (PHI) never goes into JSON schemas. Schemas are cached by the API, and ours are generic.

## Open items

1. **Move both AI keys** (Claude and OpenAI) from WebView localStorage to the iOS Keychain through a small native plugin. Suggest an expiring, workspace-scoped key with a Console spend limit.
2. **App Intent "Get LoopStack summary"** so Shortcuts can pass it to the Claude app's "Ask Claude" intent. That would use the person's subscription with no API key.
3. **App Attest** through Claude for Foundation Models once iOS 27 ships.
4. **Device verification.** Streaming on device and the share sheet are covered by build and preflight checks only, not yet run on an iPhone.

## Clinician research behind the report

- **Omnipod Discover physician report** (US full release 2026-10-12): a 1-page Summary, a Daily report and Settings. The Summary covers TIR, glucose metrics, device use (automated-mode %), AGP with boluses by time block, a settings strip and an insulin summary. Loop equivalents:
  - Automated mode → closed-loop %
  - Activity → overrides
  - Target Glucose → correction range
  - I:C / correction factor → carb ratio / ISF

  One difference changes how a clinician reads the settings: on Loop, the basal schedule *drives* automation. The report states this explicitly. ([sample report](https://www.omnipod.com/sites/default/files/omnipod-5_discover_report_mgdl_ae-en.pdf), [PANTHER](https://www.omnipod.com/sites/default/files/omnipod-5_panthertool_mgdl_qa-en.pdf))
- **Review order and thresholds:**
  - Data sufficiency: at least 14 days with CGM worn 70% of the time or more.
  - Time below range: under 4% below 70, under 1% below 54. Fix lows first.
  - Time in range above 70%. Time above range under 25% above 180 and under 5% above 250.
  - CV at or below 36%.
  - Settings move in steps of about 10–20%, one at a time.

  ([TIR consensus](https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/), [AID consensus 2023](https://academic.oup.com/edrv/article/44/2/254/6692818), [ADA 2026 §7](https://pmc.ncbi.nlm.nih.gov/articles/PMC12690173))

## Report clinician metrics (implemented)

The snapshot's raw streams are too short for these (HealthKit's `recentGlucose` holds 8 hours), so each source computes them from its long reads with the pure modules in `src/lib/metrics/` (`computeClinicianMetrics`). They are snapshot fields with the usual origin and staleness, and use the user's own thresholds from `loadTargetRange()`. Glucose-only views are keyed by report period (14/30/90 days); meal, correction and temp-basal reads use the source's 30-day meal window and say so.
- **Hypoglycaemia events** (`hypoEvents.ts`): 15+ consecutive minutes below low and below urgent low, ending after 15 minutes back above. Count per week of CGM data held and median duration, split day and overnight (00–06). Overview → "Lows: events and overnight"; the top rows of Trends to act on.
- **Overnight (00–06) time below range**: same module and section.
- **AGP percentile curve** (`agp.ts`): 5/25/50/75/95 in 48 half-hour bins over a 1-hour moving window. Hour & day, drawn by the screen, the PDF and the HTML dashboard from shared geometry (`src/lib/report/agpChart.ts`).
- **CGM wear %** (`agp.ts`): occupied 5-minute slots. The first fact of the selected period.
- **Meal panels** (`mealPanels.ts`): breakfast 05–11, lunch 11–16, dinner 16–22. Pre-meal glucose, the 2-hour change (AID goal: a rise under 60 mg/dL), the 3–4 hour mean, % of days with an entry, and bolus lead time (Full). Hour & day. A median rise of 60 or more over 5+ meals becomes a Trends row.
- **Correction-bolus outcomes** (`correctionOutcomes.ts`, Full): clean boluses (0.5 U+, no carbs within 3 h, not stacked), the 2- and 3-hour change against dose × ISF × the share of insulin acted. Follows the insulin owner in the combined source.
- **Time at max basal and zero temps per day** (`tempBasalUse.ts`, Full): from Nightscout temp basals, each ended at the next temp, back-to-back zero temps merged. Apple Health has no temp basals, so it reports none.
