import type { jsPDF as JsPdf } from 'jspdf';
import { sectionsByTab, type AgpChart, type ClinicReport, type HeatRow, type HourBar, type ReportFact, type ReportSection, type ReportTable } from './clinicReport';
import { agpPlot, type Pt } from './agpChart';

// PDF renderer for the clinic report.
//
// Draws the sections buildClinicReport produced — no numbers are computed
// here. Letter size, black-on-white, one typeface, generous line height: it
// is read on paper or a clinic screen, often printed in greyscale, so every
// band and verdict is written in words beside any colour.
//
// jsPDF is imported on demand: the library is large and only an export needs it.

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const CONTENT_W = PAGE_W - M * 2;
const FOOTER = 40;

const INK: [number, number, number] = [14, 18, 22];
const INK_700: [number, number, number] = [60, 67, 74];
const INK_500: [number, number, number] = [110, 118, 126];
const RULE: [number, number, number] = [214, 217, 221];
const SURFACE: [number, number, number] = [243, 244, 246];
const BRAND: [number, number, number] = [31, 122, 46];

// AGP bands are the info blue pre-mixed onto white, so they print the same in
// greyscale and need no transparency support from the viewer.
const AGP_OUTER: [number, number, number] = [220, 229, 239];
const AGP_INNER: [number, number, number] = [160, 187, 220];
const AGP_MEDIAN: [number, number, number] = [43, 82, 125];

const BAND_COLORS: [number, number, number][] = [
  [192, 57, 43], // very low
  [252, 94, 94], // low
  [92, 194, 92], // in range
  [240, 180, 41], // high
  [224, 123, 31], // very high
];

