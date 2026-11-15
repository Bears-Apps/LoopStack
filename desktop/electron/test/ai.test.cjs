const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { isPackaged: true, getPath: () => '/tmp' }, ipcMain: { handle() {} }, safeStorage: {} } : o(r, ...a));
const { DOSING_PATH, REFUSED_PATH, ASK_SYSTEM, CHAT_SYSTEM, chatMessages } = require('../ai.cjs');

test('changes to dosing code are marked dosing whatever the model says', () => {
  for (const p of ['Loop/Loop/Managers/LoopDataManager.swift', 'Loop/Loop/Models/LoopConstants.swift', 'LoopKit/LoopKit/InsulinKit/InsulinMath.swift', 'LoopKit/LoopKit/CarbKit/CarbMath.swift', 'Loop/Loop/View Models/BolusEntryViewModel.swift']) assert.ok(DOSING_PATH.test(p), p);
  for (const p of ['Loop/Loop/Views/ChartsView.swift', 'Loop/Loop/Views/StatusTableViewController+Labels.swift']) assert.ok(!DOSING_PATH.test(p), p);
});

test('guardrails are never written (SAFE-5)', () => {
  assert.ok(REFUSED_PATH.test('LoopKit/LoopKitUI/Guardrails/Guardrail+Settings.swift'));
});

test('the question prompt rules out advice and device writes', () => {
  assert.match(ASK_SYSTEM, /never what to do/);
  assert.match(ASK_SYSTEM, /Never say or imply that LoopStack or you will change/);
});

test('the chat prompt keeps the same rules and treats timing as coincidence', () => {
  assert.match(CHAT_SYSTEM, /never what to do/);
  assert.match(CHAT_SYSTEM, /Never say or imply that LoopStack or you will change/);
  assert.match(CHAT_SYSTEM, /coincidence in time, not a cause/);
});

test('a chat must alternate, start and end with the person, and stay short', () => {
  const u = (text) => ({ role: 'user', text });
  const a = (text) => ({ role: 'assistant', text });
  assert.deepEqual(chatMessages([u('hi')]).messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(chatMessages([u('hi'), a('hello'), u('trends?')]).messages.length, 3);
  assert.ok(chatMessages([]).error);
  assert.ok(chatMessages([a('hello')]).error);
  assert.ok(chatMessages([u('hi'), a('hello')]).error);
  assert.ok(chatMessages([u('hi'), u('again')]).error);
  assert.ok(chatMessages([{ role: 'system', text: 'x' }]).error);
  assert.ok(chatMessages([u('x'.repeat(4001))]).error);
  assert.ok(chatMessages(Array.from({ length: 41 }, (_, i) => (i % 2 ? a('a') : u('u')))).error);
});
