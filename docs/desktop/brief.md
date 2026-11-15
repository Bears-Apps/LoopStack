# LoopStack desktop brief

Working brief for the LoopStack desktop app: a downloadable desktop client with
a fully customizable dashboard for the person who loops, and a care-team review
view in the same app. It began as "LoopStack+", a phone-width care-team SaaS;
on 2026-11-13 Ryan corrected that (see §1). The early design run (10 app icons,
each with a low-fidelity dashboard) predates the correction. The must-have feature list
is completed from the Loop / clinician research in
`diy-loop-clinician-research/` once it finishes. Until then, everything below
the principles is a draft.

---

## 0. Positioning: what it says in the first second (Ryan, 2026-11-13)

LoopStack must say at once that it is **the companion app for people who
use open-source Loop**. It helps them organize, understand and share their
data around what *they* want to know, and turn it into actionable insights on
their own and with their care team.

- **Definition line** (welcome screen, App Store subtitle, page title):
  *The companion app for people who loop.*
- **Promise** (under the name): **Organize. Understand. Share.**, with one
  line beneath: *Your Loop data, organized around what you want to know.
  Insights you can act on, on your own or with your care team.*
- **Compatibility line**, visible before sign-in: *Works with Loop · Trio ·
  iAPS · AndroidAPS.* This is how a Loop user recognizes the app as theirs.
- **For clinicians** (invite email, clinician welcome): *A 1–2 minute read of
  your patient's Loop data, in the report format you already use.*
- **Not-affiliated note** (footer, store listing): *LoopStack is
  independent and not affiliated with LoopKit, Tidepool, Dexcom or Insulet.
  It never changes your pump or Loop.* Using "Loop" in copy must not imply
  official affiliation.

Where it shows: the cover and welcome screen lead with the definition line
and promise; every dashboard header carries the compatibility line or the
system card ("Loop 3.6 · Omnipod DASH · Dexcom G7"); each tracker's glance
face is phrased as an answer to something the person chose to know in setup.

## 1. What it is

One product, **LoopStack**, on two surfaces (Ryan, 2026-11-13):

- **LoopStack on the phone** (`src/`, iOS via Capacitor): the in-the-moment
  app. Glucose now, heads-ups, the day tracker, logging. Ryan's own data from
  Apple Health and/or Nightscout; nothing sent to a shared service.
- **LoopStack on the desktop** (`desktop/`, a downloadable Electron app): the
  review surface, where there is room to compare. Two views in one app:
  - **My dashboard:** a fully customizable grid of trackers (drag, resize,
    add, presets) for the person who loops.
  - **Care-team review:** the clinician's 1–2 minute read of a **review
    packet** the person chose to share, in a fixed layout. Not a live feed.
  The portfolio build runs on synthetic patients.
- One analysis engine (`src/lib/metrics`, `src/lib/metabolism`) under both.
- Naming: "LoopStack" for both surfaces. "LoopStack+" is retired; don't use
  it or invent other names. "the desktop app" and "the phone app" are
  descriptions, not names.

**The correction, and why:** the first pass assumed the care-team product would
be phone-shaped (a 390px web app with a tab bar and bottom sheets). Review
work is comparison work: the 14-day × 24-hour grid, the AGP curve, before and
after, and a clinician's read all want width, side-by-side detail and a
layout the person arranges. The phone stays the glance; the desktop is where
people review, arrange and share.

## 2. Design principles (Ryan, 2026-11-13)

1. **Detail complexity while showing simplicity.** Loop is already a
   complicated application. LoopStack carries many features, but no screen
   should feel like it. Every surface leads with the simple read, and the
   detail is one deliberate step away, never removed.
2. **Each person chooses what they track.** A customizable dashboard: each
   person who loops picks the stats and trackers they want to see every day.
3. **Beautiful, and instantly comprehensible.**
4. **Familiar to Loop users.** It should read like Loop's own screens, using
   Loop's vocabulary and chart grammar.
