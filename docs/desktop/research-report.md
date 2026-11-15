# LoopStack: what to build first

Research synthesis for review before anything is built. 13 November 2026.

**What we'd like from the reviewer:**
1. Is the ranking right?
2. What's missing?
3. Which risks are underrated?
4. A view on the five open decisions near the end.

---

## Context

- **LoopStack** is a local app: one person's own Loop data, on their own
  phone and computer.
- **LoopStack** is the care-team workspace. A person who loops publishes a
  *review packet* from LoopStack. In LoopStack they and their
  endocrinologist or diabetes educator review it, agree on settings changes
  and follow up. It is a portfolio build on synthetic patients.
- **The research:** 16 topics on DIY Loop and other open-source automated
  insulin delivery (Trio, iAPS, AndroidAPS, OpenAPS) since 2018, with
  emphasis on the relationship with the care team. 284 unique sources:
  peer-reviewed studies, professional guidance, project documentation and
  GitHub. Each topic's file passes a field-coverage check, and uncertain
  values are marked (127 fields across 16 files).

## The biggest pain point

Taking management into their own hands moved the main clinical lever,
**therapy settings**, from the clinic to the person and their peers, and
nothing records it.

- **Clinics have nothing to read.** Glooko and Dexcom Clarity can't display
  DIY data, so people who loop drop off the clinic's triage lists. Data
  reaches the clinic only through routes the patient builds (Nightscout
  links, Tidepool, home-made PDFs). No standard clinic report exists for DIY
  systems. Three community attempts in 2026 were closed unmerged, one
  because unvalidated numbers "can steer appointments in the wrong
  direction" (LoopFollow PR #671).
- **The relationship defaults to "don't ask, don't tell".** In the UK
  survey (Crabtree 2022, n=317, fielded 2019), 91% of clinicians would not
  start a conversation about it. In a Canadian survey (n=204, 2021), 21.6%
  were comfortable supporting DIY systems against 72.7% for commercial ones.
  The usual reaction is not hostility: keep prescribing, review the CGM, and
  don't touch the settings.
- **Settings change with no shared record.** Loop keeps no settings history
  (open GitHub issue #2234). Peers do most of the fine-tuning (Cleal 2025,
  n=383, 29 countries). No study measures how often settings change between
  visits.
- **Liability, not legitimacy, is now the main worry.** The ADA Standards
  (2025–26) say clinicians should support and advise people who choose
  open-source systems, and Diabetes Canada (2023) calls refusal
  gatekeeping. UK legal analysis places the real exposure in inaccurate or
  undocumented advice.

**The gap:** a shared, attributed record of *what changed, who changed it,
and whether it worked*, in the formats clinicians already read, readable in
1–2 minutes.

## Ranked features for v1

| # | Feature | What it does | Evidence |
|---|---|---|---|
| 0 | **Setup questionnaire** (first screens) | One question per screen, about 10 for the patient and 7 for the clinician, plus export setup. Every answer configures something visible: the dashboard preset, the clinician's level of involvement and what they see first, the export. Ends on a "Your setup" preview. | Built from the topics below |
| 1 | **Visit TLDR and review packet** | One headline, three lines (pattern, what Loop did, since last visit) and the patient's question. Page one: a 14-day AGP, glucose only. Page two: what the algorithm did. Sent as an expiring link plus a PDF for the chart. | Data sharing, existing tools, data interpretation (all High) |
| 2 | **Settings timeline** | Every change as a dated diff, with its source (self, parent, peer, clinician, algorithm, AI) and reason, a clinician "seen" state, and before-and-after results over the following days. | Settings tuning, clinic models (High) |
| 3 | **Proposal thread** | Proposed → agreed → applied by the patient → graded, in either direction. Large steps (over 10–20%) and safety-limit edits are flagged. | Settings tuning, liability (High) |
| 4 | **System card** | App and version, build expiry, phone and OS, pump or pod, CGM. Time in automation, with each gap labelled by cause (app expired, lost connection, CGM gap, pod fault) so it isn't read as non-adherence. | Build burden (Medium), liability (High) |
| 5 | **Settings translator** | Each Loop, Trio or AndroidAPS setting next to the standard pump term. Settings with no equivalent (glucose safety limit, max basal, max bolus, max IOB, SMB) flagged with their safety role. Structured on CARES, the format clinicians use for commercial systems. | Clinician knowledge, data interpretation (High) |
| 6 | **Care agreement** | A guided first disclosure: what I use, how it's set up, my results, my backup plan. The clinician picks a level of involvement. A dated acknowledgement in the 2022 international consensus format, exportable for the chart. | Disclosure, liability (High) |
| 7 | **Trend alerts and day tracker** | *Non-negotiable.* A heads-up 2 hours before a weekday stretch that usually runs low or high. A day tracker of glucose, insulin on board, carbs on board and exercise by hour for each weekday. Both already built in LoopStack. | Meals and exercise (safety High) |
| 8 | **Customizable dashboard** | Each tracker has a glance face and a detail face. Start from a preset (New to Loop, Tuning settings, Active, Parent or caregiver). Trend alerts and the day tracker are pinned. | Design principle |
| 9 | **Care-team queue** | The Stanford TIDE flags Tidepool and Glooko already use (very low >1%, low >4%, time in range dropped >15% or under 65%, sensor wear <70%), plus *automation down*, *settings changed* and *question waiting*. | Existing tools (High) |

