// The person's own features: the patch files in their LoopWorkspace patches/
// folder, turned on and off by moving each between patches/ and patches/off/.
// The build's "Customize Loop" step applies ./patches/*.patch only, so a file
// in patches/off/ stays in the repo, with its history, and out of the build.
//
// PRODUCT.md SAFE-3 and SAFE-6, enforced here rather than trusted to the page:
// - every toggle is checked first: the patches that would be on are applied
//   one after another to the person's Loop source, the way the build does,
//   and a change that would stop the build is refused (or done together with
//   the patches it takes along, when the person asks for that);
// - turning a dosing patch on needs the review and the second confirmation;
// - a patch that removes a safety check (no authentication) can be turned
//   off but is never turned on;
// - each toggle is one commit, made with the Git Data API, naming what moved.
const { ipcMain } = require('electron');
const { readConfig, gh } = require('./github.cjs');
const { buildReader } = require('./library.cjs');
const { checkStack, checkPatch } = require('./patchcheck.cjs');
const catalog = require('./personal-features.json');
const libCatalog = require('./customizations.json');

const ON = 'patches';
const OFF = 'patches/off';
const RAW = 'application/vnd.github.raw';
const NAME = /^[A-Za-z0-9._-]{1,120}\.patch$/;
const BY_ID = new Map(catalog.items.map((c) => [c.id, c]));
// Loop and Learn patches the library added (patches/<id>.patch) show in the library's own list.
const LIBRARY_FILES = new Set(libCatalog.items.map((c) => `${c.id}.patch`));
const enc = encodeURIComponent;
// A patch that touches the authentication check is never turned on, whatever it's called.
const REFUSE_ON = /Environment\+Authenticate|LocalAuthentication/;

/** "08-meal-patterns-and-tools.patch" → "meal-patterns-and-tools". */
const stemOf = (name) => String(name).replace(/\.patch$/, '').replace(/^\d+[-_ ]*/, '');

