import { sectionsByTab, type AgpChart, type ClinicReport, type HeatRow, type HourBar, type ReportSection } from './clinicReport';
import { agpPlot, svgPath } from './agpChart';

// Self-contained HTML dashboard for the clinic report.
//
// The same sections as the screen and the PDF, laid out as the clinician
// patient view endocrinologists already read in Glooko: a patient band with
// the key context, underlined tabs, and a grid of cards (short cards pair up,
// charts and wide tables take the full row). Method notes fold away. No network requests, no external fonts or scripts, so it works
// offline, from an email attachment, or from any private static host — and it
// leaks nothing to a third party when opened. Printing shows every tab.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function hoursHtml(bars: HourBar[]): string {
  const cols = bars
    .map((b) => {
      if (!b.readings) return `<div class="hb empty" title="${esc(b.label)}: no readings"></div>`;
      const title = `${b.label}: ${Math.round(b.inRangePct)}% in range, ${Math.round(b.lowPct)}% low, ${Math.round(b.highPct)}% high${b.avgMgdl != null ? `, mean ${Math.round(b.avgMgdl)}` : ''}`;
      return `<div class="hb" title="${esc(title)}" aria-label="${esc(title)}"><span class="hi" style="height:${b.highPct}%"></span><span class="in" style="height:${b.inRangePct}%"></span><span class="lo" style="height:${b.lowPct}%"></span></div>`;
    })
    .join('');
  const ticks = bars.map((b, i) => `<span>${i % 3 === 0 ? esc(b.label.slice(0, 2)) : ''}</span>`).join('');
  return `<div class="hours" role="img" aria-label="Glucose by hour of day">${cols}</div><div class="ticks">${ticks}</div>
<p class="legend"><i class="lo"></i>Low <i class="in"></i>In range <i class="hi"></i>High</p>`;
}

function agpHtml(chart: AgpChart): string {
  const W = 640;
  const H = 240;
  const p = agpPlot(chart, { width: W - 40, height: H - 24, left: 34, top: 6 });
  const grid = p.yTicks
    .map((t) => `<line x1="${p.left}" x2="${p.left + p.width}" y1="${t.y}" y2="${t.y}" class="ag"/><text x="${p.left - 5}" y="${t.y + 3.5}" text-anchor="end">${t.label}</text>`)
    .join('');
  const xs = p.xTicks
    .map((t, i) => `<text x="${t.x}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === p.xTicks.length - 1 ? 'end' : 'middle'}">${t.label}</text>`)
    .join('');
  const label = `Glucose percentiles by time of day, with the range ${chart.lowMgdl}–${chart.highMgdl} mg/dL marked`;
  return `<svg class="agp" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${xs}${p.outer
    .map((pts) => `<path class="ao" d="${svgPath(pts, true)}"/>`)
    .join('')}${p.inner.map((pts) => `<path class="ai2" d="${svgPath(pts, true)}"/>`).join('')}<line class="at" x1="${p.left}" x2="${p.left + p.width}" y1="${p.lowY}" y2="${p.lowY}"/><line class="at" x1="${p.left}" x2="${p.left + p.width}" y1="${p.highY}" y2="${p.highY}"/>${p.median
    .map((pts) => `<path class="am" d="${svgPath(pts, false)}"/>`)
    .join('')}</svg>
<p class="legend"><i class="km"></i>Median <i class="ki"></i>25th–75th <i class="ko"></i>5th–95th <i class="kt"></i>Range ${chart.lowMgdl}–${chart.highMgdl} mg/dL</p>`;
}

