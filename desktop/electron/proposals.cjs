// Your next build (PRODUCT.md SAFE-5a), main process only.
//
// Suggestions you added to your next build in LoopStack become patches on your
// own Loop branch. Everything here is deterministic: the values are the
// readings LoopStack measured, checked against SAFE-5a again here, and the
// Swift is a fixed template. No language model writes any of it.
//
//   next:export   saves a Markdown brief for a Claude build session.
//   next:preview  the patches the staged items would add, checked to apply on
//                 top of every patch already in your patches folder.
//   next:commit   one commit, after the review and the dosing confirmation.
//
// Therapy settings arrive in Loop as proposals, never as silent changes:
//   patches/loopstack_0_proposals.patch   a "From LoopStack" screen shown on
//       the status screen, listing on file → reading with the evidence, with
//       Apply and Dismiss. Apply re-checks the value on file and Loop's own
//       guardrails, then saves the way Loop's settings editors do
//       (DeviceDataManager.saveCompletion, after syncBasalRateSchedule).
//   patches/loopstack_proposal_<id>.patch  an item kept as a branch feature:
//       one proposal added to that screen, switchable in the Feature library.
// Favorite foods go through the favorites patch (favorites.cjs).
// The "0" sorts the screen ahead of the per-item patches; your numbered
// patches sort ahead of both, so the build applies them first.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readConfig, gh } = require('./github.cjs');
const { buildReader } = require('./library.cjs');
const { parsePatch, applyFile, checkStack } = require('./patchcheck.cjs');
const favorites = require('./favorites.cjs');

const STATUS = 'Loop/Loop/View Controllers/StatusTableViewController.swift';
const RUNTIME = 'patches/loopstack_0_proposals.patch';
const branchPath = (id) => `patches/loopstack_proposal_${id}.patch`;
const PROPOSALS_JSON = 'loopstack/proposals.json';
const SAFETY_LIMITS = ['safetyLimit', 'maxBasal', 'maxBolus', 'guardrails'];
const MAX_STEP = 0.2;
const RAW = 'application/vnd.github.raw';
const enc = encodeURIComponent;

// ------------------------------------------------------------ SAFE-5a, again

/** The same rule as desktop/src/data/suggestions.ts eligibleForBuild, enforced here. */
function gate(it) {
  if (SAFETY_LIMITS.includes(it?.target)) return 'Safety limit: stays in Loop';
  if (!['basal', 'isf', 'carbRatio', 'absorption'].includes(it?.target)) return 'LoopStack doesn’t build that setting.';
  if (it.confidence !== 'good') return 'Needs Readable confidence';
  const cur = Number(it.current);
  const val = Number(it.reading);
  if (!Number.isFinite(cur) || !Number.isFinite(val) || cur <= 0 || val <= 0) return 'Nothing to read yet';
  const step = Math.abs(val - cur) / cur;
  if (step > MAX_STEP + 1e-9) return 'Over the 20% step';
  if (step < 0.005) return 'Reads the same as on file';
  return null;
}

/** The staged items, cleaned; anything off-shape or refused is listed, never built. */
function cleanItems(list) {
  const items = [];
  const skipped = [];
  for (const raw of Array.isArray(list) ? list.slice(0, 60) : []) {
    const id = String(raw?.id ?? '');
    if (!/^[a-z0-9-]{1,48}$/.test(id)) { skipped.push({ id, reason: 'Unreadable item.' }); continue; }
    const reason = gate(raw);
    if (reason) { skipped.push({ id, reason }); continue; }
    const kind = raw.kind === 'food' ? 'food' : 'setting';
    if ((kind === 'food') !== (raw.target === 'absorption')) { skipped.push({ id, reason: 'Unreadable item.' }); continue; }
    const hour = raw.target === 'basal' ? Number(raw.scope) : null;
    if (raw.target === 'basal' && !(Number.isInteger(hour) && hour >= 0 && hour <= 23)) { skipped.push({ id, reason: 'Unreadable item.' }); continue; }
    items.push({
      id, kind, target: raw.target,
      label: String(raw.label ?? id).slice(0, 80),
      evidence: String(raw.evidence ?? '').slice(0, 200),
      current: Number(raw.current), reading: Number(raw.reading),
      hour, name: kind === 'food' ? String(raw.scope ?? raw.label ?? '').slice(0, 40) : null,
      grams: Number(raw.grams),
      buildAs: raw.buildAs === 'branch' && kind === 'setting' ? 'branch' : 'code',
    });
  }
  return { items, skipped };
}

