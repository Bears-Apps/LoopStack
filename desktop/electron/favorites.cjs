// Meal favorites into Loop (step 3 of docs/desktop/loop-branch-plan.md).
//
// Loop keeps Favorite Foods only on the phone (UserDefaults
// "com.loopkit.Loop.favoriteFoods"); nothing remote can add one. So LoopStack
// writes the person's chosen favorites into their own Loop build:
//   loopstack/favorites.json         the list, LoopStack's source of truth
//   patches/loopstack_favorites.patch  generated from it, applied at build time
// The patch changes one file, Loop/Loop/Extensions/UserDefaults+Loop.swift:
// the favorites are listed in code and merged in when Loop reads its
// favorites, each one once. One the person edits or deletes on the phone stays
// that way. Nothing is entered for them: they still pick a favorite and
// confirm every carb entry on the phone.
//
// It prefills grams and absorption time on the carb screen, so it counts as a
// dosing change (PRODUCT.md SAFE-3): reviewed diff, then a second confirmation,
// both enforced here. The values are the person's own, or (SAFE-5a, since
// 2026-11-15) an absorption-time reading the person added to their next build
// from Suggestions, which proposals.cjs re-checks before it calls in here.
const { ipcMain } = require('electron');
const crypto = require('node:crypto');
const { readConfig, gh } = require('./github.cjs');
const { buildReader } = require('./library.cjs');
const { checkPatch } = require('./patchcheck.cjs');

const TARGET = 'Loop/Loop/Extensions/UserDefaults+Loop.swift';
const JSON_PATH = 'loopstack/favorites.json';
const PATCH_PATH = 'patches/loopstack_favorites.patch';
const MARKER = 'loopstack_favorites.loopcustomization';
// Loop's own limits (LoopConstants): 250 g per entry, absorption 30 min to 8 h.
const LIMITS = { grams: [1, 250], absorptionMin: [30, 480] };

// ------------------------------------------------------------ validation

function cleanFood(f) {
  const name = String(f?.name ?? '').trim();
  const foodType = String(f?.foodType ?? '').trim();
  const grams = Number(f?.grams);
  const absorptionMin = Number(f?.absorptionMin);
  if (!name || name.length > 40) throw new Error('Give the favorite a name, up to 40 characters.');
  if ([...foodType].length > 8) throw new Error('Keep the food type short: an emoji or a few letters.');
  if (!Number.isFinite(grams) || grams < LIMITS.grams[0] || grams > LIMITS.grams[1]) throw new Error('Carbs must be between 1 and 250 g, Loop’s own limit.');
  if (!Number.isInteger(absorptionMin) || absorptionMin < LIMITS.absorptionMin[0] || absorptionMin > LIMITS.absorptionMin[1]) throw new Error('Absorption time must be between 30 minutes and 8 hours, Loop’s own limits.');
  const id = typeof f?.id === 'string' && /^[0-9A-F-]{36}$/i.test(f.id) ? f.id.toUpperCase() : crypto.randomUUID().toUpperCase();
  return { id, name, foodType, grams: Math.round(grams * 10) / 10, absorptionMin, addedAt: typeof f?.addedAt === 'string' ? f.addedAt : new Date().toISOString() };
}

// ------------------------------------------------------------ the Swift change

const swiftString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
const num = (n) => (Number.isInteger(n) ? `${n}` : `${n}`);