/** What LoopStack knows about a patch file; an unknown one is named from its file and treated as dosing. */
function describe(name) {
  const c = BY_ID.get(stemOf(name));
  if (c) return { ...c, known: true };
  const words = stemOf(name).replace(/[-_]+/g, ' ').trim();
  return { id: stemOf(name), name: words ? words[0].toUpperCase() + words.slice(1) : name, what: 'A patch in your patches folder that LoopStack doesn’t know. It can’t tell what it changes, so it treats it as changing dosing.', icon: 'patch', dosing: true, canTurnOn: true, source: 'Your patches folder', rank: 100, known: false };
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Plan a toggle. `files` is every patch file with where it is now
 * ({ name, on }); `results(onNames)` checks a stack and resolves to the
 * checkStack results. Returns what has to move for the build to keep applying:
 *   { ok: true, moves: [{ name, to: 'on' | 'off' }] }
 *   { ok: false, reason, needs?: [names] }
 * Turning off takes along, in order, every later patch that stops fitting
 * once it's gone (only when `together` is true; otherwise it names them).
 * Turning on needs it, and every patch after it, to fit on top of what's on.
 */
async function planToggle(files, name, to, together, results) {
  const f = files.find((x) => x.name === name);
  if (!f) return { ok: false, reason: 'That patch isn’t in your patches folder.' };
  if ((to === 'on') === f.on) return { ok: false, reason: to === 'on' ? 'It’s already on.' : 'It’s already off.' };
  let on = files.filter((x) => x.on).map((x) => x.name);
  if (to === 'off') {
    on = on.filter((n) => n !== name);
    const along = [];
    for (;;) {
      const r = await results(on.sort(byName));
      const bad = r.find((x) => x.status === 'conflict');
      if (!bad) break;
      along.push(bad.name);
      on = on.filter((n) => n !== bad.name);
    }
    if (along.length && !together) return { ok: false, reason: 'Other patches are built on this one.', needs: along };
    return { ok: true, moves: [{ name, to: 'off' }, ...along.map((n) => ({ name: n, to: 'off' }))] };
  }
  const r = await results([...on, name].sort(byName));
  const bad = r.find((x) => x.status === 'conflict');
  if (bad) {
    // Which patches that are off would it need? Try them all, then drop the ones it doesn't.
    const off = files.filter((x) => !x.on && x.name !== name && describe(x.name).canTurnOn).map((x) => x.name);
    let need = off;
    const fits = async (extra) => !(await results([...on, name, ...extra].sort(byName))).some((x) => x.status === 'conflict');
    if (off.length && await fits(off)) {
      for (const n of off) if (await fits(need.filter((m) => m !== n))) need = need.filter((m) => m !== n);
      return { ok: false, reason: 'It’s built on patches that are off.', needs: need };
    }
    return { ok: false, reason: bad.name === name ? `It doesn’t fit your Loop with the patches that are on (at ${bad.failedAt}).` : `Turning it on would stop ${bad.name} from applying.` };
  }
  return { ok: true, moves: [{ name, to: 'on' }] };
}

/** The tree entries for one commit that moves files between patches/ and patches/off/, keeping each blob. */
function moveTree(moves, blobs) {
  const tree = [];
  for (const m of moves) {
    const sha = blobs.get(m.name);
    if (!sha) throw new Error(`No file for ${m.name}.`);
    const from = m.to === 'on' ? `${OFF}/${m.name}` : `${ON}/${m.name}`;
    const dest = m.to === 'on' ? `${ON}/${m.name}` : `${OFF}/${m.name}`;
    tree.push({ path: dest, mode: '100644', type: 'blob', sha });
    tree.push({ path: from, mode: '100644', type: 'blob', sha: null });
  }
  return tree;
}

function commitMessage(moves) {
  const head = moves[0];
  const d = describe(head.name);
  const lines = [
    `LoopStack: turn ${head.to} ${d.name} (${head.name})`,
    '',
    ...moves.map((m) => `${m.to === 'on' ? 'On ' : 'Off'}: ${m.name}${m.to === 'on' ? ' (patches/off → patches)' : ' (patches → patches/off)'}`),
    '',
    `Changes dosing: ${moves.some((m) => m.to === 'on' && describe(m.name).dosing) ? 'yes, confirmed separately in LoopStack' : 'no new dosing change turned on'}`,
    'Checked in LoopStack: the patches that are on apply in order to this Loop. Not compiled.',
    'Files in patches/off/ stay in the repo and out of the build.',
  ];
  return lines.join('\n');
}

async function listDir(cfg, dir) {
  try {
    const { data } = await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${dir}?ref=${enc(cfg.branch)}`);
    return Array.isArray(data) ? data.filter((f) => f.type === 'file' && NAME.test(f.name) && !LIBRARY_FILES.has(f.name)).map((f) => ({ name: f.name, sha: f.sha })) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

async function readAll(cfg) {
  const [on, off] = await Promise.all([listDir(cfg, ON), listDir(cfg, OFF)]);
  const files = [...on.map((f) => ({ ...f, on: true })), ...off.filter((f) => !on.some((o) => o.name === f.name)).map((f) => ({ ...f, on: false }))];
  return files.sort((a, b) => byName(a.name, b.name));
}

const fileText = async (cfg, f) => (await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${f.on ? ON : OFF}/${enc(f.name)}?ref=${enc(cfg.branch)}`, undefined, RAW)).data;

/** A checker over the person's Loop source, reading each patch once. */
function stackChecker(cfg, files) {
  const read = buildReader(cfg);
  const texts = new Map();
  const text = (n) => {
    if (!texts.has(n)) texts.set(n, fileText(cfg, files.find((f) => f.name === n)));
    return texts.get(n);
  };
  return { text, results: async (names) => checkStack(await Promise.all(names.map(async (name) => ({ name, text: await text(name) }))), read) };
}

async function commitMoves(cfg, moves, files) {
  const base = `/repos/${cfg.owner}/${cfg.repo}`;
  const { data: ref } = await gh(cfg.token, 'GET', `${base}/git/ref/heads/${enc(cfg.branch)}`);
  const { data: head } = await gh(cfg.token, 'GET', `${base}/git/commits/${ref.object.sha}`);
  const { data: tree } = await gh(cfg.token, 'POST', `${base}/git/trees`, { base_tree: head.tree.sha, tree: moveTree(moves, new Map(files.map((f) => [f.name, f.sha]))) });
  const { data: commit } = await gh(cfg.token, 'POST', `${base}/git/commits`, { message: commitMessage(moves), tree: tree.sha, parents: [ref.object.sha] });
  // Not forced: if the branch moved since it was read, this fails and nothing changes.
  await gh(cfg.token, 'PATCH', `${base}/git/refs/heads/${enc(cfg.branch)}`, { sha: commit.sha, force: false });
  return { sha: commit.sha, url: commit.html_url };
}

function register() {
  ipcMain.handle('mine:list', async () => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Connect your Loop in Settings first.' };
    try {
      const files = await readAll(cfg);
      return { ok: true, items: files.map((f) => ({ file: f.name, on: f.on })) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // The patch text and what it touches, for the review before turning it on.
  ipcMain.handle('mine:check', async (_e, input) => {
    const cfg = readConfig();
    const name = String(input?.file || '');
    if (!cfg.token || !NAME.test(name)) return { ok: false, error: 'Not available.' };
    try {
      const files = await readAll(cfg);
      const f = files.find((x) => x.name === name);
      if (!f) return { ok: false, error: 'That patch isn’t in your patches folder.' };
      const text = await fileText(cfg, f);
      const { summary } = await checkPatch(text, async () => null);
      return { ok: true, file: name, on: f.on, patch: text, files: summary };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('mine:toggle', async (_e, input) => {
    const cfg = readConfig();
    const name = String(input?.file || '');
    const to = input?.to === 'on' ? 'on' : input?.to === 'off' ? 'off' : null;
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    if (!NAME.test(name) || !to) return { ok: false, error: 'Not available.' };
    const d = describe(name);
    try {
      const files = await readAll(cfg);
      const { text, results } = stackChecker(cfg, files);
      if (to === 'on') {
        if (!d.canTurnOn || REFUSE_ON.test(await text(name))) return { ok: false, error: 'LoopStack never turns this on: it removes a safety check (SAFE-6).' };
        if (input?.reviewed !== true) return { ok: false, error: 'Review the change first.' };
        if (d.dosing && input?.confirmDosing !== true) return { ok: false, error: 'This one changes dosing. Confirm that separately before it’s turned on.' };
      }
      const plan = await planToggle(files, name, to, input?.together === true, results);
      if (!plan.ok) return { ok: false, error: plan.reason, needs: plan.needs ?? [] };
      const commit = await commitMoves(cfg, plan.moves, files);
      return { ok: true, moves: plan.moves, commit };
    } catch (err) {
      if (err.status === 404 || err.status === 403) return { ok: false, error: 'GitHub refused the commit. The token needs Contents: read and write on this repository.' };
      if (err.status === 422) return { ok: false, error: 'Your branch changed while LoopStack was checking. Try again.' };
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { register, describe, stemOf, planToggle, moveTree, commitMessage, REFUSE_ON };
