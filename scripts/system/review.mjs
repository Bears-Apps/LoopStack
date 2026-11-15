#!/usr/bin/env node
// The LoopStack review gate. Checks only the lines a change adds, compared with
// a git ref (default HEAD: your uncommitted work). Blocking findings exit 1;
// the rest are reported. Drift that predates the change is audit_drift's job.
//
//   npm run system:review              # uncommitted work vs HEAD
//   npm run system:review -- main      # this branch vs main
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { blocksChange, checkSource, CODES } from './core.mjs';
import { isExempt, loadSystem } from './load.mjs';

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** { file: Set(addedLineNumbers) | 'all' } for src files changed against base, plus untracked ones. */
function addedLines(root, base) {
  const out = {};
  const diff = git(root, ['diff', '-U0', '--no-color', base, '--', 'src']);
  let file = null;
  for (const line of diff.split('\n')) {
    const f = /^\+\+\+ b\/(.*)$/.exec(line);
    if (f) { file = f[1]; out[file] = out[file] || new Set(); continue; }
    const h = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      for (let i = 0; i < count; i += 1) out[file].add(start + i);
    }
  }
  for (const f of git(root, ['ls-files', '--others', '--exclude-standard', '--', 'src']).split('\n').filter(Boolean)) out[f] = 'all';
  return out;
}

export function runReview({ base = 'HEAD' } = {}) {
  const s = loadSystem();
  const changed = addedLines(s.root, base);
  const findings = [];
  for (const [file, lines] of Object.entries(changed)) {
    if (!/\.(tsx|ts|css)$/.test(file) || /\.test\./.test(file) || isExempt(file, s.agents)) continue;
    const full = path.join(s.root, file);
    if (!fs.existsSync(full)) continue;
    for (const f of checkSource(fs.readFileSync(full, 'utf8'), s.tokens)) {
      if (lines === 'all' || lines.has(f.line)) findings.push({ file, ...f, blocking: blocksChange(f) });
    }
  }
  // New component folders the registry doesn't list.
  const seen = new Set();
  for (const file of Object.keys(changed)) {
    const m = /^src\/components\/([^/]+)\//.exec(file);
    if (m && !seen.has(m[1]) && !s.registry.components[m[1]]) {
      seen.add(m[1]);
      findings.push({ file: `src/components/${m[1]}`, line: 0, code: 'REG001', rule: CODES.REG001, match: m[1], blocking: false, fix: 'add it to src/data/system-registry.json with its size and where it is documented' });
    }
  }
  return { base, files: Object.keys(changed).length, findings };
}

export function reviewReport({ base, files, findings }) {
  const blocking = findings.filter((f) => f.blocking);
  const advisory = findings.filter((f) => !f.blocking);
  const fmt = (f) => `- ${f.file}${f.line ? `:${f.line}` : ''} **${f.code}** ${f.rule}: \`${f.match}\`${f.fix ? ` (${f.fix})` : ''}`;
  return [
    `# LoopStack review against ${base}`,
    `${files} changed file(s) in src. ${blocking.length} blocking, ${advisory.length} advisory.`,
    blocking.length ? `\n## Blocking: fix before committing\n${blocking.map(fmt).join('\n')}` : '\nNothing blocking.',
    advisory.length ? `\n## Advisory: answer or fix\n${advisory.map(fmt).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('review.mjs')) {
  const result = runReview({ base: process.argv[2] || 'HEAD' });
  process.stdout.write(`${reviewReport(result)}\n`);
  process.exit(result.findings.some((f) => f.blocking) ? 1 : 0);
}
