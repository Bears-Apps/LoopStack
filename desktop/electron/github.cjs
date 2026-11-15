// The person's Loop build on GitHub, from the main process (PRODUCT.md SAFE-3).
//
// Step 1 of docs/desktop/loop-branch-plan.md: connect, read, and start a build.
// LoopStack reads the person's LoopWorkspace fork (version, customizations,
// build runs) and can start the "4. Build Loop" workflow. It never needs the
// signing secrets (GH_PAT, MATCH_PASSWORD, FASTLANE_*): those stay in GitHub.
// Nothing is committed in this step.
//
// Token: a fine-grained personal access token limited to the LoopWorkspace
// repo, with Contents and Actions read/write. Encrypted with the OS keychain
// (safeStorage); never sent to the page.
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// A fake GitHub can stand in while developing; the packaged app always uses GitHub.
const API = !app.isPackaged && process.env.LOOPSTACK_GITHUB_API ? process.env.LOOPSTACK_GITHUB_API : 'https://api.github.com';
const WORKFLOW = 'build_loop.yml';
const TESTFLIGHT_DAYS = 90;
const TIMEOUT = 30_000;

const file = () => path.join(app.getPath('userData'), 'github.json');

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const token = c.token && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(c.token, 'base64')) : '';
    return { owner: c.owner || '', repo: c.repo || '', branch: c.branch || '', token };
  } catch {
    return { owner: '', repo: '', branch: '', token: '' };
  }
}

function writeConfig(c) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This Mac’s keychain isn’t available, so the token can’t be stored safely.');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ owner: c.owner, repo: c.repo, branch: c.branch, token: safeStorage.encryptString(c.token).toString('base64') }), { mode: 0o600 });
}

/** "owner/LoopWorkspace", a github.com URL, or just the repo name (owner from the token). */
function parseRepo(input) {
  const s = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
  if (m) return { owner: m[1], repo: m[2] };
  if (/^[A-Za-z0-9._-]{1,100}$/.test(s)) return { owner: '', repo: s };
  if (!s) return { owner: '', repo: 'LoopWorkspace' };
  throw new Error('Enter the repository as owner/LoopWorkspace or its github.com address.');
}

async function gh(token, method, p, body, accept = 'application/vnd.github+json') {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'LoopStack-desktop',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: 'error',
  });
  if (res.status === 401) throw new Error('GitHub didn’t accept the token. It may have expired or been revoked.');
  if (res.status === 403) throw new Error('The token doesn’t have permission for that. It needs Contents and Actions access to this repository.');
  if (res.status === 404) throw Object.assign(new Error('not found'), { status: 404 });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  if (accept.endsWith('raw')) return { data: await res.text(), scopes: null };
  return { data: res.status === 204 ? null : await res.json(), scopes: res.headers.get('x-oauth-scopes') };
}

const b64 = (s) => Buffer.from(String(s || '').replace(/\n/g, ''), 'base64').toString('utf8');

/** Names passed to Loop and Learn's CustomizationSelect.sh in a build workflow. */
function customizationNames(workflowText) {
  const i = workflowText.indexOf('CustomizationSelect.sh');
  if (i < 0) return [];
  const out = [];
  for (const line of workflowText.slice(i).split('\n').slice(1)) {
    const t = line.trim();
    const m = t.match(/^([a-z0-9_]+)\s*\\?$/);
    if (!m) break;
    out.push(m[1]);
    if (!t.endsWith('\\')) break;
  }
  return out;
}

