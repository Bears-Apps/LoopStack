import { describe, expect, it } from 'vitest';
import { createMockDataSource } from '@/data/sources/mockDataSource';
import { realLoopTherapy } from '@/data/loopTherapy';
import type { DataSnapshot } from '@/data/sources/types';
import { buildClinicReport, GLANCE_RANGES, reportForClaude, sectionsByTab, type ClaudeFeedback } from './clinicReport';
import { renderClinicReportHtml } from './clinicReportHtml';
import { pdfSafe, renderClinicReportPdf, reportFileName } from './clinicReportPdf';

const NOW = new Date(2026, 9, 28, 9, 0, 0);
const snapshot = createMockDataSource().getSnapshot();

const build = (over: Partial<Parameters<typeof buildClinicReport>[0]> = {}) =>
  buildClinicReport({ snapshot, therapy: realLoopTherapy, mode: 'brief', range: '30d', sourceLabel: 'Sample data (demo)', now: NOW, ...over });

const feedback: ClaudeFeedback = {
  overview: 'Overview.',
  observations: [{ title: 'Afternoon lows', detail: 'Lows cluster 3–5pm.', evidence: 'Observed patterns' }],
  discussionQuestions: ['Is the afternoon basal right?'],
  dataGaps: ['No exercise logs.'],
  model: 'claude-opus-5-5',
  generatedIso: NOW.toISOString(),
};