// ------------------------------------------------------------ the Swift

const swiftString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, ' ')}"`;
const swiftNum = (n) => String(Math.round(n * 1000) / 1000);
const KIND = { basal: (it) => `.basal(hour: ${it.hour})`, isf: () => '.insulinSensitivity', carbRatio: () => '.carbRatio' };
const entry = (it) => `        LoopStackProposal(id: ${swiftString(it.id)}, label: ${swiftString(it.label)}, kind: ${KIND[it.target](it)}, onFile: ${swiftNum(it.current)}, proposed: ${swiftNum(it.reading)}, evidence: ${swiftString(it.evidence)}),`;
const slotStart = (id) => `        // LoopStack branch proposal ${id}: start`;
const slotEnd = (id) => `        // LoopStack branch proposal ${id}: end`;
const HOOK_AFTER = '        deviceManager.checkDeliveryUncertaintyState()';
const HOOK = '        LoopStackProposals.presentIfPending(from: self, deviceManager: deviceManager) // LoopStack: proposals you added to this build';

function runtimeSwift(codeItems, branchIds, batch) {
  return `
// MARK: - LoopStack proposals
//
// Generated by the LoopStack desktop app (PRODUCT.md SAFE-5a). Each proposal is
// a reading LoopStack measured at its top confidence grade, within 20% of the
// value on file. Nothing changes until you tap Apply. Apply checks the value on
// file and Loop's own guardrails first, then saves the way Loop's settings
// editors do. Dismiss leaves the setting as it is. Each proposal is asked once.

struct LoopStackProposal: Identifiable {
    enum Kind {
        case basal(hour: Int)
        case insulinSensitivity
        case carbRatio
    }
    let id: String
    let label: String
    let kind: Kind
    let onFile: Double
    let proposed: Double
    let evidence: String
}

enum LoopStackProposals {
    static let batch = ${swiftString(batch)}

    static let all: [LoopStackProposal] = [
${[...codeItems.map(entry), ...branchIds.flatMap((id) => [slotStart(id), slotEnd(id)])].join('\n')}
    ]

    private static let decidedKey = "com.loopstack.proposals.decided"
    private static var shownThisLaunch = false

    static var pending: [LoopStackProposal] {
        let decided = Set(UserDefaults.standard.stringArray(forKey: decidedKey) ?? [])
        return all.filter { !decided.contains("\\(batch):\\($0.id)") }
    }

    static func markDecided(_ proposal: LoopStackProposal) {
        var decided = UserDefaults.standard.stringArray(forKey: decidedKey) ?? []
        decided.append("\\(batch):\\(proposal.id)")
        UserDefaults.standard.set(decided, forKey: decidedKey)
    }

    static func presentIfPending(from controller: UIViewController, deviceManager: DeviceDataManager) {
        guard !shownThisLaunch, !pending.isEmpty, controller.presentedViewController == nil else { return }
        shownThisLaunch = true
        let host = UIHostingController(rootView: LoopStackProposalsView(deviceManager: deviceManager))
        controller.present(host, animated: true)
    }

    static func text(_ proposal: LoopStackProposal, _ value: Double) -> String {
        switch proposal.kind {
        case .basal:
            return String(format: "%.2f U/h", value)
        case .insulinSensitivity:
            return "\\(Int(value.rounded())) mg/dL per U"
        case .carbRatio:
            return value.truncatingRemainder(dividingBy: 1) == 0 ? "1:\\(Int(value))" : String(format: "1:%.1f", value)
        }
    }

    /// Checks the proposal against what's on file now and Loop's guardrails, then saves it the way Loop's settings editors do. Calls back with nil when saved, or the reason it wasn't.
    static func apply(_ proposal: LoopStackProposal, deviceManager: DeviceDataManager, completion: @escaping (String?) -> Void) {
        var therapy = deviceManager.loopManager.therapySettings
        switch proposal.kind {
        case .carbRatio:
            guard let schedule = therapy.carbRatioSchedule, schedule.unit == .gramsPerUnit, schedule.items.count == 1, abs(schedule.items[0].value - proposal.onFile) < 0.05 else {
                completion("Your carb ratio on file isn’t \\(text(proposal, proposal.onFile)) for the whole day any more, so this reading no longer fits it.")
                return
            }
            guard Guardrail.carbRatio.absoluteBounds.contains(HKQuantity(unit: .gramsPerUnit, doubleValue: proposal.proposed)),
                  let next = CarbRatioSchedule(unit: .gramsPerUnit, dailyItems: [RepeatingScheduleValue(startTime: 0, value: proposal.proposed)], timeZone: schedule.timeZone) else {
                completion("That value is outside Loop’s limits, so Loop won’t save it.")
                return
            }
            therapy.carbRatioSchedule = next
            deviceManager.saveCompletion(therapySettings: therapy)
            completion(nil)
        case .insulinSensitivity:
            let unit = HKUnit.milligramsPerDeciliter.unitDivided(by: .internationalUnit())
            guard let schedule = therapy.insulinSensitivitySchedule, schedule.unit == unit, schedule.items.count == 1, abs(schedule.items[0].value - proposal.onFile) < 0.5 else {
                completion("Your insulin sensitivity on file isn’t \\(text(proposal, proposal.onFile)) for the whole day any more, so this reading no longer fits it.")
                return
            }
            guard Guardrail.insulinSensitivity.absoluteBounds.contains(HKQuantity(unit: unit, doubleValue: proposal.proposed)),
                  let next = InsulinSensitivitySchedule(unit: unit, dailyItems: [RepeatingScheduleValue(startTime: 0, value: proposal.proposed)], timeZone: schedule.timeZone) else {
                completion("That value is outside Loop’s limits, so Loop won’t save it.")
                return
            }
            therapy.insulinSensitivitySchedule = next
            deviceManager.saveCompletion(therapySettings: therapy)
            completion(nil)
        case .basal(let hour):
            guard let schedule = therapy.basalRateSchedule, let pump = deviceManager.pumpManager else {
                completion("Loop needs your pump connected to change a basal rate.")
                return
            }
            let items = schedule.items.sorted { $0.startTime < $1.startTime }
            let start = TimeInterval(hour * 3600)
            let end = TimeInterval((hour + 1) * 3600)
            func onFile(at time: TimeInterval) -> Double {
                items.last(where: { $0.startTime <= time })?.value ?? items[0].value
            }
            guard !items.isEmpty, !items.contains(where: { $0.startTime > start && $0.startTime < end }), abs(onFile(at: start) - proposal.onFile) < 0.01 else {
                completion("Your basal schedule for that hour changed since LoopStack read it, so this reading no longer fits it.")
                return
            }
            let supported = pump.supportedBasalRates
            guard supported.contains(where: { abs($0 - proposal.proposed) < 0.0001 }),
                  Guardrail.basalRate(supportedBasalRates: supported).absoluteBounds.contains(HKQuantity(unit: .internationalUnitsPerHour, doubleValue: proposal.proposed)) else {
                completion("Your pump can’t run \\(text(proposal, proposal.proposed)), so Loop won’t save it.")
                return
            }
            if let maxBasal = therapy.maximumBasalRatePerHour, proposal.proposed > maxBasal {
                completion("That’s above your maximum basal rate, so Loop won’t save it.")
                return
            }
            var next: [RepeatingScheduleValue<Double>] = items.filter { $0.startTime < start }
            next.append(RepeatingScheduleValue(startTime: start, value: proposal.proposed))
            if end < 86_400 {
                next.append(RepeatingScheduleValue(startTime: end, value: onFile(at: end)))
            }
            next += items.filter { $0.startTime > end }
            var merged: [RepeatingScheduleValue<Double>] = []
            for item in next where merged.last.map({ abs($0.value - item.value) > 0.0001 }) ?? true {
                merged.append(item)
            }
            guard merged.count <= pump.maximumBasalScheduleEntryCount else {
                completion("Your pump can’t hold another basal time block, so Loop won’t save it.")
                return
            }
            deviceManager.syncBasalRateSchedule(items: merged) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let saved):
                        var latest = deviceManager.loopManager.therapySettings
                        latest.basalRateSchedule = saved
                        deviceManager.saveCompletion(therapySettings: latest)
                        completion(nil)
                    case .failure(let error):
                        completion("Your pump didn’t take the new schedule: \\(error.localizedDescription)")
                    }
                }
            }
        }
    }
}

struct LoopStackProposalsView: View {
    let deviceManager: DeviceDataManager
    @Environment(\\.dismiss) private var dismiss
    @State private var proposals = LoopStackProposals.pending
    @State private var message: String?
    @State private var working = false

    var body: some View {
        NavigationView {
            List {
                Section(footer: Text("Readings LoopStack measured from your history, each within 20% of what’s on file. Nothing changes until you tap Apply, and Loop’s own limits still apply. Watch the days after, and tell your care team.")) {
                    ForEach(proposals) { proposal in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(proposal.label).font(.headline)
                            Text("On file \\(LoopStackProposals.text(proposal, proposal.onFile)) · reading \\(LoopStackProposals.text(proposal, proposal.proposed))")
                            Text(proposal.evidence).font(.footnote).foregroundColor(.secondary)
                            HStack(spacing: 12) {
                                Button("Apply") { apply(proposal) }
                                    .buttonStyle(.borderedProminent)
                                Button("Dismiss") { decide(proposal) }
                                    .buttonStyle(.bordered)
                            }
                            .disabled(working)
                        }
                        .padding(.vertical, 4)
                    }
                }
                if let message = message {
                    Section {
                        Text(message).foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("From LoopStack")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(proposals.isEmpty ? "Done" : "Later") { dismiss() }
                }
            }
        }
    }

    private func decide(_ proposal: LoopStackProposal) {
        LoopStackProposals.markDecided(proposal)
        proposals.removeAll { $0.id == proposal.id }
        if proposals.isEmpty, message == nil {
            dismiss()
        }
    }

    private func apply(_ proposal: LoopStackProposal) {
        working = true
        LoopStackProposals.apply(proposal, deviceManager: deviceManager) { error in
            working = false
            if let error = error {
                message = error
            } else {
                message = "\\(proposal.label) saved in Loop."
                LoopStackProposals.markDecided(proposal)
                proposals.removeAll { $0.id == proposal.id }
            }
        }
    }
}
`;
}