## Rules the evidence sets

1. **Page one is glucose only, in the AGP layout clinicians know.** In
   Mullen 2025, only 38% read a combined glucose-and-insulin report
   accurately.
2. **Follow the clinician's review order:** enough data, then lows, then
   time in range, then the AGP curve, then daily views. Target 1–2 minutes;
   a Stanford educator took about 2 minutes per patient in Clarity and about
   1 with the AGP built in.
3. **Use the clinicians' vocabulary:** *time in automation*, and
   *algorithm-modulated vs user-initiated insulin* (2023 Endocrine Reviews
   consensus) rather than basal and bolus. **No bolus/basal ratio.** Loop
   adjusts basal at least 83% of the time (median), and those adjustments
   are 54% of insulin delivered (Lum 2021, n=558), so a settings printout
   says little.
4. **Observations, never instructions.** "Loop delivers less than
   scheduled", not "lower your basal".
5. **Never write to a pump or to Loop.** The patient applies every change
   in their own app. This keeps the clinician advisory and the tool out of
   dosing. Regulatory review still needed.
6. **Record every suggestion's source without judging it.** Peers, mentors
   and AI tools already advise people who loop. The clinic should see where
   a change came from.
7. **Graded disclosure.** A *prescriptions and supplies only* level, so
   getting supplies never depends on full disclosure. 90% of Loop users run
   on Omnipod (Lum 2021), and a supply request is often the first Loop
   conversation.
8. **The clinician never needs the patient's Nightscout address or API
   secret.** Links are expiring, scoped and revocable.
9. **The patient view is customizable; the clinician view is fixed.**

## Second wave

| Feature | Why |
|---|---|
| Meal and activity ledger: overrides and temp targets against workouts and the next 24 h; flags for duplicate or missed carb entries | Meals and exercise (safety High). Overrides never reach the clinic today. GitHub reports include a 40 g entry saved three times. |
| Caregiver features: who-gave-this-dose labels, a check that remote commands were delivered, teen sharing controls, a school-plan export | 34% of BC Diabetes installs are pediatric. Remote dosing is why parents choose DIY. School systems in Washington State and BC refuse DIY orders or care plans. |
| Portable letters for a GP, pharmacy, hospital or school | A pharmacist refused insulin after a patient disclosed looping (Elezzabi 2025). BC Diabetes issues a hospital letter. |
| Hardware and prescription ledger; payer-ready evidence exports | Prescriptions and supplies (High). Prior-authorization and renewal criteria, recalls, end-of-life pods. |
| "My own evidence" before-and-after report from a baseline, plus a short clinician evidence brief | Published studies. Puts each patient's results in the form studies report them. |
| Transition packet when switching systems | DIY vs commercial. Settings are re-entered by hand and history is lost at every switch. |
| Expiry and "safe to update iOS?" reminders | Build burden. |
| Clinic population view and opt-in outcomes export | Clinic-supported models (BC Diabetes affiliates report outcomes by hand). |

## Out of v1

