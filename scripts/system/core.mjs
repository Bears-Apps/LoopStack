// loopstack-system core: the pure functions behind the MCP server
// (scripts/system/mcp.mjs) and the review gate (scripts/system/review.mjs).
// No I/O here except what the callers pass in, so both read the same answers.

/** Stable finding codes. Each maps to a named rule in DESIGN.md or PRODUCT.md. */
export const CODES = {
  SAFE001: 'Dosing instruction (SAFE-1: observations, never instructions)',
  SAFE002: 'Outcome claim that needs measured data on this path (SAFE-2)',
  SAFE003: 'Suggests the app changes the pump, pod or Loop outside the person’s own build (SAFE-3)',
  SAFE004: 'Causal overclaim about a change (SAFE-4)',
  SAFE005: 'AI-generated settings advice (SAFE-5)',
  DATA001: 'Bolus/basal ratio (DATA-1)',
  DATA002: 'Basal/bolus split in place of clinician terms (DATA-2)',
  BRAND001: 'Product name spelled wrong (BRAND-1)',
  BRAND002: 'Implied affiliation with LoopKit, Tidepool, Dexcom or Insulet (BRAND-2)',
  COL001: 'Raw colour outside the token file (COL-1)',
  COL004: 'Grey text too light to pass 4.5:1 (COL-4)',
  TYPE001: 'Font weight 700 or heavier (TYPE-1)',
  A11Y001: 'Image without alt (A11Y-1)',
  A11Y002: 'Click handler on a non-interactive element (A11Y-2)',
  A11Y003: 'Positive tabIndex (A11Y-3)',
  REG001: 'New component not in the registry',
  REG002: 'Production component not documented',
};

/** Raw colours within this RGB distance of a token are "a colour that has a token". */
const TOKEN_MATCH = 24;

/** What the review gate stops a change on: deterministic and unambiguous. Everything else is reported. */
export const blocksChange = (f) =>
  ['SAFE001', 'SAFE003', 'SAFE005', 'A11Y001', 'A11Y003'].includes(f.code) ||
  (f.code === 'COL001' && f.distance != null && f.distance <= TOKEN_MATCH);

// ---------------------------------------------------------------- copy