/** The status screen file with the proposals screen added. Throws if Loop's code isn't where expected. */
function withRuntime(base, codeItems, branchIds, batch) {
  if (!base.includes(HOOK_AFTER)) throw new Error('Loop’s status screen isn’t where LoopStack expects it in this version.');
  if (base.includes('enum LoopStackProposals')) throw new Error('Your Loop already has a LoopStack proposals screen from another patch.');
  const s = base.replace(HOOK_AFTER, `${HOOK_AFTER}\n${HOOK}`);
  return `${s.replace(/\n*$/, '')}\n${runtimeSwift(codeItems, branchIds, batch)}`;
}

const batchOf = (items) => crypto.createHash('sha1').update(JSON.stringify(items.map((i) => [i.id, i.current, i.reading]))).digest('hex').slice(0, 10);

/** The patches for the settings items: the screen with the in-code items, and one patch per branch item. Pure. */
function settingsPatches(base, items, keepBranchIds = []) {
  const settings = items.filter((i) => i.kind === 'setting');
  const code = settings.filter((i) => i.buildAs === 'code');
  const branch = settings.filter((i) => i.buildAs === 'branch');
  const branchIds = [...new Set([...branch.map((i) => i.id), ...keepBranchIds])].sort();
  const batch = batchOf(settings);
  const after = withRuntime(base, code, branchIds, batch);
  const marker = (p) => `diff --git a/${p} b/${p}\nnew file mode 100644\nindex 0000000..e69de29\n`;
  const out = [{ path: RUNTIME, title: 'LoopStack proposals screen', ids: code.map((i) => i.id), patch: `${favorites.unifiedDiff(STATUS, base, after)}${marker('loopstack_proposals.loopcustomization')}` }];
  for (const it of branch) {
    const withEntry = after.replace(`${slotStart(it.id)}\n${slotEnd(it.id)}`, `${slotStart(it.id)}\n${entry(it)}\n${slotEnd(it.id)}`);
    out.push({ path: branchPath(it.id), title: `${it.label} (proposal)`, ids: [it.id], patch: `${favorites.unifiedDiff(STATUS, after, withEntry, 1)}${marker(`loopstack_proposal_${it.id}.loopcustomization`)}` });
  }
  return { patches: out, batch };
}

