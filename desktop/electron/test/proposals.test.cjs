const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { isPackaged: true, getPath: () => '/tmp' }, BrowserWindow: {}, dialog: {}, ipcMain: { handle() {} }, safeStorage: {} } : o(r, ...a));
const { gate, cleanItems, settingsPatches, withRuntime, foodsWith, STATUS, HOOK_AFTER } = require('../proposals.cjs');
const { parsePatch, applyFile, checkStack } = require('../patchcheck.cjs');

const item = (over) => ({ id: 'basal-07', kind: 'setting', target: 'basal', label: 'Basal rate, 7–8am', unit: 'U/h', current: 0.9, reading: 0.85, confidence: 'good', evidence: '214 steps over 19 days', scope: 7, buildAs: 'code', ...over });
const BASE = ['import UIKit', '', 'final class StatusTableViewController {', '    override func viewDidAppear(_ animated: Bool) {', '        onscreen = true', HOOK_AFTER, '    }', '}', ''].join('\n');

test('SAFE-5a is enforced in the main process, whatever the page sends', () => {
  assert.equal(gate(item()), null);
  assert.equal(gate(item({ confidence: 'limited' })), 'Needs Readable confidence');
  assert.equal(gate(item({ reading: 0.7 })), 'Over the 20% step');
  assert.equal(gate(item({ reading: 0.9 })), 'Reads the same as on file');
  for (const target of ['safetyLimit', 'maxBasal', 'maxBolus', 'guardrails']) assert.equal(gate(item({ target })), 'Safety limit: stays in Loop');
  assert.equal(gate(item({ target: 'insulinDuration' })), 'LoopStack doesn’t build that setting.');
});

test('items are cleaned, refused ones are listed and never built', () => {
  const { items, skipped } = cleanItems([item(), item({ id: 'maxb', target: 'maxBolus' }), item({ id: 'BAD ID' }), item({ id: 'basal-30', scope: 30 })]);
  assert.deepEqual(items.map((i) => i.id), ['basal-07']);
  assert.deepEqual(skipped.map((s) => s.id), ['maxb', 'BAD ID', 'basal-30']);
  // Foods are always in the favorites patch, never a branch.
  assert.equal(cleanItems([item({ id: 'food-bowl', kind: 'food', target: 'absorption', current: 180, reading: 210, scope: 'Bowl', buildAs: 'branch' })]).items[0].buildAs, 'code');
});

test('settings arrive as a proposals screen hooked into the status screen, never a silent change', () => {
  const after = withRuntime(BASE, [cleanItems([item()]).items[0]], [], 'b1');
  assert.match(after, /LoopStackProposals\.presentIfPending\(from: self, deviceManager: deviceManager\)/);
  assert.match(after, /LoopStackProposal\(id: "basal-07", label: "Basal rate, 7–8am", kind: \.basal\(hour: 7\), onFile: 0\.9, proposed: 0\.85/);
  assert.match(after, /deviceManager\.saveCompletion\(therapySettings:/);
  assert.match(after, /Guardrail\.carbRatio\.absoluteBounds\.contains/);
  assert.doesNotMatch(after, /maximumBolus =|maximumBasalRatePerHour =|suspendThreshold =/);
  assert.throws(() => withRuntime('no hook here', [], [], 'x'), /status screen/);
});

test('the screen and a branch item stack: each applies on top of the one before', async () => {
  const items = cleanItems([item(), item({ id: 'isf', target: 'isf', label: 'Insulin sensitivity', current: 45, reading: 48, scope: undefined, buildAs: 'branch' })]).items;
  const { patches } = settingsPatches(BASE, items);
  assert.deepEqual(patches.map((p) => p.path), ['patches/loopstack_0_proposals.patch', 'patches/loopstack_proposal_isf.patch']);
  assert.ok(patches[0].patch.startsWith(`diff --git a/${STATUS} b/${STATUS}`));
  const results = await checkStack(patches.map((p) => ({ name: p.path, text: p.patch })), async (p) => (p === STATUS ? BASE : null));
  assert.deepEqual(results.map((r) => r.status), ['apply', 'apply']);
  // The branch patch only fills its own slot.
  const screen = applyFile(parsePatch(patches[0].patch)[0], BASE);
  const full = applyFile(parsePatch(patches[1].patch)[0], screen);
  assert.match(full, /LoopStack branch proposal isf: start\n {8}LoopStackProposal\(id: "isf".*\n {8}\/\/ LoopStack branch proposal isf: end/);
  assert.doesNotMatch(screen, /LoopStackProposal\(id: "isf"/);
});

test('a food reading updates the favorite and gets a fresh id so Loop adds it', () => {
  const existing = [{ id: '11111111-1111-1111-1111-111111111111', name: 'Burrito bowl', foodType: '🌯', grams: 85, absorptionMin: 180, addedAt: '2026-11-01T00:00:00.000Z' }];
  const out = foodsWith(existing, [{ name: 'burrito bowl', reading: 240, grams: 80 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].absorptionMin, 240);
  assert.equal(out[0].grams, 85);
  assert.notEqual(out[0].id, existing[0].id);
  assert.equal(foodsWith([], [{ name: 'Oatmeal', reading: 150, grams: 45 }])[0].absorptionMin, 150);
  assert.throws(() => foodsWith([], [{ name: 'Mystery', reading: 150, grams: NaN }]), /carbs/);
});