function seedSource(base, foods) {
  if (!/^import LoopKit$/m.test(base) || !/var favoriteFoods: \[StoredFavoriteFood\] \{/.test(base)) {
    throw new Error('Loop’s favorites code isn’t where LoopStack expects it in this version.');
  }
  let s = base.replace(/^import LoopKit$/m, 'import LoopKit\nimport HealthKit');
  const oldGet = `        get {
            let decoder = JSONDecoder()
            guard let data = object(forKey: Key.favoriteFoods.rawValue) as? Data else {
                return []
            }
            return (try? decoder.decode([StoredFavoriteFood].self, from: data)) ?? []
        }`;
  if (!s.includes(oldGet)) throw new Error('Loop’s favorites code has changed in this version, so LoopStack can’t add to it yet.');
  s = s.replace(oldGet, `        get {
            let decoder = JSONDecoder()
            var stored: [StoredFavoriteFood] = []
            if let data = object(forKey: Key.favoriteFoods.rawValue) as? Data {
                stored = (try? decoder.decode([StoredFavoriteFood].self, from: data)) ?? []
            }
            return mergingLoopStackFavorites(into: stored)
        }`);
  const list = foods.map((f) => `        StoredFavoriteFood(id: ${swiftString(f.id)}, name: ${swiftString(f.name)}, carbsQuantity: HKQuantity(unit: .gram(), doubleValue: ${num(f.grams)}), foodType: ${swiftString(f.foodType)}, absorptionTime: ${f.absorptionMin * 60})`).join(',\n');
  const tail = `
    // LoopStack: favorites added from the LoopStack desktop app, listed in
    // loopstack/favorites.json in this fork. Each is added once. One edited or
    // deleted on this phone stays that way.
    private static let loopStackSeededFavoriteIDs = "com.loopstack.seededFavoriteFoodIDs"

    private func mergingLoopStackFavorites(into stored: [StoredFavoriteFood]) -> [StoredFavoriteFood] {
        let before = Set(stringArray(forKey: UserDefaults.loopStackSeededFavoriteIDs) ?? [])
        let fresh = LoopStackFavorites.foods.filter { !before.contains($0.id) && !stored.contains($0) }
        let seen = before.union(LoopStackFavorites.foods.filter { stored.contains($0) }.map(\\.id)).union(fresh.map(\\.id))
        if seen != before {
            set(Array(seen), forKey: UserDefaults.loopStackSeededFavoriteIDs)
        }
        guard !fresh.isEmpty else { return stored }
        let merged = stored + fresh
        favoriteFoods = merged
        return merged
    }
}

/// Favorites chosen in LoopStack. Generated from loopstack/favorites.json; edit them in LoopStack.
enum LoopStackFavorites {
    static let foods: [StoredFavoriteFood] = [
${list}
    ]
}
`;
  const end = s.lastIndexOf('\n}');
  if (end < 0) throw new Error('Unexpected file layout.');
  return `${s.slice(0, end)}\n${tail}`;
}

// ------------------------------------------------------------ a unified diff (git format)

/** Line diff by longest common subsequence; the files here are a few hundred lines. */
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i += 1; j += 1; }
    else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', a[i]]); i += 1; }
    else { ops.push(['+', b[j]]); j += 1; }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

function unifiedDiff(path, before, after, context = 3) {
  const a = before.split('\n');
  const b = after.split('\n');
  // A trailing newline leaves an empty last element; diff the lines, not the terminator.
  if (a[a.length - 1] === '' && b[b.length - 1] === '') { a.pop(); b.pop(); }
  const ops = diffLines(a, b);
  const changed = ops.map((o, k) => (o[0] !== ' ' ? k : -1)).filter((k) => k >= 0);
  if (!changed.length) return '';
  const groups = [];
  for (const k of changed) {
    const last = groups[groups.length - 1];
    if (last && k - last[1] <= context * 2) last[1] = k; else groups.push([k, k]);
  }
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const [s, e] of groups) {
    const from = Math.max(0, s - context);
    const to = Math.min(ops.length - 1, e + context);
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < from; k += 1) { if (ops[k][0] !== '+') oldStart += 1; if (ops[k][0] !== '-') newStart += 1; }
    const body = ops.slice(from, to + 1);
    const oldN = body.filter((o) => o[0] !== '+').length;
    const newN = body.filter((o) => o[0] !== '-').length;
    out.push(`@@ -${oldStart},${oldN} +${newStart},${newN} @@`);
    for (const [c, l] of body) out.push(`${c}${l}`);
  }
  return `${out.join('\n')}\n`;
}

function makePatch(base, foods) {
  const after = seedSource(base, foods);
  return `${unifiedDiff(TARGET, base, after)}diff --git a/${MARKER} b/${MARKER}\nnew file mode 100644\nindex 0000000..e69de29\n`;
}

// ------------------------------------------------------------ the fork