function heatHtml(rows: HeatRow[]): string {
  const head = `<tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</th>`).join('')}</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}</th>${r.cells
          .map((c, h) => {
            if (!c) return `<td class="na" title="${esc(`${r.label} ${h}:00 — not enough weeks`)}"></td>`;
            const cls = c.lowPct >= 10 ? 'lo' : c.highPct > c.inRangePct ? 'hi' : 'in';
            const title = `${r.label} ${String(h).padStart(2, '0')}:00 — median ${c.medianMgdl ?? '—'} mg/dL, ${Math.round(c.inRangePct)}% in range, ${Math.round(c.lowPct)}% low, ${Math.round(c.highPct)}% high`;
            return `<td class="${cls}" title="${esc(title)}">${c.medianMgdl == null ? '' : Math.round(c.medianMgdl)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<div class="scroll"><table class="heat">${head}${body}</table></div>
<p class="legend"><i class="lo"></i>Low share ≥10% <i class="in"></i>Mostly in range <i class="hi"></i>Mostly high <i class="na"></i>Not enough weeks</p>`;
}

/** AGP-report style: one tall stacked column, every band named with its range, % and goal. */
function tirColumnHtml(t: NonNullable<ReportSection['tir']>, consensus: boolean): string {
  const b = t.bands;
  const bands = [
    ['vhi', 'Very high', '>250', b.veryHigh, consensus ? '<5%' : ''],
    ['hi', 'High', `${t.highMgdl + 1}–250`, b.high, consensus ? '<25%' : ''],
    ['in', 'Target range', `${t.lowMgdl}–${t.highMgdl}`, b.inRange, consensus ? '>70%' : ''],
    ['lo', 'Low', `${t.urgentLowMgdl}–${t.lowMgdl - 1}`, b.low, consensus ? '<4%' : ''],
    ['vlo', 'Very low', `<${t.urgentLowMgdl}`, b.veryLow, consensus ? '<1%' : ''],
  ] as const;
  const col = bands.map(([c, , , v]) => `<span class="${c}" style="flex-grow:${Math.max(v, 0.6)}"></span>`).join('');
  const rows = bands
    .map(([c, name, range, v, goal]) => `<li><i class="${c}"></i><span><b>${esc(name)}</b> <small>${esc(range)} mg/dL</small></span><strong>${Math.round(v * 10) / 10}%</strong><small class="goal">${goal ? `Goal ${esc(goal)}` : ''}</small></li>`)
    .join('');
  return `<div class="tircol"><div class="col" role="img" aria-label="Time in ranges">${col}</div><ul>${rows}</ul></div>`;
}

const tableHtml = (t: { caption?: string; columns: string[]; rows: string[][] }) =>
  `<div class="scroll"><table>${t.caption ? `<caption>${esc(t.caption)}</caption>` : ''}<thead><tr>${t.columns
    .map((c) => `<th scope="col">${esc(c)}</th>`)
    .join('')}</tr></thead><tbody>${t.rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

/** Charts and wide tables take the full row; short cards pair up, as on a clinic dashboard. */
function isWide(s: ReportSection): boolean {
  return Boolean(s.agp || s.hours?.length || s.heatmap?.length || s.aiGenerated || (s.tables ?? []).some((t) => t.columns.length >= 4) || s.id === 'act');
}

function cardHtml(s: ReportSection, consensus: boolean): string {
  const parts: string[] = [];
  if (s.aiGenerated) parts.push('<p class="ai">AI-generated · not clinician-reviewed</p>');
  if (s.unavailable) parts.push(`<p class="muted">${esc(s.unavailable)}</p>`);
  if (s.summary) parts.push(`<p class="lead">${esc(s.summary)}</p>`);
  if (s.tir) parts.push(tirColumnHtml(s.tir, consensus));
  if (s.agp) parts.push(agpHtml(s.agp));
  if (s.hours?.length) parts.push(hoursHtml(s.hours));
  if (s.heatmap?.length) parts.push(heatHtml(s.heatmap));
  if (s.facts?.length) {
    parts.push(
      `<dl class="facts">${s.facts
        .map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.target ? `<small>Goal ${esc(f.target)}</small>` : ''}</dd></div>`)
        .join('')}</dl>`,
    );
  }
  for (const t of s.tables ?? []) parts.push(tableHtml(t));
  if (s.bullets?.length) parts.push(`<ul class="bullets">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  if (s.notes?.length) parts.push(`<details class="more"><summary>Notes &amp; method</summary><ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>`);
  return `<article class="card${isWide(s) ? ' wide' : ''}${s.aiGenerated ? ' aicard' : ''}" id="s-${esc(s.id)}"><header><h2>${esc(s.title)}</h2>${
    s.window ? `<p>${esc(s.window)}</p>` : ''
  }</header><div class="body">${parts.join('')}</div></article>`;
}

const CSS = `
:root{--ink:#14202b;--ink7:#3c4a57;--ink5:#6b7885;--rule:#dfe4ea;--s0:#fff;--s1:#f3f5f8;--s2:#e8ecf1;--accent:#1f6fb2;--accent-ink:#17568c;--brand:#1f7a2e;
--info:#3e6fa8;--info-ink:#2b527d;--vlo:#a8231a;--lo:#e8483f;--in:#4caf50;--hi:#f2b01e;--vhi:#e5741b;--lo-s:#fdd0d0;--in-s:#d3edd4;--hi-s:#fbe7b5}
@media (prefers-color-scheme:dark){:root{--ink:#e9eef3;--ink7:#c0cad3;--ink5:#93a0ac;--rule:#2b3540;--s0:#141b22;--s1:#0e141a;--s2:#222c36;--accent:#6aa9e0;--accent-ink:#9cc7ef;
--info:#7fa6d6;--info-ink:#b4cff0;--lo-s:#5a2626;--in-s:#24452a;--hi-s:#4d3e14}}
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/21px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--s1)}
.topbar{background:var(--s0);border-bottom:1px solid var(--rule)}
.topbar .in-w,.patient .in-w,.tabs-w,main{max-width:1200px;margin:0 auto;padding-left:16px;padding-right:16px}
.topbar .in-w{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px}
.brandmark{font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--brand)}.brandmark span{color:var(--ink5);font-weight:600;letter-spacing:.02em;text-transform:none;margin-left:8px}
.btn{min-height:36px;padding:0 14px;border:1px solid var(--rule);border-radius:8px;background:var(--s0);color:var(--accent-ink);font:600 13px/1 inherit;cursor:pointer}
.patient{background:var(--s0);border-bottom:1px solid var(--rule)}
.patient .in-w{padding-top:16px;padding-bottom:14px;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
.patient h1{font-size:22px;line-height:28px;font-weight:700}
.patient .sub{color:var(--ink7);font-size:13px;margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;flex-direction:column;padding:6px 12px;border:1px solid var(--rule);border-radius:10px;background:var(--s1);min-width:110px}
.chip small{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink5);font-weight:600}.chip b{font-size:14px;font-variant-numeric:tabular-nums}
.sample{max-width:1200px;margin:12px auto 0;padding:0 16px}.sample p{background:#fdeceA;color:#962819;border-radius:10px;padding:10px 14px;font-weight:600;font-size:13px}
@media (prefers-color-scheme:dark){.sample p{background:#4a1d18;color:#ffc9c0}}
.tabsbar{background:var(--s0);border-bottom:1px solid var(--rule);position:sticky;top:0;z-index:2}
.tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:0 0 auto;min-height:46px;padding:0 14px;border:0;border-bottom:3px solid transparent;background:none;color:var(--ink5);font:600 14px/1 inherit;cursor:pointer;white-space:nowrap}
.tabs button[aria-selected=true]{color:var(--accent-ink);border-bottom-color:var(--accent)}
.tabs button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
main{padding-top:16px;padding-bottom:40px}
.panel{display:none;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-flow:row dense;gap:14px;align-items:start}.panel.on{display:grid}
@media (max-width:860px){.panel{grid-template-columns:minmax(0,1fr)}}
.card{background:var(--s0);border:1px solid var(--rule);border-radius:12px;box-shadow:0 1px 2px rgba(20,32,43,.04);min-width:0}
.card.wide{grid-column:1/-1}.aicard{border-style:dashed}
.card>header{padding:14px 16px 10px;border-bottom:1px solid var(--rule)}
.card h2{font-size:15px;line-height:20px;font-weight:700}.card>header p{color:var(--ink5);font-size:12px;line-height:17px;margin-top:2px}
.body{display:flex;flex-direction:column;gap:12px;padding:14px 16px 16px;font-size:13px;line-height:19px}
.lead{font-size:14px;line-height:21px}.muted{color:var(--ink7)}
.ai{align-self:flex-start;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--ink5);border-radius:999px;padding:1px 8px}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));column-gap:24px}
.facts div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--rule)}
.facts dt{color:var(--ink7)}.facts dd{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.facts small{display:block;font-weight:400;color:var(--ink5);font-size:11px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:12.5px}
caption{text-align:left;font-weight:700;color:var(--ink7);padding-bottom:6px}
th,td{padding:7px 12px 7px 0;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
thead th{color:var(--ink5);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;background:var(--s1);padding-left:8px}
thead th:first-child{padding-left:8px}tbody th{font-weight:600;min-width:112px;padding-left:8px}
tbody tr:hover{background:var(--s1)}
.bullets,.notes{padding-left:20px}.bullets li+li,.notes li+li{margin-top:6px}.notes{color:var(--ink5);font-size:12px;margin-top:8px}
.more>summary{cursor:pointer;color:var(--accent-ink);font-size:12px;font-weight:600;min-height:28px;display:inline-flex;align-items:center}
.tircol{display:flex;gap:18px;align-items:stretch}
.tircol .col{display:flex;flex-direction:column;width:44px;min-height:220px;border-radius:6px;overflow:hidden;flex:none}
.tircol ul{list-style:none;display:flex;flex-direction:column;justify-content:space-between;flex:1;gap:6px}
.tircol li{display:grid;grid-template-columns:12px minmax(0,1fr) auto;column-gap:8px;align-items:baseline}
.tircol li strong{font-size:18px;font-variant-numeric:tabular-nums}.tircol li small{color:var(--ink5)}
.tircol li .goal{grid-column:2/4;font-size:11px}
i{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin:0 4px 0 10px}.tircol i{margin:0}
.vlo{background:var(--vlo)}.lo{background:var(--lo)}.in{background:var(--in)}.hi{background:var(--hi)}.vhi{background:var(--vhi)}i.na{background:var(--s2)}
.hours{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;height:140px}
.hb{display:flex;flex-direction:column;justify-content:flex-end;background:var(--s2);border-radius:3px;overflow:hidden}
.hb.empty{opacity:.5}.hb span{display:block}
.ticks{display:grid;grid-template-columns:repeat(24,1fr);font-size:10px;color:var(--ink5)}
.legend{font-size:12px;color:var(--ink7)}
.heat{border-collapse:separate;border-spacing:2px;font-size:10px;min-width:640px}
.heat th{border:0;padding:0 4px 0 0;color:var(--ink5);font-weight:600;font-size:10px;text-align:center;background:none;text-transform:none;letter-spacing:0}
.heat tbody th{text-align:left;min-width:0}.heat tr:hover{background:none}
.heat td{border:0;padding:0;height:24px;text-align:center;border-radius:3px;color:var(--ink)}
.heat td.lo{background:var(--lo-s)}.heat td.in{background:var(--in-s)}.heat td.hi{background:var(--hi-s)}.heat td.na{background:var(--s2)}
.agp{width:100%;height:auto;display:block;max-height:340px}.agp text{fill:var(--ink5);font-size:10px}.agp .ag{stroke:var(--rule);stroke-width:.6}
.agp .ao{fill:var(--info);fill-opacity:.16}.agp .ai2{fill:var(--info);fill-opacity:.42}.agp .am{fill:none;stroke:var(--info-ink);stroke-width:2;stroke-linejoin:round}
.agp .at{stroke:var(--in);stroke-width:1.25;stroke-dasharray:4 3}
i.km{background:var(--info-ink)}i.ki{background:var(--info);opacity:.6}i.ko{background:var(--info);opacity:.25}i.kt{background:var(--in)}
footer{max-width:1200px;margin:0 auto;padding:0 16px 32px;color:var(--ink5);font-size:12px;line-height:18px}
@media print{body{background:#fff}.tabsbar,.btn{display:none}.panel{display:grid!important;break-before:page}.panel:first-of-type{break-before:auto}
.panel::before{content:attr(data-label);grid-column:1/-1;font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--brand)}
.card{break-inside:avoid-page;box-shadow:none}details>summary{list-style:none}}
`;

// Tabs with keyboard support; method notes open for print so nothing is hidden on paper.
const JS = `
const tabs=[...document.querySelectorAll('[role=tab]')];
function pick(t){tabs.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;document.getElementById(x.getAttribute('aria-controls')).classList.toggle('on',on)})}
tabs.forEach((t,i)=>{t.onclick=()=>pick(t);t.onkeydown=e=>{const d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(d){const n=tabs[(i+d+tabs.length)%tabs.length];pick(n);n.focus()}}});
document.getElementById('print').onclick=()=>print();
addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>{d.dataset.was=d.open;d.open=true}));
addEventListener('afterprint',()=>document.querySelectorAll('details').forEach(d=>{d.open=d.dataset.was==='true'}));
`;

export function renderClinicReportHtml(report: ClinicReport): string {
  const groups = sectionsByTab(report);
  const t = report.thresholds;
  const consensus = !!t && t.lowMgdl === 70 && t.highMgdl === 180 && t.urgentLowMgdl === 54;
  const chips = [
    ['Period', `${fmtDate(report.period.startIso)} – ${fmtDate(report.period.endIso)}`],
    ['Days with CGM', report.period.daysCovered != null ? `${report.period.daysCovered} of ${report.period.days}` : '—'],
    ['Target range', t ? `${t.lowMgdl}–${t.highMgdl} mg/dL` : '—'],
    ['Source', report.sourceLabel],
    ['Report', report.mode === 'brief' ? 'Brief' : 'Full settings'],
  ];
  const tabs = groups
    .map((g, i) => `<button role="tab" id="t-${g.tab.id}" aria-controls="p-${g.tab.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(g.tab.label)}</button>`)
    .join('');
  const panels = groups
    .map(
      (g, i) =>
        `<section class="panel${i === 0 ? ' on' : ''}" role="tabpanel" id="p-${g.tab.id}" aria-labelledby="t-${g.tab.id}" data-label="${esc(g.tab.label)}">${g.sections
          .map((s) => cardHtml(s, consensus))
          .join('')}</section>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(report.title)}${report.patientName ? ` — ${esc(report.patientName)}` : ''}</title>
<style>${CSS}</style></head>
<body>
<div class="topbar"><div class="in-w"><p class="brandmark">LOOPSTACK<span>Clinician view</span></p><button class="btn" id="print" type="button">Print / Save as PDF</button></div></div>
<div class="patient"><div class="in-w"><div><h1>${esc(report.patientName || 'Patient')}</h1><p class="sub">${esc(report.title)} · generated ${esc(new Date(report.generatedIso).toLocaleString())} · ${esc(report.timeZone)}</p></div>
<div class="chips">${chips.map(([k, v]) => `<span class="chip"><small>${esc(k)}</small><b>${esc(v)}</b></span>`).join('')}</div></div></div>
${report.sample ? '<div class="sample"><p>SAMPLE DATA — this report includes demonstration values and does not describe the patient.</p></div>' : ''}
<div class="tabsbar"><nav class="tabs tabs-w" role="tablist" aria-label="Report sections">${tabs}</nav></div>
<main>${panels}</main>
<footer><p>${esc(report.disclaimer)}</p></footer>
<script>${JS}</script></body></html>`;
}

export function dashboardFileName(report: ClinicReport): string {
  return `LoopStack-${report.mode}-dashboard-${report.generatedIso.slice(0, 10)}.html`;
}
