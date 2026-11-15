# Loop branch, AI connectors and the feature library: plan

Decided 2026-11-13: LoopStack may change the person's Loop, but only through
their own fork and build (PRODUCT.md SAFE-3, SAFE-5, SAFE-6). Facts below are
from LoopWorkspace, LoopDocs and Loop and Learn, read 2026-11-13.

## How a Loop build takes a change (the facts this rests on)

- The person's fork of `LoopKit/LoopWorkspace` builds with the "4. Build Loop"
  workflow (`build_loop.yml`). It runs on `workflow_dispatch`, so the GitHub
  API can start it; it also syncs and builds on Sundays. A build takes 20–30
  minutes and lands in TestFlight. TestFlight builds expire after 90 days.
- During the build, the "Customize Loop" step runs `git apply ./patches/*`.
  A patch file committed to `patches/` is applied to that build. This needs
  only Contents: write on the repo, not the `workflow` scope, and does not
  touch `build_loop.yml` (so the weekly upstream sync stays clean).
- Loop and Learn's prepared customizations (`loopandlearn/customization`)
  come in per-version variants; their script picks the one that applies.
  Each also drops a `<name>.loopcustomization` marker that Loop shows in its
  Build Details, so LoopStack can tell what is applied.
- Favorite Foods live only in on-device `UserDefaults`
  (`com.loopkit.Loop.favoriteFoods`). They are never uploaded, and Nightscout
  remote commands can't add them (only overrides, carbs and bolus). The only
  route is a code patch that bundles a favorites file into the build.
- The signing secrets (GH_PAT, MATCH_PASSWORD, FASTLANE_*) stay in GitHub.
  LoopStack never needs them.

## Status (2026-11-13)

All four steps are built in the desktop app and tested against a fake GitHub
and a fake Anthropic API; none has run against a real fork or a real key yet.
The AI connector also follows SAFE-7 (PRODUCT.md): nothing is sent until the
person asks, and what's sent is shown first.

## What gets built, in order

### 1. Connect your Loop (Settings)
- A fine-grained GitHub token the person makes, limited to their
  `LoopWorkspace` repo, with Contents read/write and Actions read/write.
  Kept in the keychain like the Nightscout token. No `workflow` scope.
- LoopStack reads the branch, the Loop version, what's in `patches/`, and
  the last build run. It shows: version, applied customizations, last build,
  and days until the TestFlight build expires, with a "Build now" button
  (workflow_dispatch) and a warning when GitHub has paused the schedule.

### 2. Feature library (new sidebar tab)
- Loop and Learn's customizations, each as a card: what it does, author and
  source repo, last update, the files it touches, and a **Changes dosing**
  label where it does (future carbs, carb limits, override sensitivity,
  profiles, basal lock, negative insulin, remote carb edit, lollipop
  absorption). `no_auth` is not offered: it removes a safety feature.
- Adding one: LoopStack picks the variant that applies to the person's Loop
  version, shows the full diff, and on approval commits it to `patches/` on
  the person's branch. Dosing changes need a second, separate confirmation.
  Then "Build now" or wait for Sunday's build.
- Removing one deletes its patch file, the same way.

### 3. Meal favorites into Loop
- From the meal response tile: "Add to Loop favorites" on a meal (name,
  emoji, grams, absorption time, all chosen by the person in the dialog).
- Saved to `loopstack/favorites.json` in the fork, plus one LoopStack patch
  that seeds them into Loop's favorites at launch (merged by id, never
  overwriting one the person edited on the phone). That patch is new and
  unreviewed by the community; it prefills the carb screen, so it carries
  the **Changes dosing** label and second confirmation. The person still
  confirms every carb entry on the phone.

### 4. AI connectors (Settings) and custom features
- The person's own API keys (Anthropic first; OpenAI optional), in the
  keychain, sent only to that provider.
- Advanced analysis: questions about the person's own data, with the
  numbers the dashboard already computes as context. Answers follow SAFE-1
  and SAFE-5: observations, no therapy values.
- Custom features: the person describes a change; the model writes a patch
  against their Loop version. It goes through the same diff, dosing check
  and confirmations as a community feature. Any edit to dosing code
  (LoopKit algorithm, dose maths, `LoopConstants`, guardrails) is marked,
  and a patch that changes therapy values is refused (SAFE-5).

## Safety rails across all four
- Every write is a commit on the person's branch, shown as a diff first.
  Nothing goes to the phone, pump or Nightscout.
- Dosing-path detection by file and symbol, with a second confirmation.
- `git apply --check` against the person's version before committing.
- A log of every commit LoopStack made, with one-click revert.
- Copy follows SAFE-3: "commit to your Loop branch", never "apply to Loop".

## Not decided yet
- A GitHub App instead of a personal token (smoother sign-in, but someone
  has to register and run the app).
- Community features beyond Loop and Learn's list (a submission and review
  process for a "shop").