5. **10× simpler for the care team.** What the patient explores across many
   trackers reaches the clinician as a TLDR they can read in under a minute,
   in the formats they already review every day (Dexcom Clarity, Glooko, the
   AGP report).

### What the principles mean in practice

- **Two faces for every tracker.** A *glance* face (one number or one
  sentence, plus a small trend) on the dashboard, and a *detail* face (the full
  chart, the evidence, the caveats) one tap in. Tapping in is how the detail
  stays available; the dashboard itself stays simple.
- **The patient's dashboard is customizable; the clinician's view is fixed.**
  A clinician reviewing twenty patients a day needs the same layout every time,
  to build muscle memory. Patient customization never changes what the care
  team sees first. The patient's pinned trackers are available to the
  clinician as a secondary tab.
- **Never start from a blank canvas.** Customization starts from presets, for
  example *New to Loop*, *Tuning settings*, *Active / athlete* and
  *Parent or caregiver*. The person then adds, removes and reorders from there.
- **Non-negotiable trackers are on every dashboard** (section 3). They can be
  reordered but not removed.

## 3. Non-negotiables

1. **Daily trend alerts.** A heads-up two hours before a weekday stretch that
   usually runs low or high (`src/lib/alerts/trendHeadsUp.ts`). The bar is 10%
   of readings, over 12 weeks, with at least 3 weeks behind each hour and at
   most 3 heads-ups a day. Each alert opens the day tracker with the stretch
   shaded.
2. **The day tracker.** Glucose, insulin on board, carbs on board and
   exercise for each hour of each weekday, on one time axis, to prevent
   routine lows and highs (`src/screens/WeekdayHours`). Exercise was added on
   2026-11-13.

## 4. The doctor TLDR (draft, to check against the research)

The standard clinic glucose report (the AGP) shows *what* glucose did. It cannot
show *why* on Loop, because Loop changes insulin delivery every five minutes.
So the TLDR is the familiar AGP read plus the three things only LoopStack
can add.

**Shape: one headline, three lines, one ask.**

> **14 days:** time in range 74% (↑3 since last visit) · below 70 2.1% · sensor worn 96% · looping 94% of the time
>
> 1. **Pattern:** Fridays 3–6pm run low in 48% of readings, 4 of 4 weeks. Each follows a lunchtime run.
> 2. **What Loop did:** most mornings 6–9am Loop delivers less than the scheduled basal. It is working against a basal rate that may be set high.
> 3. **Since last visit:** carb ratio 1:10 → 1:9 on Oct 2. Lunch peaks are down 20 mg/dL. Nothing else changed.
>
> **Patient asks:** use an exercise preset on Fridays, or lower Friday afternoon basal?

Rules the research so far supports:

- **Page one is glucose only, in the AGP layout clinicians already know.**
  In one study (Mullen 2025, 139 patients and parents, 17 clinicians), only 38%
  read a combined glucose-plus-insulin report correctly. Insulin goes on page
  two, translated into plain statements.
- **No bolus/basal ratio.** Under Loop it is mostly an artefact of the
  algorithm. LoopFollow reviewers rejected an endo report over exactly this
  ("can steer appointments in the wrong direction").
- **Every claim links to its evidence** (the weeks, the readings) one click in.
- **Observations, never instructions.** "Loop delivers less than scheduled",
  not "lower your basal". The decision belongs to the clinician and the
  patient together.
- **Show what changed, who changed it, and whether it worked.** Settings
  changes between visits are invisible to clinics today.

## 5. Meeting clinicians inside the tools they already review

LoopStack should not ask a clinician to adopt a new daily dashboard. It should
look like what they already read and drop into where they already work.

