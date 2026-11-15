// Reads the LoopStack system from the working tree, fresh on every call:
// the rule files, tokens, components, registry, research and decisions.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { namedRules, parseTokens, splitSections } from './core.mjs';

export const ROOT = process.env.LOOPSTACK_SYSTEM_ROOT || path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readIf = (f) => (fs.existsSync(path.join(ROOT, f)) ? read(f) : '');

function components(registry) {
  const out = [];
  for (const base of ['src/components', 'src/screens']) {
    const dir = path.join(ROOT, base);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!fs.statSync(full).isDirectory()) continue;
      const files = fs.readdirSync(full).filter((f) => /\.(tsx|ts|css)$/.test(f) && !/\.test\./.test(f));
      out.push({ name, dir: `${base}/${name}`, files, kind: base.endsWith('screens') ? 'screen' : 'component', registry: registry.components[name] || null });
    }
  }
  return out;
}

function research() {
  const dir = path.join(ROOT, 'diy-loop-clinician-research/results');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const first = (s) => String(s || '').split(/(?<=[.:])\s/)[0].replace(/[.:]$/, '');
    const sources = Array.isArray(d.key_sources) ? d.key_sources.slice(0, 5).map((k) => (typeof k === 'string' ? k : `${k.title || ''}${k.year ? ` (${k.year})` : ''}${k.sample_size ? `, n=${k.sample_size}` : ''} — ${k.url || ''}`)) : [];
    return {
      topic: d.item_name || f.replace(/\.json$/, '').replace(/_/g, ' '),
      file: `diy-loop-clinician-research/results/${f}`,
      severity: first(d.severity_rank),
      safety: first(d.safety_criticality),
      unmet_need: String(d.unmet_need || ''),
      implication: String(d.implication_for_collaboration_tool || ''),
      sources,
      uncertain: d.uncertain || [],
    };
  });
}

export function loadSystem() {
  const design = read('DESIGN.md');
  const product = read('PRODUCT.md');
  const agents = JSON.parse(read('src/data/system-agents.json'));
  const registry = JSON.parse(read('src/data/system-registry.json'));
  return {
    root: ROOT,
    sections: [...splitSections(design, 'DESIGN.md'), ...splitSections(product, 'PRODUCT.md')],
    rules: [...namedRules(design, 'DESIGN.md'), ...namedRules(product, 'PRODUCT.md')],
    tokens: parseTokens(read('src/styles/tokens.css')),
    agents,
    registry,
    components: components(registry),
    research: research(),
    decisions: {
      pending: readIf('DECISIONS-PENDING.md'),
      report: splitSections(readIf('docs/desktop/research-report.md'), 'docs/desktop/research-report.md').find((s) => /open decisions/i.test(s.heading)) || null,
    },
  };
}

export const isExempt = (file, agents) => agents.exempt.includes(file.replace(/\\/g, '/'));
