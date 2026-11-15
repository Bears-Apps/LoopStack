#!/usr/bin/env node
// loopstack-system: an MCP server for LoopStack and LoopStack+ work and system
// governance. Zero dependencies, stdio, read-only. It reads this working tree
// on every call, so answers change as you work.
//
//   Claude Code picks it up from .mcp.json:  node scripts/system/mcp.mjs
//   Anywhere else:  claude mcp add loopstack-system -- node <repo>/scripts/system/mcp.mjs
//
// The rules live in DESIGN.md and PRODUCT.md; the sizes, tools and gates in
// src/data/system-agents.json; the registry in src/data/system-registry.json.
// The checks are the same functions the review gate runs (core.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { CODES, blocksChange, checkCopy, checkSource, nearestToken, relatives, searchSystem, summarize } from './core.mjs';
import { isExempt, loadSystem } from './load.mjs';

const VERSION = '1.0.0';

const str = (description) => ({ type: 'string', description });
const SCHEMAS = {
  search_system: { type: 'object', properties: { query: str('Words to look for, e.g. "glass", "missing data", "insulin colour", "disclosure"'), limit: { type: 'number', description: 'Max results (default 8)' } }, required: ['query'] },
  get_rules: { type: 'object', properties: { topic: str('Optional section heading ("Data visuals", "Clinical safety") or rule id ("VIS-3", "SAFE-1")') } },
  find_tokens: { type: 'object', properties: { hex: str('Optional raw colour, e.g. "#4fb84f", to match to a token') } },
  get_component: { type: 'object', properties: { name: str('Component or screen name, e.g. "TimeInRangeBar", "WeekdayHours"') }, required: ['name'] },
  get_checklist: { type: 'object', properties: { size: { type: 'string', enum: ['sketch', 'playground', 'production'], description: 'Which size the work is at' } }, required: ['size'] },
  check_source: { type: 'object', properties: { code: str('TSX, TS or CSS to check'), file: str('Optional file name, for the report') }, required: ['code'] },
  check_copy: { type: 'object', properties: { text: str('Copy to check: plain text, markdown or TSX') }, required: ['text'] },
  get_research: { type: 'object', properties: { query: str('Optional words, e.g. "disclosure", "settings history", "pediatric"') } },
  get_decisions: { type: 'object', properties: {} },
  audit_drift: { type: 'object', properties: { code: str('Optional finding code to list in full, e.g. "COL001"') } },
  review_change: { type: 'object', properties: { base: str('Git ref to compare with (default HEAD: uncommitted work)') } },
};

const withFix = (findings) => findings.map((f) => ({ ...f, blocking: blocksChange(f) }));