async function readFavorites(cfg) {
  try {
    const { data } = await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${JSON_PATH}?ref=${encodeURIComponent(cfg.branch)}`, undefined, 'application/vnd.github.raw');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed?.foods) ? parsed.foods.map(cleanFood) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

/** The base file as the person's build sees it, before any patch. */
async function readBase(cfg) {
  const base = await buildReader(cfg)(TARGET);
  if (base == null) throw new Error('Can’t find Loop’s favorites code in your Loop version.');
  return base;
}

/** One commit with both files (Git Data API), so the list and the patch never disagree. */
async function commitFiles(cfg, files, message) {
  const t = cfg.token;
  const base = `/repos/${cfg.owner}/${cfg.repo}`;
  const { data: ref } = await gh(t, 'GET', `${base}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const { data: head } = await gh(t, 'GET', `${base}/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    const { data: blob } = await gh(t, 'POST', `${base}/git/blobs`, { content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const { data: newTree } = await gh(t, 'POST', `${base}/git/trees`, { base_tree: head.tree.sha, tree });
  const { data: commit } = await gh(t, 'POST', `${base}/git/commits`, { message, tree: newTree.sha, parents: [head.sha] });
  await gh(t, 'PATCH', `${base}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: commit.sha, force: false });
  return { sha: commit.sha, url: `https://github.com/${cfg.owner}/${cfg.repo}/commit/${commit.sha}` };
}

function register() {
  ipcMain.handle('fav:list', async () => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Connect your Loop in Settings first.' };
    try {
      return { ok: true, foods: await readFavorites(cfg) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // The change adding this favorite would make, for review.
  ipcMain.handle('fav:preview', async (_e, input) => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Connect your Loop in Settings first.' };
    try {
      const food = cleanFood(input?.food);
      const foods = [...(await readFavorites(cfg)), food];
      const base = await readBase(cfg);
      const patch = makePatch(base, foods);
      const check = await checkPatch(patch, async (p) => (p === TARGET ? base : null));
      if (check.status !== 'apply') return { ok: false, error: 'The change wouldn’t apply to your Loop version.' };
      return { ok: true, food, patch, count: foods.length };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('fav:add', async (_e, input) => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    if (input?.reviewed !== true) return { ok: false, error: 'Review the change first.' };
    if (input?.confirmDosing !== true) return { ok: false, error: 'A favorite prefills the carb screen. Confirm that separately before it’s added.' };
    try {
      const food = cleanFood(input?.food);
      const existing = await readFavorites(cfg);
      if (existing.some((f) => f.name.toLowerCase() === food.name.toLowerCase())) return { ok: false, error: `There’s already a LoopStack favorite called ${food.name}.` };
      const foods = [...existing, food];
      // Rebuilt from the person's code now, not from what the page showed.
      const base = await readBase(cfg);
      const patch = makePatch(base, foods);
      const check = await checkPatch(patch, async (p) => (p === TARGET ? base : null));
      if (check.status !== 'apply') return { ok: false, error: 'The change doesn’t apply to your Loop version any more.' };
      const json = `${JSON.stringify({ _note: 'Favorites added in LoopStack. LoopStack generates patches/loopstack_favorites.patch from this list; edit them in LoopStack.', foods }, null, 2)}\n`;
      const commit = await commitFiles(cfg, [{ path: JSON_PATH, content: json }, { path: PATCH_PATH, content: patch }], [
        `LoopStack: add ${food.name} to Loop favorites`,
        '',
        `${food.foodType ? `${food.foodType} ` : ''}${food.name}: ${food.grams} g, absorption ${food.absorptionMin} min. Chosen in LoopStack.`,
        `Changes dosing: yes (prefills the carb screen), confirmed separately in LoopStack.`,
        `Files: ${JSON_PATH}, ${PATCH_PATH} (changes ${TARGET} at build time).`,
        'Added to Loop favorites once, on the first launch of the build. Every carb entry is still confirmed on the phone.',
      ].join('\n'));
      return { ok: true, commit, foods };
    } catch (err) {
      if (err.status === 404) return { ok: false, error: 'GitHub refused the commit. The token needs Contents: read and write on this repository.' };
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { register, cleanFood, seedSource, unifiedDiff, makePatch, diffLines, commitFiles, TARGET };