describe('buildClinicReport', () => {
  it('brief mode is the short read; full adds the deep analyses', () => {
    const brief = build();
    const full = build({ mode: 'full' });
    expect(brief.sections.map((s) => s.id)).toEqual(['glance', 'glucose', 'lows', 'insulin', 'act', 'agp', 'hourly', 'meals', 'weekdayHour', 'settings']);
    expect(full.sections.map((s) => s.id)).toContain('corrections');
    expect(full.sections.length).toBeGreaterThan(brief.sections.length);
    expect(sectionsByTab(brief).map((g) => g.tab.id)).toEqual(['summary', 'agp', 'daily', 'insights', 'devices']);
    expect(sectionsByTab(full).map((g) => g.tab.id)).toEqual(['summary', 'agp', 'daily', 'insights', 'devices', 'analyses']);
  });

  it('glance uses the home screen windows and thresholds', () => {
    const glance = build().sections[0];
    expect(glance.tables![0].columns.slice(1)).toEqual(GLANCE_RANGES.map((r) => r.label));
    const m = snapshot.metrics.data!['30d'];
    expect(glance.tables![0].rows.map((r) => r[0])).toContain(`Urgent low <${m.urgentLowMgdl}`);
    expect(glance.window).toContain(`in range ${m.targetLowMgdl}–${m.targetHighMgdl}`);
  });

  it('trends to act on list lows before highs', () => {
    const rows = build().sections.find((s) => s.id === 'act')!.tables?.[0].rows ?? [];
    const priorities = rows.map((r) => r[0]);
    expect([...priorities].sort()).toEqual(priorities);
  });

  it('hour by hour carries 24 bars and the weekday grid seven rows', () => {
    const r = build();
    expect(r.sections.find((s) => s.id === 'hourly')!.hours).toHaveLength(24);
    const heat = r.sections.find((s) => s.id === 'weekdayHour')!.heatmap!;
    expect(heat.map((x) => x.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(heat.every((x) => x.cells.length === 24)).toBe(true);
  });

  it('full mode lists every schedule segment; brief summarises them', () => {
    const brief = build().sections.find((s) => s.id === 'settings')!;
    const full = build({ mode: 'full' }).sections.find((s) => s.id === 'settings')!;
    expect(brief.tables).toBeUndefined();
    const basal = full.tables!.find((t) => t.caption === 'Basal rates')!;
    expect(basal.rows).toHaveLength(realLoopTherapy.basalSchedule.length);
    expect(basal.columns).toEqual(['Start', 'End', 'U/h']);
    expect(basal.rows[basal.rows.length - 1][1]).toBe('12:00 AM');
    expect(brief.facts!.find((f) => f.label === 'Basal rates')!.value).toContain(`${realLoopTherapy.basalSchedule.length} segments`);
  });

  it('leads with data sufficiency: CGM wear is the first fact of the period', () => {
    const glucose = build().sections.find((s) => s.id === 'glucose')!;
    expect(glucose.facts![0].label).toBe('CGM active (wear)');
    expect(glucose.facts![0].target).toBe('≥ 70%');
  });

  it('reports hypoglycaemia events on the user’s own thresholds, split day and night', () => {
    const r = build({ mode: 'full' });
    const lows = r.sections.find((s) => s.id === 'lows')!;
    const h = snapshot.hypoEvents.data!['30d'];
    expect(lows.tab).toBe('summary');
    expect(lows.facts![0].label).toBe(`Low events <${h.low.thresholdMgdl}`);
    expect(h.low.thresholdMgdl).toBe(r.thresholds!.lowMgdl);
    expect(lows.tables![0].columns).toEqual(['', 'All', 'Day 06–24', 'Overnight 00–06']);
    // Brief keeps it to the facts.
    expect(build().sections.find((s) => s.id === 'lows')!.tables).toBeUndefined();
  });

  it('puts hypoglycaemia events at the top of trends to act on', () => {
    const rows = build().sections.find((s) => s.id === 'act')!.tables![0].rows;
    expect(snapshot.hypoEvents.data!['30d'].urgentLow.all.count).toBeGreaterThan(0);
    expect(rows[0][0]).toBe('1 · Low');
    expect(rows[0][1]).toMatch(/^Urgent lows </);
  });

  it('draws the AGP from the selected period, and keeps the chart out of the Claude payload', () => {
    const r = build();
    const agp = r.sections.find((s) => s.id === 'agp')!;
    expect(agp.tab).toBe('agp');
    expect(agp.agp!.bins).toHaveLength(48);
    expect(agp.agp!.lowMgdl).toBe(r.thresholds!.lowMgdl);
    expect(agp.summary).toMatch(/highest around/);
    expect(reportForClaude(r)).not.toContain('"bins"');
  });

  it('meal panels show three windows; Full adds lead time and the rise goal', () => {
    const brief = build().sections.find((s) => s.id === 'meals')!;
    const full = build({ mode: 'full' }).sections.find((s) => s.id === 'meals')!;
    expect(brief.tables![0].rows.map((r) => r[0].split(' ')[0])).toEqual(['Breakfast', 'Lunch', 'Dinner']);
    expect(brief.tables![0].columns).not.toContain('Bolus');
    expect(full.tables![0].columns).toEqual(['Meal', 'Days logged', 'Carbs', 'Pre-meal', '2-h change', 'Rise <60', '3–4 h', 'Bolus']);
  });

  it('marks the new sections unavailable rather than inventing numbers', () => {
    const empty: DataSnapshot = { ...snapshot, hypoEvents: { ...snapshot.hypoEvents, data: null }, agp: { ...snapshot.agp, data: null } };
    const r = build({ snapshot: empty });
    expect(r.sections.find((s) => s.id === 'lows')!.unavailable).toBeTruthy();
    expect(r.sections.find((s) => s.id === 'agp')!.unavailable).toBeTruthy();
    expect(r.sections.find((s) => s.id === 'glucose')!.facts![0].label).not.toBe('CGM active (wear)');
  });

  it('labels sample data instead of presenting it as the patient', () => {
    expect(build().sample).toBe(true);
  });

  it('shows consensus targets only when bands are the consensus bands', () => {
    const consensus: DataSnapshot = snapshot;
    const glucose = build({ snapshot: consensus }).sections.find((s) => s.id === 'glucose')!;
    const m = consensus.metrics.data!['30d'];
    const isConsensus = m.targetLowMgdl === 70 && m.targetHighMgdl === 180 && m.urgentLowMgdl === 54;
    expect(glucose.facts!.some((f) => f.target === '> 70%')).toBe(isConsensus);
  });

  it('marks a section unavailable rather than inventing numbers', () => {
    const empty: DataSnapshot = { ...snapshot, metrics: { ...snapshot.metrics, data: null } };
    const r = build({ snapshot: empty });
    expect(r.sections.find((s) => s.id === 'glucose')!.unavailable).toBeTruthy();
    expect(r.sections.find((s) => s.id === 'glance')!.unavailable).toBeTruthy();
    expect(r.period.daysCovered).toBeNull();
  });

  it('appends Claude notes as a labelled AI section', () => {
    const r = build({ feedback });
    const notes = r.sections.find((s) => s.id === 'claude')!;
    expect(notes.tab).toBe('insights');
    expect(notes.aiGenerated).toBe(true);
    expect(notes.notes!.some((n) => n.includes('AI-generated'))).toBe(true);
  });

  it('never sends the patient name or earlier AI notes to Claude', () => {
    const payload = reportForClaude(build({ patientName: 'Jordan Example', feedback }));
    expect(payload).not.toContain('Jordan Example');
    expect(payload).not.toContain('patientName');
    expect(payload).not.toContain('Afternoon lows');
  });
});

describe('clinic report PDF', () => {
  it('maps symbols Helvetica cannot draw and drops emoji', () => {
    expect(pdfSafe('CV ≤ 36% → good 🥜 “ok”')).toBe('CV <= 36% -> good "ok"');
  });

  it('renders both modes to a non-empty PDF', async () => {
    for (const mode of ['brief', 'full'] as const) {
      const report = build({ mode, patientName: 'Jordan Example', feedback });
      const blob = await renderClinicReportPdf(report);
      const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
      expect(head).toBe('%PDF-');
      expect(blob.size).toBeGreaterThan(3000);
      expect(reportFileName(report)).toBe(`LoopStack-${mode}-report-${report.generatedIso.slice(0, 10)}.pdf`);
    }
  });
});

describe('clinic report HTML dashboard', () => {
  it('is self-contained and escapes record text', () => {
    const html = renderClinicReportHtml(build({ mode: 'full', patientName: '<img src=x onerror=alert(1)>', feedback }));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    // No network: nothing loads from elsewhere when a clinician opens it.
    expect(html).not.toMatch(/(src|href)=["']?https?:/i);
    expect(html).not.toMatch(/@import|url\(/i);
    for (const label of ['Summary', 'Overview (AGP)', 'Daily', 'Insights', 'Devices &amp; settings', 'Analyses']) expect(html).toContain(`>${label}</button>`);
    // The AGP is drawn inline, not loaded.
    expect(html).toContain('<svg class="agp"');
  });
});