const COPY_RULES = [
  { code: 'SAFE001', re: /\btake\s+\d+(?:\.\d+)?\s*(?:u|units?)\b/i },
  { code: 'SAFE001', re: /\b(?:increase|raise|lower|decrease|reduce|bump|cut)\s+(?:your|the)\s+(?:basal|bolus|isf|insulin sensitivity|carb ratio|correction range|max basal|max bolus|dose)\b/i },
  { code: 'SAFE001', re: /\b(?:eat|have|take|drink)\s+\d+\s*(?:g|grams)\b/i },
  { code: 'SAFE001', re: /\byou (?:should|need to|must)\s+(?:bolus|pre-?bolus|dose|take|correct)\b/i },
  { code: 'SAFE001', re: /\ba (?:small|little|bigger|larger|extra) (?:pre-?bolus|bolus|correction)\b/i },
  { code: 'SAFE002', re: /\b(?:did better|tends to work|has matched|usually works|works best for you)\b/i },
  { code: 'SAFE003', re: /\b(?:apply|push|send|sync|write)(?:es|ed|ing|s)?\s+(?:it\s+|this\s+|these\s+|the\s+changes?\s+|changes\s+|settings\s+)?(?:to|into)\s+(?:your\s+)?(?:pump|pod|loop)\b(?!\s+(?:branch|fork|build|repo))/i },
  { code: 'SAFE003', re: /\bwe(?:'ll| will)\s+(?:update|change|adjust|set)\s+your\s+(?:settings|pump|basal|loop|pod)\b/i },
  { code: 'SAFE004', re: /\b(?:the|this|that) (?:change|new (?:ratio|setting|basal|isf))\s+(?:fixed|caused|solved|eliminated|cured)\b/i },
  { code: 'SAFE004', re: /\bbecause of the (?:change|new setting)\b/i },
  { code: 'SAFE005', re: /\b(?:ai|claude|chatgpt|the model)\s+(?:suggests|recommends|sets|picked|chose)\s+(?:a\s+|your\s+|new\s+)?(?:basal|isf|carb ratio|settings|max basal|max bolus|max iob)\b/i },
  { code: 'DATA001', re: /\b(?:bolus\s*[/:-]\s*basal|basal\s*[/:-]\s*bolus)\s+ratio\b/i },
  { code: 'DATA002', re: /\b(?:basal\s*\/\s*bolus|bolus\s*\/\s*basal)\s+split\b/i },
  { code: 'BRAND001', re: /\b(?:Loopstack|Loop Stack|LOOPSTACK|LoopStack ?\+)(?![\w-])/ },
  { code: 'BRAND002', re: /\b(?:official\s+(?:loop|loopkit|dexcom|tidepool|insulet|omnipod)|by loopkit|endorsed by (?:loopkit|dexcom|tidepool|insulet)|(?:loopkit|dexcom|tidepool|insulet)[’']s official)\b/i },
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Safety rules describe what the app must not say; a sentence saying it never does that is the rule followed. */
const NEGATABLE = new Set(['SAFE001', 'SAFE003', 'SAFE005']);
const NEGATED = /\b(?:never|not|no|cannot|can't|won't|doesn't|don't|isn't|without|nothing)\b[^.!?\n]{0,24}$/i;

function scan(text, rules) {
  const out = [];
  for (const { code, re } of rules) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) {
      if (NEGATABLE.has(code) && NEGATED.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      out.push({ code, line: lineOf(text, m.index), match: m[0], rule: CODES[code] });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Copy rules over plain text, markdown or TSX. */
export const checkCopy = (text) => scan(String(text), COPY_RULES);

// ---------------------------------------------------------------- source

/** Blank out comments, keeping line numbers, so quoted counter-examples in comments don't fire. */
export function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

export const rgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** Colour tokens from tokens.css: [{ name, hex }]. */
export function parseTokens(css) {
  const out = [];
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/g)) out.push({ name: m[1], hex: m[2].toUpperCase() });
  return out;
}

export function nearestToken(hex, tokens) {
  const [r, g, b] = rgb(hex);
  let best = null;
  for (const t of tokens) {
    const [r2, g2, b2] = rgb(t.hex);
    const d = Math.round(Math.hypot(r - r2, g - g2, b - b2));
    if (!best || d < best.distance) best = { ...t, distance: d };
  }
  return best;
}

const SOURCE_RULES = [
  { code: 'TYPE001', re: /font-weight\s*:\s*(?:[7-9]00|bold(?:er)?)\b|fontWeight\s*[:=]\s*\{?\s*['"]?(?:[7-9]00|bold)\b/ },
  { code: 'COL004', re: /(?:^|[\s;{])color\s*:\s*var\(--ink-(?:300|400)\)/m },
  { code: 'A11Y001', re: /<img\b(?![^>]*\balt\s*=)[^>]*>/ },
  { code: 'A11Y002', re: /<(?:div|span|li|p)\b[^>]*\bonClick\s*=/ },
  { code: 'A11Y003', re: /tabIndex\s*=\s*\{?\s*["']?[1-9]\d*/ },
];

/** Check TSX, TS or CSS. tokens: from parseTokens. */
export function checkSource(code, tokens = []) {
  const clean = stripComments(String(code));
  const findings = scan(clean, SOURCE_RULES);
  for (const m of clean.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![\w-])/g)) {
    // Skip things like "#/route" or "#id" anchors: a colour is all hex digits, already enforced.
    const near = tokens.length ? nearestToken(m[0], tokens) : null;
    findings.push({
      code: 'COL001',
      line: lineOf(clean, m.index),
      match: m[0],
      rule: CODES.COL001,
      distance: near ? near.distance : null,
      fix: near ? (near.distance === 0 ? `use var(${near.name})` : `nearest token var(${near.name}) ${near.hex}, distance ${near.distance}`) : undefined,
    });
  }
  findings.push(...checkCopy(clean));
  return findings.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------- rules and search

/** Split markdown into heading sections. */
export function splitSections(markdown, file) {
  const out = [];
  let cur = null;
  for (const line of markdown.split('\n')) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      if (cur) out.push(cur);
      cur = { file, level: h[1].length, heading: h[2].trim(), body: '' };
    } else if (cur) cur.body += `${line}\n`;
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, body: s.body.trim() }));
}

/** Named rules: "- **ID Title.** text" lines. */
export function namedRules(markdown, file) {
  const out = [];
  const lines = markdown.split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*-\s+\*\*([A-Z0-9]+-[A-Z]?\d+)\s+([^*]+?)\*\*\s*(.*)$/.exec(line);
    if (!m) return;
    let text = m[3];
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]); j += 1) text += ` ${lines[j].trim()}`;
    out.push({ id: m[1], title: m[2].replace(/\.$/, ''), text: text.trim(), file });
  });
  return out;
}

const words = (s) => String(s).toLowerCase().split(/[^a-z0-9+#-]+/).filter(Boolean);

function score(query, ...fields) {
  const q = words(query);
  const hay = fields.join(' ').toLowerCase();
  let s = 0;
  for (const w of q) if (hay.includes(w)) s += 1;
  return s / Math.max(1, q.length);
}

export function searchSystem(query, { sections, rules, tokens, components, research }, limit = 8) {
  const hits = [];
  for (const r of rules) hits.push({ kind: 'rule', score: score(query, r.id, r.title, r.text) + 0.2, title: `${r.id} ${r.title}`, detail: r.text, where: r.file });
  for (const s of sections) hits.push({ kind: 'section', score: score(query, s.heading, s.body) , title: s.heading, detail: s.body.slice(0, 240), where: s.file });
  for (const t of tokens) hits.push({ kind: 'token', score: score(query, t.name, t.hex), title: t.name, detail: t.hex, where: 'src/styles/tokens.css' });
  for (const c of components) hits.push({ kind: 'component', score: score(query, c.name, c.dir), title: c.name, detail: c.registry ? `${c.registry.size}${c.registry.documented ? ` · documented: ${c.registry.documented}` : ' · not documented'}` : 'not in the registry', where: c.dir });
  for (const r of research) hits.push({ kind: 'research', score: score(query, r.topic, r.unmet_need, r.implication) * 0.9, title: r.topic, detail: `Severity ${r.severity}. ${r.unmet_need.slice(0, 200)}`, where: r.file });
  return hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _s, ...h }) => h);
}

/** The nearest components by shared name words. */
export function relatives(name, components, limit = 3) {
  const w = words(name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  return components
    .filter((c) => c.name !== name)
    .map((c) => ({ c, s: words(c.name.replace(/([a-z])([A-Z])/g, '$1 $2')).filter((x) => w.includes(x)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c.name);
}

/** Group findings for a report. */
export function summarize(findings) {
  const byCode = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
  return Object.entries(byCode).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count, rule: CODES[code] }));
}