const HANDLERS = {
  search_system({ query, limit = 8 }, s) {
    const hits = searchSystem(query, s, limit);
    return hits.length ? hits : `Nothing matches "${query}". get_rules with no topic lists every section and rule.`;
  },

  get_rules({ topic }, s) {
    if (!topic) {
      return [
        '# Sections',
        ...s.sections.filter((x) => x.level <= 3).map((x) => `- ${x.file}: ${'  '.repeat(x.level - 1)}${x.heading}`),
        '',
        '# Named rules',
        ...s.rules.map((r) => `- ${r.id} ${r.title} (${r.file})`),
      ].join('\n');
    }
    const rule = s.rules.find((r) => r.id.toLowerCase() === String(topic).toLowerCase());
    if (rule) return `**${rule.id} ${rule.title}.** ${rule.text}\n\n(${rule.file})`;
    const t = String(topic).toLowerCase();
    const hits = s.sections.filter((x) => x.heading.toLowerCase().includes(t));
    if (!hits.length) return `No section or rule "${topic}". Call get_rules with no topic for the list.`;
    return hits.map((x) => `## ${x.heading} (${x.file})\n\n${x.body}`).join('\n\n');
  },

  find_tokens({ hex }, s) {
    if (hex) {
      const n = nearestToken(hex, s.tokens);
      return n.distance === 0 ? `${hex} is var(${n.name}).` : `Nearest token to ${hex}: var(${n.name}) ${n.hex}, distance ${n.distance}${n.distance <= 24 ? ' (close enough that the review gate blocks the raw value)' : ' (no close token: if it needs to exist, add it to src/styles/tokens.css)'}.`;
    }
    return s.tokens.map((t) => `${t.name}: ${t.hex}`).join('\n');
  },

  get_component({ name }, s) {
    const c = s.components.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!c) {
      const near = relatives(String(name), s.components);
      return `No component or screen named ${name}.${near.length ? ` Nearest: ${near.join(', ')}.` : ''} If it is new, add it to src/data/system-registry.json when it lands.`;
    }
    return { ...c, nearest: relatives(c.name, s.components), note: c.registry ? (c.registry.documented ? undefined : 'Not documented yet (REG002).') : 'Not in the registry (REG001).' };
  },

  get_checklist({ size }, s) {
    const z = s.agents.sizes.find((x) => x.id === size);
    if (!z) return `Unknown size ${size}: sketch, playground or production.`;
    return [`# ${z.label}: ${z.who}`, `Fixed: ${z.fixed}`, `Loose: ${z.loose}`, '', ...z.checks.map((c) => `- [ ] ${c}`)].join('\n');
  },

  check_source({ code, file }, s) {
    if (file && isExempt(file, s.agents)) return `${file} is exempt from the source checks (see system-agents.json).`;
    const findings = withFix(checkSource(String(code), s.tokens));
    if (!findings.length) return 'Clean against the source, copy and safety rules. Judgment still applies: get_checklist for the rest.';
    return { file, findings, note: 'blocking: true means the review gate stops the change on it.' };
  },

  check_copy({ text }) {
    const findings = withFix(checkCopy(String(text)));
    if (!findings.length) return 'Nothing on the safety, vocabulary or brand lists. Phrasing is still judgment: observations, never instructions; hedge before-and-after verdicts (SAFE-4).';
    return { findings };
  },

  get_research({ query }, s) {
    if (!query) return s.research.map((r) => `- ${r.topic}: severity ${r.severity}`).join('\n');
    const q = String(query).toLowerCase().split(/\s+/);
    const hits = s.research
      .map((r) => ({ r, n: q.filter((w) => `${r.topic} ${r.unmet_need} ${r.implication}`.toLowerCase().includes(w)).length + 2 * q.filter((w) => r.topic.toLowerCase().includes(w)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map(({ r }) => ({ topic: r.topic, severity: r.severity, safety: r.safety, unmet_need: r.unmet_need, implication: r.implication.slice(0, 1200), sources: r.sources, uncertain_fields: r.uncertain, file: r.file }));
    return hits.length ? hits : `No research topic matches "${query}". get_research with no query lists them.`;
  },

  get_decisions(_, s) {
    return [
      s.decisions.report ? `# Open decisions (research report)\n\n${s.decisions.report.body}` : '',
      s.decisions.pending ? `# DECISIONS-PENDING.md\n\n${s.decisions.pending.slice(0, 6000)}` : '',
    ].filter(Boolean).join('\n\n') || 'No open decisions recorded.';
  },

  audit_drift({ code }, s) {
    const all = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = path.relative(s.root, full);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\./.test(name) && !isExempt(rel, s.agents)) {
          for (const f of checkSource(fs.readFileSync(full, 'utf8'), s.tokens)) all.push({ file: rel, ...f });
        }
      }
    };
    walk(path.join(s.root, 'src'));
    for (const c of s.components.filter((x) => x.kind === 'component' && x.registry && !x.registry.documented)) all.push({ file: c.dir, line: 0, code: 'REG002', rule: CODES.REG002, match: c.name });
    if (code) return all.filter((f) => f.code === code);
    const byFile = {};
    for (const f of all) byFile[f.file] = (byFile[f.file] || 0) + 1;
    return {
      total: all.length,
      byCode: summarize(all),
      worstFiles: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([file, count]) => ({ file, count })),
      note: 'Existing drift. The review gate only judges lines a change adds; pass a code to list every instance.',
    };
  },

  async review_change({ base = 'HEAD' }) {
    const { runReview, reviewReport } = await import('./review.mjs');
    return reviewReport(runReview({ base }));
  },
};

const INSTRUCTIONS = [
  'This is the system behind LoopStack (the local app for people who use open-source Loop) and LoopStack+ (the care-team workspace).',
  'Rules: DESIGN.md (visual and data-visual named rules) and PRODUCT.md (positioning, clinical safety, process). Clinical-safety rules are the reason the product can exist: observations, never instructions; nothing writes to the device.',
  'Before building: search_system, get_component on anything close, find_tokens for colours, get_rules "Data visuals" before any chart.',
  'Work comes in three sizes; get_checklist says how much to check at each.',
  'Before finishing a change: check_source on code, check_copy on copy, then review_change. get_research and get_decisions hold the evidence and the open questions.',
  `Finding codes are stable: ${Object.entries(CODES).map(([k, v]) => `${k} ${v}`).join('; ')}.`,
].join(' ');

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: params.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'loopstack-system', version: VERSION },
      instructions: INSTRUCTIONS,
    } });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    const s = loadSystem();
    return send({ jsonrpc: '2.0', id, result: { tools: s.agents.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: SCHEMAS[t.name],
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    })) } });
  }
  if (method === 'tools/call') {
    const handler = HANDLERS[params.name];
    if (!handler) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
    try {
      const s = loadSystem();
      const out = await handler(params.arguments || {}, s);
      const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(err && err.message ? err.message : err) }] } });
    }
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    handle(msg).catch((err) => msg.id !== undefined && send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err) } }));
  }
});
