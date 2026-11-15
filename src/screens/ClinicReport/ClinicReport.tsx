import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Button } from '@/components/Button/Button';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { useDataSourceContext } from '@/data/sources/DataSourceContext';
import { activeLoopTherapy } from '@/data/loopTherapySchedules';
import { claudeModelLabel, claudeReady, loadClaudeConfig } from '@/data/claudeConfig';
import {
  buildClinicReport,
  REPORT_RANGES,
  reportForClaude,
  sectionsByTab,
  type HeatRow,
  type HourBar,
  type ReportTab,
  type ClaudeFeedback,
  type ReportMode,
  type ReportRange,
  type ReportSection,
  type AgpChart,
} from '@/lib/report/clinicReport';
import { agpPlot, svgPath } from '@/lib/report/agpChart';
import styles from './ClinicReport.module.css';

// Clinic report: a doctor-friendly export of observed patterns and the Loop
// settings on file, in two modes. Brief is the appointment read; Full is the
// complete settings overview. Every section is a dropdown here and a page
// section in the PDF, both rendered from the same buildClinicReport output.

const SOURCE_LABEL: Record<string, string> = {
  mock: 'Sample data (demo)',
  healthkit: 'Apple Health',
  nightscout: 'Nightscout',
  combined: 'Apple Health + Nightscout',
};

const MODES: { id: ReportMode; label: string; hint: string }[] = [
  { id: 'brief', label: 'Brief', hint: 'One to two pages for the appointment' },
  { id: 'full', label: 'Full settings overview', hint: 'Every schedule and analysis' },
];

type ClaudeState =
  | { status: 'idle' }
  | { status: 'preview' }
  | { status: 'sending' }
  | { status: 'error'; message: string };

