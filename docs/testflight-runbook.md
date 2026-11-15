# TestFlight Runbook

Everything up to the archive is scripted; the upload itself requires your
Apple ID (2FA) and must be done by you in Xcode. Total hands-on time is
~10 minutes the first run, ~3 minutes on repeats.

## One-time setup (App Store Connect)

1. You need the **paid Apple Developer Program** membership active on team
   `L48NRSTM9T` (already set as the project's development team).
2. In [App Store Connect](https://appstoreconnect.apple.com) → **Apps → ＋ →
   New App**:
   - Platform **iOS**, name **LoopStack**, language **English (U.S.)**
   - Bundle ID **com.ryandeboer.loopstack** (register it under
     Certificates → Identifiers first if it's not in the dropdown, with the
     **HealthKit** capability checked)
   - SKU: `loopstack` (internal only)
3. Under the app's **TestFlight** tab, add yourself as an **internal tester**
   (App Store Connect Users & Access → your account must have a role; internal
   testing needs no Beta App Review).

## Every release

```bash
cd "~/Ryan's Folder/Claude/Loopstack"
npm test && npm run build          # 206 tests + production web build
npx cap sync ios                   # copies dist/ into ios/App/App/public + SPM sync
open ios/App/App.xcodeproj
```

Then in Xcode:

1. Select the **App** scheme and destination **Any iOS Device (arm64)**.
2. Bump the build number: target **App → General → Identity →
   Build** (increment every upload; Version can stay `0.1.0`).
3. **Product → Archive.**
4. In the Organizer window that opens: **Distribute App → TestFlight &
   App Store → Upload** (defaults are fine — Xcode manages signing with your
   team). Sign in with your Apple ID when prompted.
5. Wait ~5–15 min for processing; the build appears in App Store Connect →
   TestFlight. Internal testers get it immediately — install via the
   **TestFlight app** on your iPhone.

## First launch on device

- iOS will show the HealthKit permission sheet (glucose, insulin, carbs,
  workouts, heart rate, steps, exercise time, sleep — usage strings are
  already in Info.plist). Grant **all read permissions** — Loop writes its
  data to Apple Health, which is where LoopStack reads it.
- In the app: **Profile → Sources → Apple Health**. The dashboard computes
  from your real history; anything without enough data shows an honest
  empty state rather than sample numbers.

## Known caveats

- **Export compliance:** first upload asks about encryption — LoopStack uses
  only standard HTTPS/OS crypto, so answer "standard encryption, exempt"
  (or add `ITSAppUsesNonExemptEncryption = NO` to Info.plist to skip the
  prompt permanently).
- **90-day reads:** the first refresh pulls ~26k CGM samples over the plugin
  bridge; expect a few seconds of "Computing metrics…" on first open.
- **Deltas near the fetch edge:** ranges whose comparison window predates the
  90-day fetch show neutral (0) deltas by design, not a bug.
- The **web preview** (`npm run dev`) always uses mock/sample data — Apple
  Health only exists on device.

## Xcode 26 migration notes (learned 2026-07-22, build 3)

The move from Xcode 16 → 26 hit five sequential gates. All are one-time; future
releases need only the "Every release" section above.

1. **SDK mandate:** App Store Connect rejects anything built with an SDK older
   than iOS 26 — requires Xcode 26+ (which requires macOS 15.6+/Tahoe).
2. **License + system packages:** after installing Xcode, run
   `sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch`
   (both with sudo — without it the system packages silently skip).
3. **iOS platform bundle:** Xcode 26 ships without it. `xcodebuild
   -downloadPlatform iOS` (~8.5GB). Verify with `xcrun simctl list runtimes` —
   the runtime must appear THERE (mounted), not just in
   `simctl runtime list` (disk image present). actool needs a mounted runtime
   even for device archives (new icon pipeline).
4. **Runtime/SDK build mismatch:** Apple's CDN can serve a runtime build older
   than the SDK expects (23F77 vs 23F81a). Pin it:
   `xcrun simctl runtime match set iphoneos26.5 23F77` (override still active).
5. **Keychain after reboot:** headless codesign fails with
   `errSecInternalComponent` until
   `security unlock-keychain ~/Library/Keychains/login.keychain-db` is run
   interactively once.

Export options now live in the repo: `ios/App/exportOptions.plist`.

## Headless release (verified on build 5, 2026-07-23)

The Xcode steps above are no longer required. Bump
`CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`, then:

```bash
cd "~/Ryan's Folder/Claude/Loopstack"
npm test && npm run build && npx cap sync ios

cd ios/App
xcodebuild archive -project App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/LoopStack.xcarchive -allowProvisioningUpdates

xcodebuild -exportArchive -archivePath /tmp/LoopStack.xcarchive \
  -exportOptionsPlist exportOptions.plist -allowProvisioningUpdates
```

Authenticates via Xcode's keychain session — no interactive sign-in.

**The archive can take 10-15 min on a cold Swift toolchain.** Build 7's archive ran ~12 min (vs ~2 min warm) with no error — `xcodebuild archive` buffers behind `| tail`, so the output file stays empty until it exits. Wait for the process, don't assume a hang.

**`errSecInternalComponent` on framework codesign is usually transient.** Seen
on build 6: the archive failed signing `Cordova.framework` and
`Capacitor.framework` while `security show-keychain-info` reported the keychain
unlocked with `no-timeout`, and an immediate retry of the identical command
succeeded. Retry once before investigating. If it repeats, run
`security unlock-keychain ~/Library/Keychains/login.keychain-db` interactively.