// ------------------------------------------------------------ the fork

async function patchNames(cfg) {
  try {
    const { data } = await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/patches?ref=${enc(cfg.branch)}`);
    return Array.isArray(data) ? data.filter((f) => f.type === 'file' && f.name.endsWith('.patch')).map((f) => f.name).sort() : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}
const rawFile = async (cfg, p) => (await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${p.split('/').map(enc).join('/')}?ref=${enc(cfg.branch)}`, undefined, RAW)).data;
const ours = (name) => name === 'loopstack_0_proposals.patch' || name === 'loopstack_favorites.patch' || /^loopstack_proposal_/.test(name);

/** Your Loop as the build sees it after every patch already in your folder (leaving out the ones regenerated here). */
async function stackedReader(cfg) {
  const read = buildReader(cfg);
  const names = await patchNames(cfg);
  const kept = names.filter((n) => !ours(n));
  const texts = await Promise.all(kept.map((n) => rawFile(cfg, `patches/${n}`)));
  const overlay = new Map();
  for (let k = 0; k < kept.length; k += 1) {
    for (const f of parsePatch(texts[k])) {
      if (/\.loopcustomization$/.test(f.path)) continue;
      const r = applyFile(f, overlay.has(f.path) ? overlay.get(f.path) : await read(f.path));
      if (r === undefined) throw new Error(`Your patches don’t stack cleanly at ${kept[k]}, so LoopStack can’t add to them. Check that patch first.`);
      overlay.set(f.path, r);
    }
  }
  return {
    read: async (p) => (overlay.has(p) ? overlay.get(p) : read(p)),
    base: read,
    kept: kept.map((name, k) => ({ name, text: texts[k] })),
    existingBranch: names.filter((n) => /^loopstack_proposal_/.test(n)).map((n) => n.replace(/^loopstack_proposal_|\.patch$/g, '')),
  };
}

