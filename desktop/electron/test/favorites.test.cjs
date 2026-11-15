const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('module');
const o = M._load;
M._load = (r, ...a) => (r === 'electron' ? { app: { isPackaged: true, getPath: () => '/tmp' }, ipcMain: { handle() {} }, safeStorage: {} } : o(r, ...a));
const { cleanFood, makePatch, unifiedDiff } = require('../favorites.cjs');
const { checkPatch } = require('../patchcheck.cjs');

// The shape of Loop's UserDefaults+Loop.swift around favorites (3.14).
const BASE = `import Foundation
import LoopKit


extension UserDefaults {
    var favoriteFoods: [StoredFavoriteFood] {
        get {
            let decoder = JSONDecoder()
            guard let data = object(forKey: Key.favoriteFoods.rawValue) as? Data else {
                return []
            }
            return (try? decoder.decode([StoredFavoriteFood].self, from: data)) ?? []
        }
        set {
            set(newValue, forKey: "x")
        }
    }
}
`;

test('Loop’s own limits, and the person’s values only', () => {
  assert.throws(() => cleanFood({ name: 'Pizza', foodType: '🍕', grams: 300, absorptionMin: 180 }), /250 g/);
  assert.throws(() => cleanFood({ name: 'Pizza', foodType: '🍕', grams: 60, absorptionMin: 600 }), /8 hours/);
  assert.throws(() => cleanFood({ name: '', foodType: '', grams: 60, absorptionMin: 180 }), /name/);
  const f = cleanFood({ name: ' Pizza ', foodType: '🍕', grams: 60, absorptionMin: 300 });
  assert.equal(f.name, 'Pizza');
  assert.match(f.id, /^[0-9A-F-]{36}$/);
});

test('the patch applies to Loop’s code and only changes the favorites getter and the end of the file', async () => {
  const p = makePatch(BASE, [cleanFood({ name: 'Say "hi" \\ there', foodType: '🌯', grams: 70, absorptionMin: 240 })]);
  assert.equal((await checkPatch(p, async (x) => (x.endsWith('UserDefaults+Loop.swift') ? BASE : null))).status, 'apply');
  const removed = p.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  assert.equal(removed.length, 3);
  assert.match(p, /name: "Say \\"hi\\" \\\\ there"/);
  assert.match(p, /absorptionTime: 14400\)/);
  assert.match(p, /loopstack_favorites\.loopcustomization/);
});

test('refuses a Loop version whose favorites code moved', () => {
  assert.throws(() => makePatch(BASE.replace('guard let data', 'if let data'), []), /changed/);
});

test('unified diff counts lines like git', () => {
  const d = unifiedDiff('f', 'a\nb\nc\n', 'a\nB\nc\n');
  assert.match(d, /@@ -1,3 \+1,3 @@\n a\n-b\n\+B\n c\n/);
});