// Compact five-band bar for a report section. Every band is named with its
// boundaries and percentage beside the colour, as in the PDF.
function TirBar({ tir }: { tir: NonNullable<ReportSection['tir']> }) {
  const b = tir.bands;
  const bands = [
    { key: 'vl', label: 'Very low', range: `<${tir.urgentLowMgdl}`, value: b.veryLow, cls: styles.bandVeryLow },
    { key: 'l', label: 'Low', range: `${tir.urgentLowMgdl}–${tir.lowMgdl - 1}`, value: b.low, cls: styles.bandLow },
    { key: 'in', label: 'In range', range: `${tir.lowMgdl}–${tir.highMgdl}`, value: b.inRange, cls: styles.bandIn },
    { key: 'h', label: 'High', range: `${tir.highMgdl + 1}–250`, value: b.high, cls: styles.bandHigh },
    { key: 'vh', label: 'Very high', range: '>250', value: b.veryHigh, cls: styles.bandVeryHigh },
  ];
  return (
    <div className={styles.tir}>
      <div className={styles.tirBar} aria-hidden>
        {bands.map((x) => <span key={x.key} className={x.cls} style={{ flexGrow: x.value }} />)}
      </div>
      <ul className={styles.tirLegend}>
        {bands.map((x) => (
          <li key={x.key}>
            <span className={`${styles.swatch} ${x.cls}`} aria-hidden />
            <span>{x.label} <span className={styles.tirRange}>{x.range}</span></span>
            <strong>{Math.round(x.value * 10) / 10}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HourBars({ bars }: { bars: HourBar[] }) {
  return (
    <div className={styles.hoursWrap}>
      <div className={styles.hours} role="img" aria-label="Share of readings low, in range and high for each hour of the day">
        {bars.map((b) => (
          <div key={b.label} className={`${styles.hourCol} ${b.readings ? '' : styles.hourEmpty}`} title={`${b.label}: ${Math.round(b.inRangePct)}% in range, ${Math.round(b.lowPct)}% low, ${Math.round(b.highPct)}% high`}>
            <span className={styles.bandHigh} style={{ height: `${b.highPct}%` }} />
            <span className={styles.bandIn} style={{ height: `${b.inRangePct}%` }} />
            <span className={styles.bandLow} style={{ height: `${b.lowPct}%` }} />
          </div>
        ))}
      </div>
      <div className={styles.hourTicks} aria-hidden>
        {bars.map((b, i) => <span key={b.label}>{i % 3 === 0 ? b.label.slice(0, 2) : ''}</span>)}
      </div>
      <p className={styles.legendLine}><span className={`${styles.swatch} ${styles.bandLow}`} /> Low <span className={`${styles.swatch} ${styles.bandIn}`} /> In range <span className={`${styles.swatch} ${styles.bandHigh}`} /> High</p>
    </div>
  );
}

// AGP percentile curve. The figures behind it are in the section's summary
// and (Full) its table, so the chart is never the only carrier.
function AgpFigure({ chart }: { chart: AgpChart }) {
  const W = 340;
  const H = 180;
  const p = agpPlot(chart, { width: W - 34, height: H - 22, left: 30, top: 4 });
  return (
    <div className={styles.agpWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.agp} role="img" aria-label={`Glucose percentiles by time of day, with the range ${chart.lowMgdl}–${chart.highMgdl} mg/dL marked`}>
        {p.yTicks.map((t) => (
          <g key={t.label}>
            <line x1={p.left} x2={p.left + p.width} y1={t.y} y2={t.y} className={styles.agpGrid} />
            <text x={p.left - 4} y={t.y + 3} textAnchor="end" className={styles.agpTick}>{t.label}</text>
          </g>
        ))}
        {p.xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 4} textAnchor={i === 0 ? 'start' : i === p.xTicks.length - 1 ? 'end' : 'middle'} className={styles.agpTick}>{t.label}</text>
        ))}
        {p.outer.map((pts, i) => <path key={`o${i}`} d={svgPath(pts, true)} className={styles.agpOuter} />)}
        {p.inner.map((pts, i) => <path key={`i${i}`} d={svgPath(pts, true)} className={styles.agpInner} />)}
        <line x1={p.left} x2={p.left + p.width} y1={p.lowY} y2={p.lowY} className={styles.agpTarget} />
        <line x1={p.left} x2={p.left + p.width} y1={p.highY} y2={p.highY} className={styles.agpTarget} />
        {p.median.map((pts, i) => <path key={`m${i}`} d={svgPath(pts, false)} className={styles.agpMedian} />)}
      </svg>
      <p className={styles.legendLine}>
        {[
          [styles.agpKeyMedian, 'Median'],
          [styles.agpKeyInner, '25th–75th'],
          [styles.agpKeyOuter, '5th–95th'],
          [styles.agpKeyTarget, `Range ${chart.lowMgdl}–${chart.highMgdl}`],
        ].map(([cls, label]) => (
          <span key={label} className={styles.legendItem}><span className={`${styles.swatch} ${cls}`} /> {label}</span>
        ))}
      </p>
    </div>
  );
}

// Weekday × hour grid, the app's day report in one view. Cells carry their
// median mg/dL so colour never carries the reading alone.
function Heatmap({ rows }: { rows: HeatRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.heat}>
        <thead>
          <tr><th aria-label="Weekday" />{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {r.cells.map((c, h) => {
                const cls = !c ? styles.heatNa : c.lowPct >= 10 ? styles.heatLow : c.highPct > c.inRangePct ? styles.heatHigh : styles.heatIn;
                const label = c ? `${r.label} ${String(h).padStart(2, '0')}:00, median ${c.medianMgdl ?? 'unknown'}, ${Math.round(c.lowPct)}% low, ${Math.round(c.highPct)}% high` : `${r.label} ${h}:00, not enough weeks`;
                return <td key={h} className={cls} title={label} aria-label={label}>{c?.medianMgdl != null ? Math.round(c.medianMgdl) : ''}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.legendLine}><span className={`${styles.swatch} ${styles.heatLow}`} /> Low share ≥10% <span className={`${styles.swatch} ${styles.heatIn}`} /> Mostly in range <span className={`${styles.swatch} ${styles.heatHigh}`} /> Mostly high <span className={`${styles.swatch} ${styles.heatNa}`} /> Not enough weeks</p>
    </div>
  );
}

function SectionBody({ s }: { s: ReportSection }) {
  if (s.unavailable) return <p className={styles.muted}>{s.unavailable}</p>;
  return (
    <div className={styles.body}>
      {s.aiGenerated ? <p className={styles.aiTag}>AI-generated · not clinician-reviewed</p> : null}
      {s.summary ? <p>{s.summary}</p> : null}
      {s.tir ? <TirBar tir={s.tir} /> : null}
      {s.agp ? <AgpFigure chart={s.agp} /> : null}
      {s.hours?.length ? <HourBars bars={s.hours} /> : null}
      {s.heatmap?.length ? <Heatmap rows={s.heatmap} /> : null}
      {s.facts?.length ? (
        <dl className={styles.facts}>
          {s.facts.map((f) => (
            <div key={f.label} className={styles.fact}>
              <dt>{f.label}</dt>
              <dd>
                {f.value}
                {f.target ? <span className={styles.target}>Target {f.target}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.tables?.map((t, i) => (
        <div key={`${t.caption ?? 'table'}:${i}`} className={styles.tableWrap}>
          {/* Four or more columns scroll inside the card rather than crush to one word per line. */}
          <table className={`${styles.table} ${t.columns.length >= 4 ? styles.tableWide : ''}`}>
            {t.caption ? <caption>{t.caption}</caption> : null}
            <thead>
              <tr>{t.columns.map((c, j) => <th key={j} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {t.rows.map((r, j) => (
                <tr key={j}>{r.map((cell, k) => (k === 0 ? <th key={k} scope="row">{cell}</th> : <td key={k}>{cell}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {s.bullets?.length ? <ul className={styles.bullets}>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul> : null}
      {s.notes?.length ? <ul className={styles.notes}>{s.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </div>
  );
}

export function ClinicReport() {
  const { source, activeKind } = useDataSourceContext();
  const snapshot = useSyncExternalStore((cb) => source.subscribe(cb), () => source.getSnapshot());
  const [mode, setMode] = useState<ReportMode>('brief');
  const [range, setRange] = useState<ReportRange>('30d');
  const [patientName, setPatientName] = useState('');
  const [feedback, setFeedback] = useState<ClaudeFeedback | null>(null);
  const [includeFeedback, setIncludeFeedback] = useState(true);
  const [claude, setClaude] = useState<ClaudeState>({ status: 'idle' });
  const [exportStatus, setExportStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<ReportTab>('summary');
  const abort = useRef<AbortController | null>(null);
  const claudeConfig = useMemo(loadClaudeConfig, []);

  // Notes describe the data they read; a different period or source is
  // different data, so they do not carry over.
  useEffect(() => {
    abort.current?.abort();
    setFeedback(null);
    setClaude({ status: 'idle' });
  }, [range, source]);

  const report = useMemo(
    () =>
      buildClinicReport({
        snapshot,
        therapy: activeLoopTherapy(),
        mode,
        range,
        sourceLabel: SOURCE_LABEL[activeKind] ?? activeKind,
        patientName,
        feedback: includeFeedback ? feedback : null,
        now: new Date(),
      }),
    [snapshot, mode, range, activeKind, patientName, feedback, includeFeedback],
  );

  // Brief reads top to bottom, so it opens expanded; Full is a reference you
  // dip into, so it opens on the headline only.
  useEffect(() => {
    setOpen(new Set(mode === 'brief' ? report.sections.map((s) => s.id) : report.sections.filter((s) => s.tab !== 'devices' && s.tab !== 'analyses').map((s) => s.id)));
    // Only on a mode switch — not every time a section appears.
  }, [mode]);

  const groups = sectionsByTab(report);
  const current = groups.find((g) => g.tab.id === tab) ?? groups[0];
  const visible = current?.sections ?? [];
  const allOpen = visible.every((s) => open.has(s.id));
  const toggle = (id: string, isOpen: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });

  const loading = snapshot.metrics.loading && !snapshot.metrics.data;

  async function sendToClaude() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setClaude({ status: 'sending' });
    try {
      // Claude reads the report without its own earlier notes.
      const base = buildClinicReport({ snapshot, therapy: activeLoopTherapy(), mode, range, sourceLabel: report.sourceLabel, now: new Date() });
      const { requestReportFeedback } = await import('@/lib/ai/claudeFeedback');
      const next = await requestReportFeedback(claudeConfig, base, { signal: controller.signal });
      setFeedback(next);
      setIncludeFeedback(true);
      setOpen((prev) => new Set(prev).add('claude'));
      setTab('insights');
      setClaude({ status: 'idle' });
    } catch (err) {
      setClaude({ status: 'error', message: err instanceof Error ? err.message : 'Claude request failed.' });
    }
  }

  async function exportFile(kind: 'pdf' | 'html') {
    setExporting(true);
    setExportStatus(kind === 'pdf' ? 'Building PDF…' : 'Building dashboard…');
    try {
      const { shareFile } = await import('@/lib/report/shareReport');
      let blob: Blob;
      let name: string;
      if (kind === 'pdf') {
        const { renderClinicReportPdf, reportFileName } = await import('@/lib/report/clinicReportPdf');
        blob = await renderClinicReportPdf(report);
        name = reportFileName(report);
      } else {
        const { renderClinicReportHtml, dashboardFileName } = await import('@/lib/report/clinicReportHtml');
        blob = new Blob([renderClinicReportHtml(report)], { type: 'text/html' });
        name = dashboardFileName(report);
      }
      const outcome = await shareFile(blob, name, report.title);
      const what = kind === 'pdf' ? 'PDF' : 'Dashboard file';
      setExportStatus(outcome === 'downloaded' ? `${what} downloaded.` : outcome === 'shared' ? `${what} shared from the iOS share sheet.` : 'Share sheet closed. Nothing was sent.');
    } catch (err) {
      setExportStatus(err instanceof Error ? `Could not export: ${err.message}` : 'Could not export.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <AppHeader title="Clinic report" showBack />
      <main className={`screen ${styles.screen}`}>
        <div>
          <h1 className="screen-title">Report for your care team</h1>
          <p className={styles.support}>
            Observed patterns and the Loop settings on file, as a PDF your clinician can read in a few minutes. Review it here first.
          </p>
        </div>

        <section className={styles.card} aria-label="Report options">
          <div className={styles.modes} role="radiogroup" aria-label="Report length">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                className={`${styles.mode} ${mode === m.id ? styles.modeActive : ''}`}
                onClick={() => setMode(m.id)}
              >
                <span className={styles.modeLabel}>{m.label}</span>
                <span className={styles.modeHint}>{m.hint}</span>
              </button>
            ))}
          </div>
          <div className={styles.fields}>
            <label>
              Period
              <select value={range} onChange={(e) => setRange(e.target.value as ReportRange)}>
                {REPORT_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <label>
              Name on the PDF (optional)
              <input value={patientName} maxLength={80} autoComplete="name" placeholder="Leave blank to omit" onChange={(e) => setPatientName(e.target.value)} />
            </label>
          </div>
          <p className={styles.muted}>The name is printed on the PDF only. It is not saved and never sent to Claude.</p>
        </section>

        {report.sample ? <SampleNote>This report includes sample data. Connect a real source before sharing it with a clinician.</SampleNote> : null}
        {loading ? <p role="status" className={styles.muted}>Loading history…</p> : null}

        <div className={styles.tabs} role="tablist" aria-label="Report tabs">
          {groups.map((g) => (
            <button
              key={g.tab.id}
              type="button"
              role="tab"
              aria-selected={current?.tab.id === g.tab.id}
              className={`${styles.tab} ${current?.tab.id === g.tab.id ? styles.tabActive : ''}`}
              onClick={() => setTab(g.tab.id)}
            >
              {g.tab.label}
            </button>
          ))}
        </div>

        <div className={styles.sectionsHead}>
          <h2>{current?.tab.label} · {visible.length} section{visible.length === 1 ? '' : 's'}</h2>
          <button type="button" className={styles.textButton} onClick={() => setOpen((prev) => { const next = new Set(prev); for (const x of visible) { if (allOpen) next.delete(x.id); else next.add(x.id); } return next; })}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        <div className={styles.sections} role="tabpanel">
          {visible.map((s) => (
            <details
              key={s.id}
              className={`${styles.section} ${s.aiGenerated ? styles.sectionAi : ''}`}
              open={open.has(s.id)}
              onToggle={(e) => toggle(s.id, (e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>
                <span className={styles.sectionTitle}>{s.title}</span>
                {s.window ? <span className={styles.sectionWindow}>{s.window}</span> : null}
              </summary>
              <SectionBody s={s} />
            </details>
          ))}
        </div>

        <section className={styles.card} aria-labelledby="claude-notes">
          <div className={styles.cardHead}>
            <h2 id="claude-notes">Discussion notes from Claude</h2>
            <span>{claudeReady(claudeConfig) ? claudeModelLabel(claudeConfig.model) : 'Not connected'}</span>
          </div>
          {!claudeReady(claudeConfig) ? (
            <p className={styles.muted}>
              Connect Claude to draft questions for your appointment from this report. <Link to="/app/settings/claude">Set up Claude</Link>
            </p>
          ) : (
            <>
              <p className={styles.muted}>
                Claude reads the sections above and drafts observations and questions for your care team. It does not suggest doses or new settings.
              </p>
              {feedback ? (
                <label className={styles.check}>
                  <input type="checkbox" checked={includeFeedback} onChange={(e) => setIncludeFeedback(e.target.checked)} />
                  <span>Include Claude’s notes in the PDF (labelled AI-generated)</span>
                </label>
              ) : null}
              {claude.status === 'preview' ? (
                <>
                  <details open className={styles.preview}>
                    <summary>Exactly what will be sent</summary>
                    <p className={styles.muted}>The {mode} report for {REPORT_RANGES.find((r) => r.id === range)?.label.toLowerCase()}, without your name.</p>
                    <textarea readOnly rows={8} aria-label="Data that will be sent to Claude" value={reportForClaude(buildClinicReport({ snapshot, therapy: activeLoopTherapy(), mode, range, sourceLabel: report.sourceLabel, now: new Date() }))} />
                  </details>
                  <div className={styles.row}>
                    <Button type="button" variant="primary" fullWidth={false} onClick={() => void sendToClaude()}>Send to Claude</Button>
                    <Button type="button" variant="tertiary" fullWidth={false} onClick={() => setClaude({ status: 'idle' })}>Cancel</Button>
                  </div>
                </>
              ) : claude.status === 'sending' ? (
                <div className={styles.row}>
                  <p role="status">Claude is reading the report… this can take a minute.</p>
                  <Button type="button" variant="tertiary" fullWidth={false} onClick={() => abort.current?.abort()}>Stop</Button>
                </div>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setClaude({ status: 'preview' })}>
                  {feedback ? 'Ask Claude again' : 'Ask Claude for discussion notes'}
                </Button>
              )}
              {claude.status === 'error' ? <p role="alert" className={styles.error}>{claude.message}</p> : null}
            </>
          )}
        </section>

        <div className={styles.exportBar}>
          <Button type="button" onClick={() => void exportFile('pdf')} disabled={exporting || loading}>
            {mode === 'brief' ? 'Export brief PDF' : 'Export full PDF'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void exportFile('html')} disabled={exporting || loading}>
            Export interactive dashboard (HTML)
          </Button>
          <p className={styles.muted}>Both include every tab. The dashboard is one offline file with the same tabs and dropdowns; it opens in any browser.</p>
          {exportStatus ? <p role="status" className={styles.muted}>{exportStatus}</p> : null}
        </div>
      </main>
    </>
  );
}