async function loopVersion(token, cfg) {
  // LoopWorkspace sets the version in VersionOverride.xcconfig (Loop's own
  // Version.xcconfig can say 1.0); fall back to the Loop submodule's file.
  try {
    const { data: o } = await gh(token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/VersionOverride.xcconfig?ref=${encodeURIComponent(cfg.branch)}`);
    const text = b64(o?.content);
    const m = text.match(/^\s*LOOP_MARKETING_VERSION\s*=\s*([0-9.]+)/m);
    const n = text.match(/^\s*CURRENT_PROJECT_VERSION\s*=\s*([0-9]+)/m);
    if (m) return n ? `${m[1]} (${n[1]})` : m[1];
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  try {
    const { data: sub } = await gh(token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/contents/Loop?ref=${encodeURIComponent(cfg.branch)}`);
    if (sub?.type !== 'submodule' || !sub.sha) return null;
    const url = String(sub.submodule_git_url || 'https://github.com/LoopKit/Loop.git').match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    const [own, name] = url ? [url[1], url[2]] : ['LoopKit', 'Loop'];
    const { data: v } = await gh(token, 'GET', `/repos/${own}/${name}/contents/Version.xcconfig?ref=${sub.sha}`);
    const m = b64(v?.content).match(/LOOP_MARKETING_VERSION\s*=\s*([0-9.]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function readStatus(cfg) {
  const t = cfg.token;
  const base = `/repos/${cfg.owner}/${cfg.repo}`;
  const [{ data: repo }, version, patches, workflow, runs, wfText] = await Promise.all([
    gh(t, 'GET', base),
    loopVersion(t, cfg),
    gh(t, 'GET', `${base}/contents/patches?ref=${encodeURIComponent(cfg.branch)}`).then((r) => r.data).catch((e) => (e.status === 404 ? [] : Promise.reject(e))),
    gh(t, 'GET', `${base}/actions/workflows/${WORKFLOW}`).then((r) => r.data).catch((e) => (e.status === 404 ? null : Promise.reject(e))),
    gh(t, 'GET', `${base}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(cfg.branch)}&per_page=20`).then((r) => r.data.workflow_runs || []).catch((e) => (e.status === 404 ? [] : Promise.reject(e))),
    gh(t, 'GET', `${base}/contents/.github/workflows/${WORKFLOW}?ref=${encodeURIComponent(cfg.branch)}`).then((r) => b64(r.data?.content)).catch(() => ''),
  ]);
  const run = (r) => r && { id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, createdAt: r.created_at, url: r.html_url };
  const latest = runs[0] || null;
  // A cancelled run means "nothing to build" in LoopWorkspace; only success put a build in TestFlight.
  const lastBuilt = runs.find((r) => r.conclusion === 'success') || null;
  const expires = lastBuilt ? new Date(Date.parse(lastBuilt.updated_at || lastBuilt.created_at) + TESTFLIGHT_DAYS * 86_400_000).toISOString() : null;
  return {
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    htmlUrl: repo.html_url,
    isFork: Boolean(repo.fork),
    parent: repo.parent?.full_name ?? null,
    loopVersion: version,
    patches: Array.isArray(patches) ? patches.filter((p) => p.type === 'file').map((p) => p.name) : [],
    customizations: customizationNames(wfText),
    workflow: workflow ? { state: workflow.state, url: workflow.html_url } : null,
    latestRun: run(latest),
    lastBuild: run(lastBuilt),
    testflightExpiresAt: expires,
    readAt: new Date().toISOString(),
  };
}

/** The branch's latest commits, first line of each message only: what the chat can see of the repo's recent history. */
async function recentCommits(cfg, n = 20) {
  const { data } = await gh(cfg.token, 'GET', `/repos/${cfg.owner}/${cfg.repo}/commits?sha=${encodeURIComponent(cfg.branch)}&per_page=${n}`);
  return (Array.isArray(data) ? data : []).map((c) => ({
    sha: String(c.sha || '').slice(0, 7),
    date: c.commit?.committer?.date || c.commit?.author?.date || null,
    message: String(c.commit?.message || '').split('\n')[0].slice(0, 200),
  }));
}

function register() {
  ipcMain.handle('gh:config', () => {
    const c = readConfig();
    return { connected: Boolean(c.token && c.owner && c.repo), owner: c.owner, repo: c.repo, branch: c.branch };
  });

  ipcMain.handle('gh:connect', async (_e, input) => {
    try {
      const prev = readConfig();
      const token = String(input?.token || '').trim() || prev.token;
      if (!token) throw new Error('Paste a GitHub token.');
      if (/\s/.test(token) || token.length > 400) throw new Error('That doesn’t look like a GitHub token.');
      let { owner, repo } = parseRepo(input?.repo);
      const me = await gh(token, 'GET', '/user');
      if (!owner) owner = me.data.login;
      let info;
      try {
        info = (await gh(token, 'GET', `/repos/${owner}/${repo}`)).data;
      } catch (e) {
        if (e.status === 404) throw new Error(`Can’t see ${owner}/${repo}. Check the name, and that the token is allowed this repository.`);
        throw e;
      }
      const branch = String(input?.branch || '').trim() || info.default_branch;
      try {
        await gh(token, 'GET', `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
      } catch (e) {
        if (e.status === 404) throw new Error(`There’s no branch called ${branch} in ${owner}/${repo}.`);
        throw e;
      }
      writeConfig({ owner, repo, branch, token });
      // A classic token lists its scopes; a broad one works, but a fine-grained token limited to this repo is safer.
      const scopes = (me.scopes || '').split(',').map((s) => s.trim()).filter(Boolean);
      const broad = scopes.some((s) => ['repo', 'workflow', 'admin:org', 'delete_repo'].includes(s));
      return {
        ok: true,
        warnings: [
          ...(info.fork && info.parent?.full_name !== 'LoopKit/LoopWorkspace' ? [`${owner}/${repo} is a fork of ${info.parent?.full_name}, not LoopKit/LoopWorkspace.`] : []),
          ...(!info.fork ? [`${owner}/${repo} isn’t a fork of LoopKit/LoopWorkspace.`] : []),
          ...(broad ? ['This is a classic token with wide access to your account. A fine-grained token limited to LoopWorkspace (Contents and Actions) is safer.'] : []),
        ],
      };
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' ? 'GitHub didn’t answer in time.' : String(err?.message || err) };
    }
  });

  ipcMain.handle('gh:status', async () => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    try {
      return { ok: true, status: await readStatus(cfg) };
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' ? 'GitHub didn’t answer in time.' : String(err?.message || err) };
    }
  });

  // Starts "4. Build Loop" on the person's branch. The build itself (signing,
  // upload to TestFlight) runs in their GitHub Actions with their secrets.
  ipcMain.handle('gh:build', async () => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    try {
      await gh(cfg.token, 'POST', `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${WORKFLOW}/dispatches`, { ref: cfg.branch });
      return { ok: true };
    } catch (err) {
      if (err.status === 404) return { ok: false, error: 'This repository has no “4. Build Loop” workflow, or Actions are turned off. Turn them on under Actions in GitHub.' };
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('gh:commits', async () => {
    const cfg = readConfig();
    if (!cfg.token) return { ok: false, error: 'Not connected.' };
    try {
      return { ok: true, commits: await recentCommits(cfg) };
    } catch (err) {
      return { ok: false, error: err?.name === 'TimeoutError' ? 'GitHub didn’t answer in time.' : String(err?.message || err) };
    }
  });

  ipcMain.handle('gh:disconnect', () => {
    try { fs.rmSync(file(), { force: true }); } catch { /* already gone */ }
    return { ok: true };
  });
}

module.exports = { register, parseRepo, customizationNames, readStatus, readConfig, recentCommits, gh, b64 };
