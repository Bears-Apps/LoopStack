// The feature library (step 2 of docs/desktop/loop-branch-plan.md).
//
// Loop and Learn's customizations, read from loopandlearn/customization and
// checked against the person's own Loop. Adding one commits its patch file to
// `patches/` on the person's LoopWorkspace branch, which the "4. Build Loop"
// workflow applies to every build. Removing one deletes that file.
//
// PRODUCT.md SAFE-3 and SAFE-6, enforced here rather than trusted to the page:
// - the patch committed is re-read from the source at the pinned commit, and
//   re-checked against the person's code, at the moment of the commit;
// - a customization that changes dosing (or one not in the catalog) needs
//   the second confirmation; no_auth is never committed;
// - every commit names its source, version and dosing status.
const { ipcMain } = require('electron');
const { readConfig, gh } = require('./github.cjs');
const { checkPatch } = require('./patchcheck.cjs');
const catalog = require('./customizations.json');

const SOURCE = { owner: 'loopandlearn', repo: 'customization', branch: 'main' };
const RAW = 'application/vnd.github.raw';
const BY_ID = new Map(catalog.items.map((c) => [c.id, c]));
const enc = encodeURIComponent;
const fileOf = (id) => `patches/${id}.patch`;

/** Reads files at the person's build: workspace files, or files inside a submodule at its pinned commit. */
function buildReader(cfg) {
  const subs = new Map();
  const files = new Map();
  const submodule = (seg) => {
    if (!subs.has(seg)) {
      subs.set(seg, gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${enc(seg)}?ref=${enc(cfg.branch)}`)
        .then(({ data }) => {
          if (data?.type !== 'submodule') return null;
          const m = String(data.submodule_git_url || '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
          return m ? { owner: m[1], repo: m[2], sha: data.sha } : null;
        })
        .catch(() => null));
    }
    return subs.get(seg);
  };
  return async (path) => {
    if (files.has(path)) return files.get(path);
    const p = (async () => {
      const [seg, ...rest] = path.split('/');
      const sub = rest.length ? await submodule(seg) : null;
      const url = sub
        ? `/repos/${sub.owner}/${sub.repo}/contents/${rest.map(enc).join('/')}?ref=${sub.sha}`
        : `/repos/${cfg.owner}/${cfg.repo}/contents/${path.split('/').map(enc).join('/')}?ref=${enc(cfg.branch)}`;
      try {
        return (await gh(cfg.token, 'GET', url, undefined, RAW)).data;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    })();
    files.set(path, p);
    return p;
  };
}

async function sourceHead(token) {
  const { data } = await gh(token, 'GET', `/repos/${SOURCE.owner}/${SOURCE.repo}/commits/${SOURCE.branch}`);
  return data.sha;
}

/** Every customization folder's current patch variants (archive/ is skipped), at one pinned commit. */
async function sourceTree(token, sha) {
  const { data } = await gh(token, 'GET', `/repos/${SOURCE.owner}/${SOURCE.repo}/git/trees/${sha}?recursive=1`);
  const byId = new Map();
  for (const t of data.tree || []) {
    const m = t.type === 'blob' && t.path.match(/^([a-z0-9_]+)\/([^/]+\.patch)$/);
    if (!m) continue;
    byId.set(m[1], [...(byId.get(m[1]) || []), t.path].sort());
  }
  return byId;
}

const sourceFile = async (token, path, sha) => (await gh(token, 'GET', `/repos/${SOURCE.owner}/${SOURCE.repo}/contents/${path.split('/').map(enc).join('/')}?ref=${sha}`, undefined, RAW)).data;

/** The first variant (in name order, as CustomizationSelect does) that applies or is already applied. */
async function pickVariant(cfg, variants, sha, read) {
  for (const v of variants) {
    const text = await sourceFile(cfg.token, v, sha);
    const r = await checkPatch(text, read);
    if (r.status !== 'conflict') return { variant: v, text, ...r };
  }
  return { variant: null, text: null, status: 'conflict', files: [], summary: [] };
}

async function listPatches(cfg) {
  try {
    const { data } = await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/patches?ref=${enc(cfg.branch)}`);
    return Array.isArray(data) ? data.filter((f) => f.type === 'file').map((f) => ({ name: f.name, sha: f.sha })) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

async function history(cfg) {
  try {
    const { data } = await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/commits?path=patches&sha=${enc(cfg.branch)}&per_page=15`);
    return (data || []).map((c) => ({ sha: c.sha, message: String(c.commit?.message || '').split('\n')[0], date: c.commit?.author?.date || null, url: c.html_url, byLoopStack: /^LoopStack: /.test(c.commit?.message || '') }));
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

function register() {
  ipcMain.handle('lib:list', async () => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Connect your Loop in Settings first.' };
    try {
      const sha = await sourceHead(cfg.token);
      const [tree, patches, log] = await Promise.all([sourceTree(cfg.token, sha), listPatches(cfg), history(cfg)]);
      const items = catalog.items.filter((c) => c.offered).map((c) => ({ id: c.id, variants: tree.get(c.id) || [], inPatches: patches.some((p) => p.name === `${c.id}.patch`) }));
      return { ok: true, sourceSha: sha, items, patches: patches.map((p) => p.name), history: log };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // Which variant fits, the full patch text, and what it touches.
  ipcMain.handle('lib:check', async (_e, input) => {
    const cfg = readConfig();
    const c = BY_ID.get(String(input?.id));
    if (!cfg.token || !c || !c.offered) return { ok: false, error: 'Not available.' };
    try {
      const sha = String(input?.sourceSha || '');
      if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, error: 'Read the library again.' };
      const tree = await sourceTree(cfg.token, sha);
      const r = await pickVariant(cfg, tree.get(c.id) || [], sha, buildReader(cfg));
      return { ok: true, id: c.id, variant: r.variant, status: r.status, files: r.summary, patch: r.text };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('lib:add', async (_e, input) => {
    const cfg = readConfig();
    const c = BY_ID.get(String(input?.id));
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    if (!c || !c.offered) return { ok: false, error: 'LoopStack doesn’t add that customization.' };
    if (input?.reviewed !== true) return { ok: false, error: 'Review the changes first.' };
    if (c.dosing && input?.confirmDosing !== true) return { ok: false, error: 'This one changes dosing. Confirm that separately before it’s added.' };
    try {
      const sha = String(input?.sourceSha || '');
      if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, error: 'Read the library again.' };
      // Re-read and re-check now: the person's code or the source may have moved since the review.
      const tree = await sourceTree(cfg.token, sha);
      const r = await pickVariant(cfg, tree.get(c.id) || [], sha, buildReader(cfg));
      if (r.status !== 'apply') return { ok: false, error: r.status === 'applied' ? 'Your Loop already has this change.' : 'This customization doesn’t fit your Loop version any more.' };
      if (r.variant !== input?.variant) return { ok: false, error: 'A different version of this customization fits now. Review it again.' };
      const existing = (await listPatches(cfg)).find((p) => p.name === `${c.id}.patch`);
      const message = [
        `LoopStack: add ${c.name} (${c.id})`,
        '',
        `Source: ${SOURCE.owner}/${SOURCE.repo}/${r.variant} @ ${sha.slice(0, 7)}`,
        `Changes dosing: ${c.dosing ? 'yes, confirmed separately in LoopStack' : 'no'}`,
        `Files: ${r.summary.map((f) => f.path).join(', ')}`,
        'Applied by the "Customize Loop" step of 4. Build Loop. Reviewed and approved in LoopStack.',
      ].join('\n');
      const { data } = await gh(cfg.token, 'PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${fileOf(c.id)}`, {
        message,
        content: Buffer.from(r.text, 'utf8').toString('base64'),
        branch: cfg.branch,
        ...(existing ? { sha: existing.sha } : {}),
      });
      return { ok: true, commit: { sha: data?.commit?.sha, url: data?.commit?.html_url } };
    } catch (err) {
      if (err.status === 404) return { ok: false, error: 'GitHub refused the commit. The token needs Contents: read and write on this repository.' };
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('lib:remove', async (_e, input) => {
    const cfg = readConfig();
    const id = String(input?.id || '');
    if (!cfg.token || !/^[a-z0-9_]+$/.test(id)) return { ok: false, error: 'Not available.' };
    try {
      const existing = (await listPatches(cfg)).find((p) => p.name === `${id}.patch`);
      if (!existing) return { ok: false, error: 'It isn’t in your patches folder.' };
      const c = BY_ID.get(id);
      const { data } = await gh(cfg.token, 'DELETE', `/repos/${cfg.owner}/${cfg.repo}/contents/${fileOf(id)}`, {
        message: `LoopStack: remove ${c ? c.name : id} (${id})\n\nRemoved in LoopStack. The next build of 4. Build Loop leaves it out.`,
        sha: existing.sha,
        branch: cfg.branch,
      });
      return { ok: true, commit: { sha: data?.commit?.sha, url: data?.commit?.html_url } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { register, buildReader, pickVariant };
