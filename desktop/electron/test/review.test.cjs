const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { getPath: () => '/tmp' }, BrowserWindow: {}, dialog: {}, ipcMain: { handle() {} } } : o(r, ...a));
const { pdfName } = require('../review.cjs');

test('the review PDF is named by date, never by patient, and is a safe file name', () => {
  const n = pdfName(new Date('2026-11-14T12:00:00'));
  assert.equal(n, 'LoopStack review, Nov 14.pdf');
  assert.doesNotMatch(n, /[\\/:*?"<>|]/);
});