- EHR/FHIR integration (Tidepool's Epic route shows where this goes later).
- The endocrinology–primary care handoff, and billing support.
- Building or distributing dosing apps.
- Any AI settings advice. In one 2026 test, the same AI settings tool
  suggested max insulin-on-board limits from 4 to 15 U across 50 runs.

## Open decisions

1. **Where the data comes from.** LoopStack was scoped as packet-only,
   with LoopStack doing all the reading locally. The settings timeline and
   "what Loop did" need Nightscout- or Tidepool-level data (overrides,
   Loop's status records), which Apple Health doesn't carry. Should
   LoopStack keep producing richer packets, or should LoopStack add
   read-only connectors?
2. **Caregivers in v1 or the second wave?** They are a large, motivated
   group with clear unmet needs, but they widen the scope.
3. **Pairs or clinics?** Build for one patient and their clinician, or also
   for clinics that run looping programmes like BC Diabetes (population
   view, affiliates, outcomes)?
4. **Translator scope.** Loop only first, or Loop, Trio and AndroidAPS?
   Trio and AndroidAPS use the oref algorithm family, with different
   settings and vocabulary.
5. **Synthetic only.** Confirm LoopStack stays a portfolio build on
   synthetic patients. Real patient data brings HIPAA and FDA
   clinical-decision-support questions.

## Caveats on the evidence

- **No study measures the relationship directly:** how many users
  disclose, how often settings change between visits, or whether clinic
  support keeps people looping.
- **Clinician surveys are old:** 2019 (UK) and 2021 (Canada), none since.
- **Samples skew** self-selected, white, high-income and privately insured.
  In the Loop Observational Study, 94% had private insurance and 70% earned
  $100K or more.
- **BC Diabetes outcomes** come from the programme's own staff, and its
  n=1,442 cohort is a conference poster.
- **Some figures** come from abstracts or secondary summaries and are marked
  uncertain in the topic files.
- **Corrections made along the way:**
  - The 5.3% "stopped Loop" figure is from Wong 2022, not the Loop
    Observational Study.
  - Cleal 2025 is a user study using 2018–19 survey data.
  - The Wong 2022 abstract and its table disagree on reason percentages.

## Key sources

- Braune et al. 2022, open-source AID international consensus, *Lancet Diabetes Endocrinol* — https://pmc.ncbi.nlm.nih.gov/articles/PMC8720075/
- Lum et al. 2021, Loop Observational Study (n=558) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8080906/
- Wong et al. 2022, Loop discontinuation — https://pmc.ncbi.nlm.nih.gov/articles/PMC9057870/
- Suttiratana et al. 2022, Loop focus groups (n=72) — https://pmc.ncbi.nlm.nih.gov/articles/PMC9208860/
- Cleal et al. 2025, OPEN users (n=383) — https://pmc.ncbi.nlm.nih.gov/articles/PMC11747533/
- Crabtree et al. 2022, UK clinician survey (n=317) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8873338/
- Morrison et al. 2022, Canadian clinician survey (n=204), preprint — https://www.medrxiv.org/content/10.1101/2022.06.02.22275169v1
- Raimond et al. 2023, users and clinicians, *Chronic Illness* — https://doi.org/10.1177/17423953221142341
- Burnside et al. 2022, CREATE trial, *NEJM* — https://www.nejm.org/doi/full/10.1056/NEJMoa2203913
- Phillip et al. 2023, AID consensus and report template, *Endocrine Reviews* — https://pmc.ncbi.nlm.nih.gov/articles/PMC9985411/
- Ferstad et al. 2021, Stanford TIDE population review — https://www.medrxiv.org/content/10.1101/2021.05.04.21256647v1
- Kompala et al., clinician CGM review survey (n=182) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10563522
- Diabetes Canada 2023 clinician user's guide — https://pubmed.ncbi.nlm.nih.gov/37532366/
- ADA Standards of Care 2026, Section 7 — https://pmc.ncbi.nlm.nih.gov/articles/PMC12690173/
- BC Diabetes, Looping at BCDiabetes (Nov 2026) — https://www.bcdiabetes.ca/wp-content/uploads/bcdpdfs/Looping-at-BCDiabetes.pdf
- Hejla et al. 2026, BC pediatric cohort (n=198) — https://www.maxapress.com/article/doi/10.48130/pedi-0026-0008
- Elezzabi 2025, pharmacy refusal case — https://pmc.ncbi.nlm.nih.gov/articles/PMC12571788/
- LoopFollow PR #671 (closed endo report) — https://github.com/loopandlearn/LoopFollow/pull/671
- LoopTips, Endocrinologist and Loop — https://loopkit.github.io/looptips/how-to/endo

## Appendix: the 16 topics

| Topic | Severity | Safety | Headline finding |
|---|---|---|---|
| Settings tuning between visits | High | Medium-high | Loop keeps no settings history; peers do most fine-tuning |
| Data sharing at appointments | High | Medium | Clinics have nothing to download; no standard DIY report |
| Disclosure to clinicians | High | Medium-high | "Don't ask, don't tell"; nothing structures the first conversation |
| Clinician knowledge gap | High | Medium | 63% (UK) cite their own limited knowledge; no DIY point-of-care card exists |
| Liability and regulation | High | Medium-high | Guidance now says support; exposure sits in undocumented advice |
| Existing tools | High | Medium | Glooko and Clarity can't read DIY data; Tidepool can, but it depends on the patient's setup |
| Data-interpretation gap at visits | High | Medium-high | Loop adjusts basal at least 83% of the time; a settings printout misleads |
| Peer community | High | Medium | Peers are the default support; clinicians often refer to them |
| Parents and pediatric clinics | High | Medium–high | Remote dosing drives DIY; schools refuse DIY plans |
| Discontinuation and switching | High | Medium-high | Stopping is rare and isn't about glucose; every switch loses the record |
| Prescriptions and supplies | High | Medium–high | The prescription pad is the clinician's real lever |
| Clinic-supported models | High | Medium | BC Diabetes: 3,694 installs; split care runs on letters and links |
| Meals, absorption and exercise | Medium (upper) | High | Overrides and Loop's carb entries never reach the clinic |
| Build, maintenance and hardware | Medium | Medium | Clinicians misread technical gaps; needs a system-health layer |
| DIY vs commercial systems | Medium | Medium | More lows on open-source in two comparisons; few switch |
| Published studies of DIY users | Medium | Low–medium | Strong on glucose and safety, silent on the relationship |

The full topic files (23 fields each, with sources, sample sizes and
uncertainty marks) are in `diy-loop-clinician-research/results/`.