| They already use | What they recognize | What LoopStack does |
|---|---|---|
| **Dexcom Clarity** and the **AGP report** | Time-in-range bar, GMI, variability (CV), sensor wear, the overlaid daily curve with percentile bands, consensus targets (>70% in range, <4% below 70, <1% below 54) | Page one of the TLDR *is* that report: same metrics, same order, same targets, same colours |
| **Glooko** and clinic population views | A patient list with flags for who needs attention | The care-team queue uses the same triage idea and familiar flags (low time in range, too many lows, low sensor wear), plus Loop-only flags: *looping less than usual*, *settings changed since last visit*, *patient question waiting* |
| **Loop** itself (on the patient's phone, often shown at the visit) | Loop's status screen: glucose, active insulin, active carbs and insulin delivery on one time axis; Loop's terms (Overrides, Presets, Correction Range, Carb Ratio, ISF) | The "what Loop did" page uses Loop's chart grammar and words, so anyone who has looked at a Loop phone can read it |
| **The EHR** | A PDF in the chart, a note | A one-page PDF in AGP style for the chart, and visit-note text they can paste |

## 6. Design run deliverable

Ten app-icon directions for LoopStack, in the LoopStack mark family (the
stacked diamonds inside the green ring). Each comes with a low-fidelity
dashboard. All ten dashboards carry the same must-have features and
non-negotiables; they differ in layout, hierarchy and emphasis. Every
dashboard shows:

- the patient's customizable daily dashboard, with the two faces and the
  preset starting point,
- the fixed clinician TLDR (section 4),
- the daily trend alerts and the day tracker.

Grounding: `docs/brand.md`, `docs/visual-system.md`, `references/`, and Ryan's
design-taste skill. No new visual direction without a reference.

## 8. First screens: the setup questionnaire (Ryan, 2026-11-13)

LoopStack opens with a short questionnaire on each side. It organizes three
things at once: the patient's tailored experience, the clinician's interface,
and the export. Rules:

- **One question per screen**, with a progress indicator, about 8 screens per
  side.
- **Every question says what it changes**, for example *"This sets your
  dashboard"* or *"This sets what your endo sees first."* No question is
  asked only to collect data.
- **Each question has a sensible default and can be skipped.** Every answer
  can be changed later in Settings.
- **It ends on a "Your setup" screen** that previews the result (the dashboard,
  the care team and their levels, the export plan), with *Looks right* and
  *Change something*.
- Where the review packet already holds the answer (system, version, data
  source), the question is pre-filled for the person to confirm, not typed.

### Patient path (sets up the tailored experience)

| # | Question | Answers | What it configures | Grounded in |
|---|---|---|---|---|
| 1 | Who's setting this up? | I loop · I'm a parent or caregiver · I'm a teen (with a parent) | Caregiver features, who-gave-this-dose labels, teen sharing controls | Parents and pediatric topic |
| 2 | Which system do you use? *(pre-filled)* | Loop · Trio · iAPS · AndroidAPS · Tidepool Loop / twiist · Not looping yet | System card, settings-translator vocabulary | Clinician knowledge topic |
| 3 | How long have you been looping? | Under 3 months · 3–12 months · Over a year | *New to Loop* preset; extra check-ins in the first 3 months, when people most often stop | Discontinuation, published studies |
| 4 | What do you want help with? *(pick any)* | Fewer lows · Fewer highs · Tuning settings · Exercise · Meals · Overnight · School or work days · Feeling less worn out | Which trackers and trend alerts lead; the starting preset | Meals and exercise, settings tuning |
| 5 | Which days are usually different? | The weekday strip (S M T W T F S): tap active, workday or school days | Where the day tracker opens; which heads-ups to watch first | Non-negotiables |
| 6 | Pick your daily dashboard | The preset recommended from 1–5, shown as a preview; edit to add, remove or reorder | The customizable dashboard; trend alerts and day tracker pinned | Design principles |
| 7 | Does your care team know you loop? | Yes · Not yet · Not sure how to tell them | *Not yet* or *Not sure* opens the guided disclosure brief (what I use, how it's set up, my results, my backup plan) | Disclosure topic |
| 8 | What would you like from them? | Prescriptions and supplies only · Aware · Prescribe and review · Advise on safety settings · Co-manage settings | The proposed level of involvement, which the clinician confirms. *Prescriptions and supplies only* shares the device and glucose pages without the algorithm detail, so supplies never depend on full disclosure | Disclosure, liability, prescriptions and supplies |
| 9 | What should your review packet include? | Always: the glucose page. Optional: what Loop did, settings changes, activity, meals, notes. How often: before each visit · monthly · when I ask a question | The review packet and its schedule | Data sharing |
| 10 | A quick baseline? *(optional, 3 questions)* | How you're sleeping · how much you worry about lows · how worn out diabetes leaves you, each on a 5-point scale | The starting point for the before-and-after report; repeated every 3 months beside the glucose report | Published studies, discontinuation (people who stop are more likely to report low trust in Loop and emotional strain than worse glucose) |

### Clinician path (sets up the clinician interface, on accepting an invite)

| # | Question | Answers | What it configures | Grounded in |
|---|---|---|---|---|
| 1 | Your role | Endocrinologist · Diabetes educator (CDCES) · Primary care · Nurse · Dietitian · Pediatric | TLDR depth and which page-two sections lead | Clinician knowledge |
| 2 | How familiar are you with DIY Loop? | New to it · Some · Experienced | Settings translator and glossary on by default for *New* and *Some*; a 2-minute orientation for *New* | Clinician knowledge (63% cite their own limited knowledge) |
| 3 | Confirm your involvement with this patient | The same six-level list both sides use: Prescriptions and supplies only · Aware · Prescribe and review · Advise on safety settings · Co-manage · Refer (clinician only), with the patient's request shown | The care agreement. Which actions appear: Agree / Modify / Discuss only from *Advise* up | Liability, disclosure |
| 4 | Which tools do you already review in? *(pick any)* | Dexcom Clarity · Glooko · Tidepool · LibreView · An EHR (Epic, Oracle Health, other) | Page one matches the AGP layout they know; export format defaults | Existing tools |
| 5 | When do you want to review? | Before each visit · Monthly · Only when flagged | Queue cadence; flags on the standard thresholds (very low >1%, low >4%, time in range dropped >15% or under 65%, sensor wear <70%), editable | Existing tools (TIDE) |
| 6 | Units and targets | mg/dL · mmol/L; consensus targets by default, adjustable per patient | Every chart and the export | AGP consensus |
| 7 | Acknowledge the care agreement | The dated acknowledgement in the 2022 consensus format, with the system named | The responsibility record; exportable to the chart | Liability |

### Export setup (both sides, last step before *Your setup*)

- **Format:** expiring secure link · one-page AGP-style PDF for the chart ·
  visit-note text to paste · later, EHR integration.
- **Recipients:** the care team. Second wave: letters for a GP, pharmacy,
  hospital or school.
- **Preview:** a thumbnail of exactly what the clinician will receive, so the
  patient sees what they're sharing before it goes.

## 7. Must-have features (from 8 of 16 research topics, 2026-11-13)

Settings tuning, build burden, meals and exercise, data sharing, disclosure,
clinician knowledge, liability and published studies all point to the same
core. Ranked by how many topics name it and how severe they rate it:

| # | Feature | What it is | Why (research) |
|---|---|---|---|
| 1 | **Visit TLDR and review packet** | Headline, three lines and one ask (section 4). Page one: 14-day AGP, glucose only. Page two: *what Loop did* (scheduled vs delivered basal, automatic vs manual insulin, overrides, time not looping). Sent as an expiring link plus a PDF; the clinician never logs into the patient's Nightscout. | Data sharing (High), clinician knowledge (High). Clinics have nothing to download from a Loop user. |
| 2 | **Settings timeline** | Every change as a dated diff, with who suggested it (self, parent, peer, clinician, algorithm), why, a clinician *seen* state, and a before-and-after window (time in range, lows, overnight, after meals) over the following days. | Settings tuning (High). Loop keeps no settings history (open GitHub issue #2234). |
| 3 | **Proposal thread** | Proposed → agreed → applied by the patient → graded, in either direction. Large steps (over 10–20%) and safety-limit edits are flagged. LoopStack never writes to a pump or to Loop. | Settings tuning, liability (High). Keeps the clinician advisory and the tool out of dosing. |
| 4 | **System card** | App and version, build expiry, phone and OS, pump or pod and firmware, CGM. Time looping, with each gap labelled by cause (app expired, lost connection, CGM gap, pod fault) so a gap isn't read as non-adherence. | Build burden, liability. |
| 5 | **Settings translator** | Each Loop or Trio setting next to the standard pump term clinicians know; settings with no equivalent (glucose safety limit, max basal, max bolus) flagged with their safety role. Structured on CARES, the format clinicians use for commercial AID. | Clinician knowledge (High). 63% of UK clinicians cite their own limited knowledge. |
| 6 | **Care agreement** | The first disclosure as a guided brief (what I use, how it's set up, outcomes, backup plan). The clinician picks a level of involvement: *aware*, *prescribe and review*, *advise on safety settings*, *co-manage* or *refer*. A dated acknowledgement in the 2022 consensus format, exportable for the chart. | Disclosure, liability (High). The usual stance is "don't ask, don't tell"; liability is now the main worry. |
| 7 | **Trend alerts and day tracker** | Non-negotiables (section 3). | Ryan. Meals and exercise research: nobody shows how activity lines up with lows. |
| 8 | **Customizable dashboard** | Glance and detail faces, presets, non-negotiables pinned (section 2). | Ryan. |
| 9 | **Care-team queue** | The Stanford TIDE flags Tidepool and Glooko already use (very low >1%, low >4%, time in range dropped >15%, time in range <65%, sensor wear <70%), then LoopStack's own: *automation down*, *settings changed*, *question waiting*. | Existing tools: DIY patients drop off the clinic's triage list because Glooko and Clarity can't read DIY data. Only 45% of clinicians have time to review CGM data. |

**What Loop did, in the clinicians' terms (data-interpretation topic):**
Loop adjusts basal at least 83% of the time (median), and those adjustments
make up 54% of all insulin delivered (Lum 2021, n=558), so a printout of the
settings says little. Page two uses the 2023 Endocrine Reviews consensus
terms, **algorithm-modulated vs user-initiated insulin**, instead of
basal/bolus. It shows delivered vs scheduled basal by hour, the settings
actually in force after overrides, and a **safety-limit panel**: how often
the glucose safety limit, max basal and max bolus were hit. That consensus
proposes a two-page AID report for commercial systems only; LoopStack's
two pages are the DIY equivalent.

**How clinicians review (existing-tools topic):** enough data, then lows,
then time in range, then the AGP curve, then daily views. Commercial AID
reviews add *time in automation*, meal boluses and settings. A Stanford
educator review took about 2 minutes in Clarity and about 1 minute with the
AGP built in. The TLDR follows that order and uses the term "time in
automation".

**Second wave:** a meal and activity ledger (overrides and workouts against
the next 24 hours; flags for duplicate or missed carb entries); portable
letters for a GP, pharmacy, hospital or school; a "my own evidence"
before-and-after report from a baseline; expiry and "safe to update iOS?"
reminders; visit-note export.

**Out of v1:** EHR/FHIR integration, the endocrinology–primary care handoff,
billing support.

**Still to come from the research:** existing tools (how clinicians review in
Dexcom Clarity and Glooko; it may reshape #1 and #9), the peer community,
DIY vs commercial systems, parents and pediatric clinics, the
data-interpretation gap, discontinuation, prescriptions and supplies, and
clinics that support looping. These refine the list; none is expected to
replace its core.