async function readFavoritesJson(cfg) {
  try {
    const parsed = JSON.parse(await rawFile(cfg, 'loopstack/favorites.json'));
    return Array.isArray(parsed?.foods) ? parsed.foods.map(favorites.cleanFood) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

/** Favorites with each staged food's absorption set to the reading. A changed favorite gets a new id so Loop adds it fresh. */
function foodsWith(existing, foods) {
  const out = [...existing];
  for (const f of foods) {
    const k = out.findIndex((x) => x.name.toLowerCase() === f.name.toLowerCase());
    const grams = k >= 0 ? out[k].grams : (Number.isFinite(f.grams) && f.grams > 0 ? f.grams : null);
    if (grams == null) throw new Error(`LoopStack doesn’t know the carbs for ${f.name}. Add it as a favorite first.`);
    const next = favorites.cleanFood({ name: f.name, foodType: k >= 0 ? out[k].foodType : '', grams, absorptionMin: Math.round(f.reading / 30) * 30 });
    if (k >= 0) out[k] = next; else out.push(next);
  }
  return out;
}

/** Everything the staged items would add, checked to apply on top of your patches, in the build's order. */
async function plan(cfg, items) {
  const st = await stackedReader(cfg);
  const settings = items.filter((i) => i.kind === 'setting');
  const foods = items.filter((i) => i.kind === 'food');
  const out = [];
  if (settings.length) {
    const base = await st.read(STATUS);
    if (base == null) throw new Error('Can’t find Loop’s status screen in your Loop version.');
    out.push(...settingsPatches(base, items, st.existingBranch.filter((id) => !settings.some((i) => i.id === id))).patches);
  }
  let foodList = null;
  if (foods.length) {
    foodList = foodsWith(await readFavoritesJson(cfg), foods);
    const base = await st.read(favorites.TARGET);
    if (base == null) throw new Error('Can’t find Loop’s favorites code in your Loop version.');
    out.push({ path: 'patches/loopstack_favorites.patch', title: 'LoopStack favorites', ids: foods.map((f) => f.id), patch: favorites.makePatch(base, foodList) });
  }
  // The whole folder as the build will apply it: your patches, then these, in file-name order.
  const ordered = [...st.kept.map((k) => ({ name: k.name, text: k.text })), ...out.map((p) => ({ name: path.basename(p.path), text: p.patch }))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const results = await checkStack(ordered, st.base);
  const bad = results.find((r) => r.status !== 'apply');
  if (bad) throw new Error(`The build wouldn’t apply: ${bad.name} no longer fits${bad.failedAt ? ` (${bad.failedAt})` : ''}.`);
  return { patches: out, foodList };
}

const summaryOf = (patch) => parsePatch(patch).filter((f) => !/\.loopcustomization$/.test(f.path)).map((f) => ({ path: f.path, isNew: f.isNew, added: f.hunks.reduce((t, h) => t + h.added, 0), removed: f.hunks.reduce((t, h) => t + h.removed, 0) }));

function register() {
  ipcMain.handle('next:export', async (e, input) => {
    const markdown = String(input?.markdown ?? '');
    if (!markdown.trim() || markdown.length > 200_000) return { ok: false, error: 'Nothing to export.' };
    const win = BrowserWindow.fromWebContents(e.sender);
    try {
      const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const r = await dialog.showSaveDialog(win, { title: 'Export your next build for Claude', defaultPath: path.join(app.getPath('documents'), `LoopStack next build, ${d}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (r.canceled || !r.filePath) return { ok: true, canceled: true };
      fs.writeFileSync(r.filePath, markdown);
      return { ok: true, path: r.filePath };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('next:preview', async (_e, input) => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Connect your Loop in Settings first.' };
    const { items, skipped } = cleanItems(input?.items);
    if (!items.length) return { ok: false, error: skipped.length ? `Nothing can be built: ${skipped.map((s) => `${s.id}: ${s.reason}`).join('; ')}` : 'Add something to your next build first.' };
    try {
      const { patches } = await plan(cfg, items);
      return { ok: true, patches: patches.map((p) => ({ path: p.path, title: p.title, patch: p.patch, dosing: true, files: summaryOf(p.patch) })), skipped };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('next:commit', async (_e, input) => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    if (input?.reviewed !== true) return { ok: false, error: 'Review the changes first.' };
    if (input?.confirmDosing !== true) return { ok: false, error: 'These change what Loop doses. Confirm that separately before they’re added.' };
    const { items, skipped } = cleanItems(input?.items);
    if (skipped.length) return { ok: false, error: `Not built: ${skipped.map((s) => `${s.id}: ${s.reason}`).join('; ')}` };
    if (!items.length) return { ok: false, error: 'Add something to your next build first.' };
    try {
      // Rebuilt from your branch now, not from what the page showed.
      const { patches, foodList } = await plan(cfg, items);
      const files = patches.map((p) => ({ path: p.path, content: p.patch }));
      files.push({ path: PROPOSALS_JSON, content: `${JSON.stringify({ _note: 'Proposals added in LoopStack (SAFE-5a). LoopStack generates the loopstack_*proposal* patches from this list.', addedAt: new Date().toISOString(), items }, null, 2)}\n` });
      if (foodList) files.push({ path: 'loopstack/favorites.json', content: `${JSON.stringify({ _note: 'Favorites added in LoopStack. LoopStack generates patches/loopstack_favorites.patch from this list; edit them in LoopStack.', foods: foodList }, null, 2)}\n` });
      const commit = await favorites.commitFiles(cfg, files, [
        `LoopStack: add ${items.length} reading${items.length === 1 ? '' : 's'} to the next build`,
        '',
        ...items.map((i) => `- ${i.label}: ${i.current} → ${i.reading} (${i.evidence})${i.kind === 'setting' ? `, ${i.buildAs === 'branch' ? 'own patch' : 'in the proposals screen'}` : ', favorites patch'}`),
        '',
        'Measured by LoopStack at its top confidence grade, each within 20% of the value on file (SAFE-5a). Settings arrive in Loop as proposals: nothing changes until Apply in Loop, under Loop’s guardrails.',
        'Changes dosing: yes, confirmed separately in LoopStack.',
        `Files: ${files.map((f) => f.path).join(', ')}`,
      ].join('\n'));
      return { ok: true, commit };
    } catch (err) {
      if (err.status === 404) return { ok: false, error: 'GitHub refused the commit. The token needs Contents: read and write on this repository.' };
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { register, gate, cleanItems, settingsPatches, withRuntime, foodsWith, STATUS, RUNTIME, HOOK_AFTER };
