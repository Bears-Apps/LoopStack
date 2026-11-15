// node --test electron/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPatch, parsePatch } = require('../patchcheck.cjs');

// Loop and Learn's future_carbs_4h.patch, as published.
const PATCH = `Submodule Loop contains modified content
diff --git a/Loop/Loop/Models/LoopConstants.swift b/Loop/Loop/Models/LoopConstants.swift
index a62fc138..795c5a6e 100644
--- a/Loop/Loop/Models/LoopConstants.swift
+++ b/Loop/Loop/Models/LoopConstants.swift
@@ -25,7 +25,7 @@ enum LoopConstants {
     static let maxCarbAbsorptionTime = TimeInterval(hours: 8)
     
     static let maxCarbEntryPastTime = TimeInterval(hours: (-12))
-    static let maxCarbEntryFutureTime = TimeInterval(hours: 1)
+    static let maxCarbEntryFutureTime = TimeInterval(hours: 4)
 
     static let maxOverrideDurationTime = TimeInterval(hours: 24)
     
diff --git a/future_carbs_4h.loopcustomization b/future_carbs_4h.loopcustomization
new file mode 100644
index 0000000..e69de29
`;
const before = ['enum LoopConstants {', '    static let maxCarbAbsorptionTime = TimeInterval(hours: 8)', '    ', '    static let maxCarbEntryPastTime = TimeInterval(hours: (-12))', '    static let maxCarbEntryFutureTime = TimeInterval(hours: 1)', '', '    static let maxOverrideDurationTime = TimeInterval(hours: 24)', '    ', '}'].join('\n');
const after = before.replace('(hours: 1)', '(hours: 4)');
const reader = (content) => async (p) => (p === 'Loop/Loop/Models/LoopConstants.swift' ? content : null);

test('parses files, hunks and the marker', () => {
  const f = parsePatch(PATCH);
  assert.deepEqual(f.map((x) => [x.path, x.isNew, x.hunks.length]), [['Loop/Loop/Models/LoopConstants.swift', false, 1], ['future_carbs_4h.loopcustomization', true, 0]]);
  assert.equal(f[0].hunks[0].added, 1);
});

test('applies to the matching code, even moved down the file', async () => {
  assert.equal((await checkPatch(PATCH, reader(before))).status, 'apply');
  assert.equal((await checkPatch(PATCH, reader(`// header\n\n${before}`))).status, 'apply');
});

test('recognises a patch already in the code', async () => {
  assert.equal((await checkPatch(PATCH, reader(after))).status, 'applied');
});

test('refuses code it no longer matches, or a missing file', async () => {
  assert.equal((await checkPatch(PATCH, reader(before.replace('hours: 8', 'hours: 10')))).status, 'conflict');
  assert.equal((await checkPatch(PATCH, reader(null))).status, 'conflict');
});

test('summarises what a patch touches, without the marker', async () => {
  const r = await checkPatch(PATCH, reader(before));
  assert.deepEqual(r.summary, [{ path: 'Loop/Loop/Models/LoopConstants.swift', isNew: false, added: 1, removed: 1 }]);
});

test('an empty line inside a hunk is an unchanged blank line, as git reads it', async () => {
  const p = ['diff --git a/A/f.swift b/A/f.swift', '--- a/A/f.swift', '+++ b/A/f.swift', '@@ -1,4 +1,4 @@', ' let a = 1', '', '-let b = 2', '+let b = 3', ' let c = 4', ''].join('\n');
  const r = async () => 'let a = 1\n\nlet b = 2\nlet c = 4\n';
  assert.equal((await checkPatch(p, r)).status, 'apply');
  const wrong = async () => 'let a = 1\nlet b = 2\nlet c = 4\n';
  assert.equal((await checkPatch(p, wrong)).status, 'conflict');
});

const { checkStack, applyFile } = require('../patchcheck.cjs');
const plain = (path, from, to) => `--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n a\n-${from}\n+${to}\n c\n`;

test('a plain unified diff (no diff --git line) is read', () => {
  const f = parsePatch(plain('X.swift', 'b', 'B'));
  assert.equal(f.length, 1);
  assert.equal(f[0].path, 'X.swift');
  assert.equal(applyFile(f[0], 'a\nb\nc'), 'a\nB\nc');
});

test('patches stack: a later one applies on top of an earlier one, and fails without it', async () => {
  const read = async (p) => (p === 'X.swift' ? 'a\nb\nc' : null);
  const one = { name: '01.patch', text: plain('X.swift', 'b', 'B') };
  const two = { name: '02.patch', text: plain('X.swift', 'B', 'BB') };
  assert.deepEqual((await checkStack([one, two], read)).map((r) => r.status), ['apply', 'apply']);
  const r = await checkStack([two], read);
  assert.equal(r[0].status, 'conflict');
  assert.equal(r[0].failedAt, 'X.swift');
  const three = { name: '03.patch', text: plain('Y.swift', 'b', 'B') };
  assert.deepEqual((await checkStack([two, three], read)).map((x) => x.status), ['conflict', 'skipped']);
});