// The built-in Helvetica only covers WinAnsi. Map the symbols the report uses
// and drop anything else (emoji in absorption labels) rather than printing tofu.
const REPLACE: Record<string, string> = { '≤': '<=', '≥': '>=', '→': '->', '−': '-', '×': 'x', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...' };
export function pdfSafe(text: string): string {
  return text
    .replace(/[≤≥→−×“”‘’…]/g, (c) => REPLACE[c])
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•·]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

class Writer {
  y = M;
  constructor(readonly doc: JsPdf) {}

  ensure(height: number) {
    if (this.y + height > PAGE_H - M - FOOTER) {
      this.doc.addPage();
      this.y = M;
    }
  }

  font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', color = INK) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  lines(text: string, width: number): string[] {
    return this.doc.splitTextToSize(pdfSafe(text), width) as string[];
  }

  paragraph(text: string, size = 10, style: 'normal' | 'bold' | 'italic' = 'normal', color = INK, indent = 0) {
    this.font(size, style, color);
    const lh = size * 1.4;
    for (const line of this.lines(text, CONTENT_W - indent)) {
      this.ensure(lh);
      this.doc.text(line, M + indent, this.y + size);
      this.y += lh;
    }
  }

  bullet(text: string) {
    this.font(10);
    const lh = 14;
    const ls = this.lines(text, CONTENT_W - 14);
    ls.forEach((line, i) => {
      this.ensure(lh);
      if (i === 0) this.doc.text('•', M + 2, this.y + 10);
      this.doc.text(line, M + 14, this.y + 10);
      this.y += lh;
    });
    this.y += 2;
  }

  table(t: ReportTable) {
    const cols = t.columns.length;
    // First column carries labels; give it the most room.
    const first = cols <= 2 ? 0.5 : cols === 3 ? 0.42 : cols === 4 ? 0.3 : 0.26;
    const rest = (1 - first) / (cols - 1);
    const widths = t.columns.map((_, i) => CONTENT_W * (i === 0 ? first : rest));
    const pad = 5;
    if (t.caption) {
      this.ensure(30);
      this.paragraph(t.caption, 9.5, 'bold', INK_700);
      this.y += 2;
    }
    const drawRow = (cells: string[], header: boolean) => {
      this.font(header ? 8.5 : 9, header ? 'bold' : 'normal', header ? INK_700 : INK);
      const wrapped = cells.map((c, i) => this.lines(c, widths[i] - pad * 2));
      const h = Math.max(...wrapped.map((w) => w.length)) * 12 + pad * 2 - 2;
      this.ensure(h);
      if (header) {
        this.doc.setFillColor(...SURFACE);
        this.doc.rect(M, this.y, CONTENT_W, h, 'F');
      }
      let x = M;
      wrapped.forEach((ls, i) => {
        ls.forEach((line, j) => this.doc.text(line, x + pad, this.y + pad + 8.5 + j * 12));
        x += widths[i];
      });
      this.y += h;
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.5);
      this.doc.line(M, this.y, M + CONTENT_W, this.y);
    };
    drawRow(t.columns, true);
    for (const row of t.rows) drawRow(row, false);
    this.y += 8;
  }

  facts(facts: ReportFact[]) {
    const withTarget = facts.some((f) => f.target);
    this.table({
      columns: withTarget ? ['Measure', 'Value', 'Consensus target'] : ['Measure', 'Value'],
      rows: facts.map((f) => (withTarget ? [f.label, f.value, f.target ?? '—'] : [f.label, f.value])),
    });
  }

  tirBar(tir: NonNullable<ReportSection['tir']>) {
    const b = tir.bands;
    const values = [b.veryLow, b.low, b.inRange, b.high, b.veryHigh];
    const labels = [
      `Very low <${tir.urgentLowMgdl}`,
      `Low ${tir.urgentLowMgdl}–${tir.lowMgdl - 1}`,
      `In range ${tir.lowMgdl}–${tir.highMgdl}`,
      `High ${tir.highMgdl + 1}–250`,
      'Very high >250',
    ];
    const total = values.reduce((a, v) => a + v, 0) || 1;
    this.ensure(64);
    let x = M;
    values.forEach((v, i) => {
      const w = (v / total) * CONTENT_W;
      if (w <= 0) return;
      this.doc.setFillColor(...BAND_COLORS[i]);
      this.doc.rect(x, this.y, w, 14, 'F');
      x += w;
    });
    this.y += 22;
    // Legend in words — the bar is never the only carrier of the numbers.
    const colW = CONTENT_W / 5;
    values.forEach((v, i) => {
      const lx = M + i * colW;
      this.doc.setFillColor(...BAND_COLORS[i]);
      this.doc.rect(lx, this.y + 1, 7, 7, 'F');
      this.font(8, 'normal', INK_700);
      this.doc.text(pdfSafe(labels[i]), lx + 10, this.y + 7.5);
      this.font(10, 'bold');
      this.doc.text(`${Math.round(v * 10) / 10}%`, lx + 10, this.y + 21);
    });
    this.y += 34;
  }

  /** 24 stacked columns: low (bottom), in range, high (top). */
  hours(bars: HourBar[]) {
    const chartH = 84;
    const colW = CONTENT_W / bars.length;
    this.ensure(chartH + 40);
    const top = this.y;
    bars.forEach((b, i) => {
      const x = M + i * colW + 1;
      const w = colW - 2;
      if (!b.readings) {
        this.doc.setFillColor(...SURFACE);
        this.doc.rect(x, top, w, chartH, 'F');
        return;
      }
      let y = top + chartH;
      for (const [share, color] of [[b.lowPct, BAND_COLORS[1]], [b.inRangePct, BAND_COLORS[2]], [b.highPct, BAND_COLORS[3]]] as const) {
        const h = (share / 100) * chartH;
        if (h <= 0) continue;
        this.doc.setFillColor(...color);
        this.doc.rect(x, y - h, w, h, 'F');
        y -= h;
      }
    });
    this.font(7, 'normal', INK_500);
    bars.forEach((b, i) => {
      if (i % 3 === 0) this.doc.text(b.label.slice(0, 2), M + i * colW + colW / 2, top + chartH + 9, { align: 'center' });
    });
    this.y = top + chartH + 16;
    this.legend([['Low', BAND_COLORS[1]], ['In range', BAND_COLORS[2]], ['High', BAND_COLORS[3]]]);
  }

  /** jsPDF draws paths as relative segments from a start point. */
  private shape(points: Pt[], style: 'F' | 'S', closed: boolean) {
    if (points.length < 2) return;
    const deltas = points.slice(1).map(([x, y], i): Pt => [x - points[i][0], y - points[i][1]]);
    this.doc.lines(deltas, points[0][0], points[0][1], [1, 1], style, closed);
  }

  /** AGP percentile curve: 5–95 and 25–75 bands, the median, the range dashed. */
  agp(chart: AgpChart) {
    const chartH = 150;
    const axisW = 26;
    this.ensure(chartH + 44);
    const p = agpPlot(chart, { width: CONTENT_W - axisW, height: chartH, left: M + axisW, top: this.y });
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.4);
    this.font(7, 'normal', INK_500);
    for (const t of p.yTicks) {
      this.doc.line(p.left, t.y, p.left + p.width, t.y);
      this.doc.text(t.label, p.left - 4, t.y + 2.5, { align: 'right' });
    }
    p.xTicks.forEach((t, i) => {
      this.doc.text(t.label, t.x, p.top + chartH + 10, { align: i === 0 ? 'left' : i === p.xTicks.length - 1 ? 'right' : 'center' });
    });
    this.doc.setFillColor(...AGP_OUTER);
    for (const pts of p.outer) this.shape(pts, 'F', true);
    this.doc.setFillColor(...AGP_INNER);
    for (const pts of p.inner) this.shape(pts, 'F', true);
    this.doc.setDrawColor(...BAND_COLORS[2]);
    this.doc.setLineWidth(1);
    this.doc.setLineDashPattern([3, 2], 0);
    this.doc.line(p.left, p.lowY, p.left + p.width, p.lowY);
    this.doc.line(p.left, p.highY, p.left + p.width, p.highY);
    this.doc.setLineDashPattern([], 0);
    this.doc.setDrawColor(...AGP_MEDIAN);
    this.doc.setLineWidth(1.6);
    for (const pts of p.median) this.shape(pts, 'S', false);
    this.y = p.top + chartH + 18;
    this.legend([['Median', AGP_MEDIAN], ['25th–75th', AGP_INNER], ['5th–95th', AGP_OUTER], [`Range ${chart.lowMgdl}–${chart.highMgdl} mg/dL`, BAND_COLORS[2]]]);
  }

  /** Weekday rows × 24 hours. Cell text is the median mg/dL, so colour is never the only carrier. */
  heatmap(rows: HeatRow[]) {
    const labelW = 30;
    const colW = (CONTENT_W - labelW) / 24;
    const rowH = 15;
    this.ensure(rows.length * rowH + 40);
    this.font(6.5, 'normal', INK_500);
    for (let h = 0; h < 24; h += 3) this.doc.text(String(h).padStart(2, '0'), M + labelW + h * colW + colW / 2, this.y + 7, { align: 'center' });
    this.y += 10;
    for (const r of rows) {
      this.font(8, 'bold', INK_700);
      this.doc.text(r.label, M, this.y + 10);
      r.cells.forEach((c, h) => {
        const x = M + labelW + h * colW + 0.5;
        if (!c) {
          this.doc.setFillColor(...SURFACE);
          this.doc.rect(x, this.y, colW - 1, rowH - 1, 'F');
          return;
        }
        // Dominant share picks the hue; a low share of 10%+ always shows red,
        // because a recurring low outranks a mostly-in-range hour.
        const color = c.lowPct >= 10 ? BAND_COLORS[1] : c.highPct > c.inRangePct ? BAND_COLORS[3] : BAND_COLORS[2];
        const mix = (v: number) => Math.round(255 - (255 - v) * 0.55);
        this.doc.setFillColor(mix(color[0]), mix(color[1]), mix(color[2]));
        this.doc.rect(x, this.y, colW - 1, rowH - 1, 'F');
        if (c.medianMgdl != null) {
          this.font(5.8, 'normal', INK);
          this.doc.text(String(Math.round(c.medianMgdl)), x + (colW - 1) / 2, this.y + 9.5, { align: 'center' });
        }
      });
      this.y += rowH;
    }
    this.y += 6;
    this.legend([['Low share ≥10%', BAND_COLORS[1]], ['Mostly in range', BAND_COLORS[2]], ['Mostly high', BAND_COLORS[3]], ['Not enough weeks', SURFACE]]);
  }

  legend(items: [string, [number, number, number]][]) {
    let x = M;
    for (const [label, color] of items) {
      this.doc.setFillColor(...color);
      this.doc.rect(x, this.y + 1, 7, 7, 'F');
      this.font(8, 'normal', INK_700);
      const text = pdfSafe(label);
      this.doc.text(text, x + 10, this.y + 7.5);
      x += 10 + this.doc.getTextWidth(text) + 16;
    }
    this.y += 18;
  }

  chapter(label: string, continuous: boolean) {
    if (!continuous) {
      this.doc.addPage();
      this.y = M;
    }
    this.ensure(40);
    this.y += 6;
    this.font(9, 'bold', BRAND);
    this.doc.text(pdfSafe(label.toUpperCase()), M, this.y + 9);
    this.y += 14;
  }

  section(s: ReportSection) {
    this.ensure(56);
    this.y += 8;
    this.doc.setDrawColor(...INK);
    this.doc.setLineWidth(1);
    this.doc.line(M, this.y, M + CONTENT_W, this.y);
    this.y += 8;
    this.font(13, 'bold');
    this.doc.text(pdfSafe(s.title), M, this.y + 12);
    if (s.aiGenerated) {
      const label = 'AI-GENERATED · NOT CLINICIAN-REVIEWED';
      this.font(7.5, 'bold', INK_700);
      const w = this.doc.getTextWidth(label) + 10;
      this.doc.setDrawColor(...INK_700);
      this.doc.setLineWidth(0.75);
      this.doc.rect(M + CONTENT_W - w, this.y + 2, w, 13);
      this.doc.text(label, M + CONTENT_W - w + 5, this.y + 11);
    }
    this.y += 18;
    if (s.window) this.paragraph(s.window, 8.5, 'normal', INK_500);
    this.y += 4;
    if (s.unavailable) {
      this.paragraph(s.unavailable, 10, 'italic', INK_700);
      return;
    }
    if (s.summary) {
      this.paragraph(s.summary, 10.5);
      this.y += 6;
    }
    if (s.tir) this.tirBar(s.tir);
    if (s.agp) this.agp(s.agp);
    if (s.hours?.length) this.hours(s.hours);
    if (s.heatmap?.length) this.heatmap(s.heatmap);
    if (s.facts?.length) this.facts(s.facts);
    for (const t of s.tables ?? []) this.table(t);
    for (const b of s.bullets ?? []) this.bullet(b);
    if (s.notes?.length) {
      this.y += 2;
      for (const n of s.notes) this.paragraph(n, 8.5, 'italic', INK_500);
    }
  }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export async function renderClinicReportPdf(report: ClinicReport): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: pdfSafe(report.title), subject: 'Diabetes data summary', creator: 'LoopStack' });
  const w = new Writer(doc);

  // Header
  w.font(9, 'bold', BRAND);
  doc.text('LOOPSTACK', M, w.y + 9);
  w.font(8.5, 'normal', INK_500);
  doc.text(`Generated ${fmtDate(report.generatedIso)} · ${pdfSafe(report.timeZone)}`, M + CONTENT_W, w.y + 9, { align: 'right' });
  w.y += 18;
  w.paragraph(report.title, 19, 'bold');
  w.y += 2;
  const meta = [
    report.patientName ? `Patient: ${report.patientName}` : null,
    `Period: ${fmtDate(report.period.startIso)} – ${fmtDate(report.period.endIso)} (${report.period.days} days${report.period.daysCovered != null ? `, ${report.period.daysCovered} with CGM data` : ''})`,
    `Data source: ${report.sourceLabel}`,
  ].filter(Boolean) as string[];
  for (const line of meta) w.paragraph(line, 10, 'normal', INK_700);

  if (report.sample) {
    w.y += 6;
    w.ensure(36);
    doc.setFillColor(253, 236, 234);
    doc.rect(M, w.y, CONTENT_W, 30, 'F');
    w.font(9.5, 'bold', [150, 40, 30]);
    doc.text('SAMPLE DATA — this report includes demonstration values and does not describe the patient.', M + 8, w.y + 18.5);
    w.y += 36;
  }

  // Tabs print as chapters. Brief keeps them flowing so it stays short; Full
  // starts each chapter on a new page so a clinician can find Settings.
  sectionsByTab(report).forEach((g, i) => {
    w.chapter(g.tab.label, report.mode === 'brief' || i === 0);
    for (const s of g.sections) w.section(s);
  });

  w.y += 10;
  w.paragraph(report.disclaimer, 8, 'italic', INK_500);

  // Footer on every page, after layout so the page count is known.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(M, PAGE_H - M + 6, M + CONTENT_W, PAGE_H - M + 6);
    w.font(7.5, 'normal', INK_500);
    const left = `LoopStack ${report.mode === 'brief' ? 'brief' : 'full'} report${report.patientName ? ` · ${pdfSafe(report.patientName)}` : ''} · Not a medical device`;
    doc.text(left, M, PAGE_H - M + 18);
    doc.text(`Page ${i} of ${pages}`, M + CONTENT_W, PAGE_H - M + 18, { align: 'right' });
  }

  return doc.output('blob');
}

export function reportFileName(report: ClinicReport): string {
  return `LoopStack-${report.mode}-report-${report.generatedIso.slice(0, 10)}.pdf`;
}
