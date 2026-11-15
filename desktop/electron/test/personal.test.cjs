const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { isPackaged: true, getPath: () => '/tmp' }, ipcMain: { handle() {} }, safeStorage: {} } : o(r, ...a));
const { describe, stemOf, planToggle, moveTree, commitMessage, REFUSE_ON } = require('../personal.cjs');
const { checkStack } = require('../patchcheck.cjs');

test('his patches are named by file, delayed metabolic response first', () => {
  assert.equal(stemOf('08-meal-patterns-and-tools.patch'), 'meal-patterns-and-tools');
  const d = describe('08-meal-patterns-and-tools.patch');
  assert.equal(d.name, 'Delayed metabolic response');
  assert.equal(d.rank, 0);
  assert.equal(d.icon, 'peanut');
  assert.ok(d.dosing);
});

test('an unknown patch is named from its file and treated as dosing', () => {
  const d = describe('12-my-new-thing.patch');
  assert.equal(d.name, 'My new thing');
  assert.equal(d.icon, 'patch');
  assert.ok(d.dosing);
  assert.ok(!d.known);
});

test('no authentication can be turned off, never on', () => {
  assert.equal(describe('04-disable-loop-authentication.patch').canTurnOn, false);
  assert.ok(REFUSE_ON.test('LoopKit/LoopKitUI/Extensions/Environment+Authenticate.swift'));
});

// Three stacked patches over one file: 02 is built on 01; 03 stands alone.
const plain = (path, from, to) => `--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n a\n-${from}\n+${to}\n c\n`;
const TEXT = { '01-a.patch': plain('X.swift', 'b', 'B'), '02-b.patch': plain('X.swift', 'B', 'BB'), '03-c.patch': plain('Y.swift', 'b', 'B') };
const read = async (p) => (p === 'X.swift' || p === 'Y.swift' ? 'a\nb\nc' : null);
const results = (names) => checkStack(names.map((name) => ({ name, text: TEXT[name] })), read);
const files = (on) => Object.keys(TEXT).map((name) => ({ name, on: on.includes(name) }));

test('turning off a patch others are built on is refused, naming them', async () => {
  const r = await planToggle(files(['01-a.patch', '02-b.patch', '03-c.patch']), '01-a.patch', 'off', false, results);
  assert.equal(r.ok, false);
  assert.deepEqual(r.needs, ['02-b.patch']);
});

test('or done together when asked, taking only what breaks', async () => {
  const r = await planToggle(files(['01-a.patch', '02-b.patch', '03-c.patch']), '01-a.patch', 'off', true, results);
  assert.deepEqual(r.moves, [{ name: '01-a.patch', to: 'off' }, { name: '02-b.patch', to: 'off' }]);
});

test('a patch nothing is built on turns off alone', async () => {
  const r = await planToggle(files(['01-a.patch', '02-b.patch', '03-c.patch']), '03-c.patch', 'off', false, results);
  assert.deepEqual(r.moves, [{ name: '03-c.patch', to: 'off' }]);
});

test('turning on a patch built on one that is off names what it needs', async () => {
  const r = await planToggle(files(['03-c.patch']), '02-b.patch', 'on', false, results);
  assert.equal(r.ok, false);
  assert.deepEqual(r.needs, ['01-a.patch']);
  const ok = await planToggle(files(['01-a.patch']), '02-b.patch', 'on', false, results);
  assert.deepEqual(ok.moves, [{ name: '02-b.patch', to: 'on' }]);
});

test('a toggle is one tree: same blob at the new path, the old path removed', () => {
  const tree = moveTree([{ name: '08-x.patch', to: 'off' }, { name: '10-y.patch', to: 'on' }], new Map([['08-x.patch', 'aaa'], ['10-y.patch', 'bbb']]));
  assert.deepEqual(tree, [
    { path: 'patches/off/08-x.patch', mode: '100644', type: 'blob', sha: 'aaa' },
    { path: 'patches/08-x.patch', mode: '100644', type: 'blob', sha: null },
    { path: 'patches/10-y.patch', mode: '100644', type: 'blob', sha: 'bbb' },
    { path: 'patches/off/10-y.patch', mode: '100644', type: 'blob', sha: null },
  ]);
  assert.throws(() => moveTree([{ name: 'z.patch', to: 'on' }], new Map()));
});

test('the commit names what moved and that it was not compiled', () => {
  const m = commitMessage([{ name: '08-meal-patterns-and-tools.patch', to: 'off' }, { name: '10-premeal-blue-and-favorites-replace.patch', to: 'off' }]);
  assert.match(m, /^LoopStack: turn off Delayed metabolic response \(08-meal-patterns-and-tools\.patch\)/);
  assert.match(m, /Off: 10-premeal-blue-and-favorites-replace\.patch \(patches → patches\/off\)/);
  assert.match(m, /Not compiled/);
});
