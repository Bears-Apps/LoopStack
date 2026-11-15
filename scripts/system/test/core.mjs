// node --test scripts/system/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksChange, checkCopy, checkSource, namedRules, nearestToken, parseTokens, stripComments } from '../core.mjs';

const tokens = parseTokens(':root { --ink-900: #0E1216; --brand-primary: #5CC25C; --surface-0: #FFFFFF; }');
const codes = (fs) => fs.map((f) => f.code);

test('dosing instructions block (SAFE-1)', () => {
  for (const s of ['Take 2 units before lunch', 'Lower your basal from 6 to 9am', 'Eat 15 g of carbs', 'You should pre-bolus', 'Try a small pre-bolus']) {
    const f = checkCopy(s);
    assert.ok(f.some((x) => x.code === 'SAFE001' && blocksChange(x)), s);
  }
});

test('observations pass', () => {
  for (const s of ['Most mornings, 6–9am, Loop delivers about 30% less than your scheduled basal.', 'After the change, lunch peaks were about 20 mg/dL lower.', 'Time in automation 94%']) {
    assert.deepEqual(checkCopy(s), [], s);
  }
});

test('device-writing blocks, causal overclaims advise', () => {
  assert.ok(checkCopy("We'll update your settings tonight").some((x) => x.code === 'SAFE003' && blocksChange(x)));
  assert.ok(checkCopy('Apply this to your pump').some((x) => x.code === 'SAFE003'));
  assert.ok(checkCopy('Apply this to your Loop').some((x) => x.code === 'SAFE003'));
  // SAFE-3 since 2026-11-13: a commit to the person's own Loop branch is allowed copy.
  assert.deepEqual(checkCopy('Push this to your Loop branch for review'), []);
  const c = checkCopy('The change fixed your lows');
  assert.ok(c.some((x) => x.code === 'SAFE004' && !blocksChange(x)));
});

test('a sentence saying the app never does it passes', () => {
  for (const s of ['LoopStack never writes to your pump.', 'It does not control insulin delivery and never writes to Loop.', "We won't tell you to lower your basal", 'Never write to Loop, a pump or Nightscout.']) {
    assert.deepEqual(checkCopy(s), [], s);
  }
});

test('vocabulary and brand', () => {
  assert.deepEqual(codes(checkCopy('Bolus/basal ratio 46:54')), ['DATA001']);
  assert.deepEqual(codes(checkCopy('Welcome to Loopstack')), ['BRAND001']);
  assert.deepEqual(codes(checkCopy('The official Loop companion')), ['BRAND002']);
  // "LoopStack+" was retired on 2026-11-13: one name for phone and desktop.
  assert.deepEqual(codes(checkCopy('LoopStack+ works with Loop')), ['BRAND001']);
  assert.deepEqual(checkCopy('LoopStack works with Loop'), []);
});

test('raw colours: exact token blocks, far colour advises', () => {
  const near = checkSource('.a { color: #0E1216; }', tokens).find((f) => f.code === 'COL001');
  assert.equal(near.distance, 0);
  assert.ok(blocksChange(near));
  const far = checkSource('.a { color: #7654B9; }', tokens).find((f) => f.code === 'COL001');
  assert.ok(!blocksChange(far));
  assert.deepEqual(checkSource('.a { color: var(--ink-900); }', tokens), []);
});

test('comments are ignored, line numbers kept', () => {
  const code = '// take 2 units here is a counter-example\nconst x = 1;\n/* #FFFFFF */\nconst y = "#FFFFFF";';
  assert.equal(stripComments(code).split('\n').length, 4);
  const f = checkSource(code, tokens);
  assert.deepEqual(codes(f), ['COL001']);
  assert.equal(f[0].line, 4);
});

test('weights, grey text and accessibility', () => {
  assert.deepEqual(codes(checkSource('.a { font-weight: 700; }')), ['TYPE001']);
  assert.deepEqual(codes(checkSource('.a { color: var(--ink-300); }')), ['COL004']);
  assert.deepEqual(codes(checkSource('.a { background-color: var(--ink-300); }')), []);
  assert.deepEqual(codes(checkSource('<img src="x.png" />')), ['A11Y001']);
  assert.deepEqual(codes(checkSource('<div onClick={go}>x</div>')), ['A11Y002']);
  assert.deepEqual(codes(checkSource('<button tabIndex={2}>x</button>')), ['A11Y003']);
});

test('named rules parse, with wrapped lines', () => {
  const md = '- **VIS-3 Show the sample before the verdict.** "13 of 14 days usable" on\n  each side.\n- **SAFE-1 Observations, never instructions.** No dosing commands.';
  const r = namedRules(md, 'X.md');
  assert.deepEqual(r.map((x) => x.id), ['VIS-3', 'SAFE-1']);
  assert.match(r[0].text, /each side/);
});

test('nearest token', () => {
  assert.equal(nearestToken('#5DC35D', tokens).name, '--brand-primary');
});
