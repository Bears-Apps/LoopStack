// Will a patch apply to the person's Loop? The same question Loop and Learn's
// CustomizationSelect.sh asks with `git apply --check`, answered without git:
// every hunk's old lines must appear, in order, in the file the build will
// patch. A patch whose new lines are already there is "already applied".
// Pure functions; tested in electron/test/patchcheck.test.cjs.

/** Parse a git-format unified diff into files and hunks. */
function parsePatch(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let minus = null;
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const d = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (d) {
      file = { path: d[2], oldPath: d[1], isNew: false, isDeleted: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    // A plain unified diff (no "diff --git" line): "--- a/X" then "+++ b/X" starts a file.
    if (!(hunk && (hunk.oldLeft > 0 || hunk.newLeft > 0))) {
      const m = raw.match(/^--- (?:a\/(.+?)|\/dev\/null)\t?$/);
      if (m) { minus = m[1] ?? null; continue; }
      const pl = raw.match(/^\+\+\+ (?:b\/(.+?)|\/dev\/null)\t?$/);
      if (pl) {
        const pathNew = pl[1] ?? minus;
        if (pathNew && (!file || file.hunks.length || file.path !== pathNew)) {
          file = { path: pathNew, oldPath: minus ?? pathNew, isNew: minus == null, isDeleted: pl[1] == null, hunks: [] };
          files.push(file);
          hunk = null;
        }
        minus = null;
        continue;
      }
    }
    if (!file) continue;
    if (/^new file mode/.test(raw)) { file.isNew = true; continue; }
    if (/^deleted file mode/.test(raw)) { file.isDeleted = true; continue; }
    // Inside a hunk, its header's line counts say how many lines belong to it.
    // An empty line there is an unchanged blank line (editors strip the space).
    if (hunk && (hunk.oldLeft > 0 || hunk.newLeft > 0)) {
      const c = raw[0];
      const line = raw.slice(1);
      if (raw === '' || c === ' ') { hunk.old.push(line); hunk.new.push(line); hunk.oldLeft -= 1; hunk.newLeft -= 1; continue; }
      if (c === '-') { hunk.old.push(line); hunk.removed += 1; hunk.oldLeft -= 1; continue; }
      if (c === '+') { hunk.new.push(line); hunk.added += 1; hunk.newLeft -= 1; continue; }
      if (c === '\\') continue; // "\ No newline at end of file"
    }
    const h = raw.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (h) {
      hunk = { old: [], new: [], added: 0, removed: 0, oldLeft: h[1] == null ? 1 : Number(h[1]), newLeft: h[2] == null ? 1 : Number(h[2]) };
      file.hunks.push(hunk);
    }
  }
  return files;
}

const norm = (l) => l.replace(/\r$/, '');

/** Index after the first match of `block` in `lines` at or after `from`, or -1. */
function findBlock(lines, block, from) {
  if (!block.length) return from;
  outer: for (let i = from; i <= lines.length - block.length; i += 1) {
    for (let j = 0; j < block.length; j += 1) if (norm(lines[i + j]) !== norm(block[j])) continue outer;
    return i + block.length;
  }
  return -1;
}

/** 'apply' | 'applied' | 'conflict' for one file's hunks against its content (null = file absent). */
function checkFile(file, content) {
  if (file.isNew) return content == null ? 'apply' : 'applied';
  if (content == null) return file.isDeleted ? 'applied' : 'conflict';
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const fits = (side) => {
    let at = 0;
    for (const h of file.hunks) {
      at = findBlock(lines, h[side], at);
      if (at < 0) return false;
    }
    return true;
  };
  if (fits('old')) return 'apply';
  if (fits('new')) return 'applied';
  return 'conflict';
}

/**
 * Check a whole patch. `read(path)` resolves to the file's text at the
 * person's build, or null when it doesn't exist. Marker files
 * (`*.loopcustomization`) are created at build time and never committed, so
 * they don't decide the result.
 */
async function checkPatch(text, read) {
  const files = parsePatch(text);
  const results = [];
  for (const f of files) {
    if (/\.loopcustomization$/.test(f.path)) { results.push({ path: f.path, result: 'marker' }); continue; }
    results.push({ path: f.path, result: checkFile(f, await read(f.path)) });
  }
  const real = results.filter((r) => r.result !== 'marker');
  const status = !real.length ? 'conflict'
    : real.every((r) => r.result === 'apply') ? 'apply'
      : real.every((r) => r.result === 'applied') ? 'applied'
        : 'conflict';
  return { status, files: results, summary: files.filter((f) => !/\.loopcustomization$/.test(f.path)).map((f) => ({ path: f.path, isNew: f.isNew, added: f.hunks.reduce((t, h) => t + h.added, 0), removed: f.hunks.reduce((t, h) => t + h.removed, 0) })) };
}

/** The file after its hunks, in order, or undefined when a hunk doesn't fit (null = file deleted or absent). */
function applyFile(file, content) {
  if (file.isNew) return content == null ? file.hunks.flatMap((h) => h.new).join('\n') : undefined;
  if (content == null) return undefined;
  if (file.isDeleted) return null;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let at = 0;
  for (const h of file.hunks) {
    const end = findBlock(lines, h.old, at);
    if (end < 0) return undefined;
    const start = end - h.old.length;
    lines.splice(start, h.old.length, ...h.new);
    at = start + h.new.length;
  }
  return lines.join('\n');
}

/**
 * Apply patches one after another, the way the build's "Customize Loop" step
 * does (check, then apply, patch by patch, each on top of the last). Returns
 * each patch's result; once one fails the build stops, so later ones are
 * 'skipped'. It checks that the text fits, not that the result compiles.
 */
async function checkStack(patches, read) {
  const overlay = new Map();
  const at = async (p) => (overlay.has(p) ? overlay.get(p) : read(p));
  const out = [];
  let failed = false;
  for (const { name, text } of patches) {
    if (failed) { out.push({ name, status: 'skipped', failedAt: null }); continue; }
    const next = new Map();
    let bad = null;
    for (const f of parsePatch(text)) {
      if (/\.loopcustomization$/.test(f.path)) continue;
      const r = applyFile(f, next.has(f.path) ? next.get(f.path) : await at(f.path));
      if (r === undefined) { bad = f.path; break; }
      next.set(f.path, r);
    }
    if (bad) { failed = true; out.push({ name, status: 'conflict', failedAt: bad }); continue; }
    for (const [p, c] of next) overlay.set(p, c);
    out.push({ name, status: 'apply', failedAt: null });
  }
  return out;
}

module.exports = { parsePatch, checkFile, checkPatch, findBlock, applyFile, checkStack };
