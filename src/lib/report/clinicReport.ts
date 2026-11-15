import type { CarbEntry, DataResult, DataSnapshot } from '@/data/sources/types';
import type { LoopTherapy, RangeEntry, ScheduleEntry } from '@/data/loopTherapy';
import type { GlucoseMetrics, MetricsRange, TimeInRangeBands } from '@/data/types';
import { formatStart, scheduleDailyTotal } from '@/data/loopTherapySchedules';
import { worstBucket } from '@/lib/metrics/timeTrends';
import { formatHour } from '@/lib/alerts/riskWindows';
import type { HypoReport, HypoStat } from '@/lib/metrics/hypoEvents';
import { RISE_GOAL_MGDL } from '@/lib/metrics/mealPanels';

// Clinic report: the doctor-facing dashboard of observed patterns and the Loop
// settings on file.
//
// ONE MODEL, THREE RENDERERS. This module turns the active source's snapshot
// into plain sections (facts, tables, charts-as-data, bullets, notes), each
// filed under a tab. The Report screen renders tabs of dropdowns; the PDF
// renders the tabs as chapters; the HTML export renders the same tabs as a
// self-contained dashboard file. Nothing is computed in a renderer, so what a
// clinician reads can never disagree with what the person reviewed.
//
// SHAPE, modelled on the clinician patient views endocrinologists already
// read (Glooko, Omnipod Discover's physician report) and the PANTHER order
// clinicians are taught for AID data: data sufficiency → lows → highs →
// automation use → behaviour → settings.
//   Summary          the home screen's glance across 3/7/30/90/180 days with
//                    its thresholds; CGM wear, TIR and glucose metrics;
//                    hypoglycaemia events and overnight lows; insulin and Loop use.
//   Overview (AGP)   the AGP percentile curve, the 24-hour profile, meal panels.
//   Daily            the last week day by day and the weekday × hour grid.
//   Insights         the patterns that point at a lever, lows first; Claude's
//                    notes; in Full, correction-bolus outcomes.
//   Devices          every Loop setting, segment by segment.
//   Analyses         (Full only) the engines behind the insights.
//
// HONESTY RULES carried over from the rest of the app:
//   - Sample data is labelled on the report, never presented as the patient's.
//   - Every analysis states the window it was computed over; they differ.
//   - Settings are the user's transcription of Loop, with the date confirmed.
//   - Observations and review points, never instructions. Changes happen in
//     Loop with the care team.

export type ReportMode = 'brief' | 'full';
export type ReportRange = Extract<MetricsRange, '14d' | '30d' | '90d'>;
export type ReportTab = 'summary' | 'agp' | 'daily' | 'insights' | 'devices' | 'analyses';

export const REPORT_RANGES: { id: ReportRange; label: string }[] = [
  { id: '14d', label: 'Last 14 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
];

// Tabs follow the clinician patient view endocrinologists already use in
// Glooko and Omnipod Discover: a Summary to read first, the AGP overview, a
// daily view, then LoopStack's own insights, device settings and analyses.
export const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'agp', label: 'Overview (AGP)' },
  { id: 'daily', label: 'Daily' },
  { id: 'insights', label: 'Insights' },
  { id: 'devices', label: 'Devices & settings' },
  { id: 'analyses', label: 'Analyses' },
];

/** The home screen's glance windows, in its order. */
export const GLANCE_RANGES: { id: MetricsRange; label: string }[] = [
  { id: '3d', label: '3 days' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '180d', label: '180 days' },
];

export type ReportFact = { label: string; value: string; target?: string };
export type ReportTable = { caption?: string; columns: string[]; rows: string[][] };

/** One stacked bar per hour: low / in range / high shares, with the mean. */
export type HourBar = { label: string; lowPct: number; inRangePct: number; highPct: number; avgMgdl: number | null; readings: number };

/** AGP percentile curve. A bin with null values has too few readings. */
export type AgpChart = {
  bins: { minute: number; p5: number | null; p25: number | null; p50: number | null; p75: number | null; p95: number | null }[];
  lowMgdl: number;
  highMgdl: number;
  /** Top of the y axis, mg/dL. */
  yMax: number;
};

/** Weekday × hour grid. A null cell has too few weeks to say anything. */
export type HeatRow = { label: string; cells: ({ lowPct: number; inRangePct: number; highPct: number; medianMgdl: number | null } | null)[] };

export type ReportSection = {
  id: string;
  tab: ReportTab;
  title: string;
  /** "Analysed over 28 days" — analyses carry their own windows. */
  window?: string;
  summary?: string;
  /** Five-band time-in-range bar, drawn with its labels (never colour alone). */
  tir?: { bands: TimeInRangeBands; lowMgdl: number; highMgdl: number; urgentLowMgdl: number };
  facts?: ReportFact[];
  hours?: HourBar[];
  heatmap?: HeatRow[];
  agp?: AgpChart;
  tables?: ReportTable[];
  bullets?: string[];
  notes?: string[];
  /** Set when the source has nothing for this section. */
  unavailable?: string;
  /** Model-written content: renderers label it as such. */
  aiGenerated?: boolean;
};

export type ClinicReport = {
  mode: ReportMode;
  range: ReportRange;
  title: string;
  generatedIso: string;
  timeZone: string;
  period: { startIso: string; endIso: string; days: number; daysCovered: number | null };
  sourceLabel: string;
  patientName: string;
  /** Thresholds every band in the report uses — the home screen's own. */
  thresholds: { urgentLowMgdl: number; lowMgdl: number; highMgdl: number; veryHighMgdl: number } | null;
  /** True when any section is built on sample (not computed) data. */
  sample: boolean;
  sections: ReportSection[];
  disclaimer: string;
};

export type ClaudeFeedback = {
  overview: string;
  observations: { title: string; detail: string; evidence: string }[];
  discussionQuestions: string[];
  dataGaps: string[];
  model: string;
  generatedIso: string;
};

const DAY = 24 * 3600_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGE_DAYS: Record<ReportRange, number> = { '14d': 14, '30d': 30, '90d': 90 };

const n1 = (n: number) => (Math.round(n * 10) / 10).toString();
const n2 = (n: number) => (Math.round(n * 100) / 100).toString();
const pct = (n: number) => `${n1(n)}%`;
const usable = <T>(r: DataResult<T>): T | null => (r.error && r.data == null ? null : r.data);
const isSample = (r: DataResult<unknown>) => r.data != null && r.origin !== 'computed';
const windowLabel = (days: number) => `Analysed over ${days} day${days === 1 ? '' : 's'}`;
const confidenceLabel = (c: string) =>
  c === 'good' ? 'Good evidence' : c === 'limited' ? 'Limited evidence' : 'Not enough data';
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** "7:15pm" for minutes after midnight. */
function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = String(minute % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m}${h < 12 ? 'am' : 'pm'}`;
}
const signed = (v: number | null, unit = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${unit}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const eventRate = (st: HypoStat) =>
  st.count === 0 ? 'None' : `${n1(st.perWeek)}/week · median ${Math.round(st.medianDurationMin ?? 0)} min`;

function spanText(entries: { value: number }[], unit: string): string {
  if (entries.length === 0) return '—';
  const values = entries.map((e) => e.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = lo === hi ? `${n2(lo)} ${unit}` : `${n2(lo)}–${n2(hi)} ${unit}`;
  return `${span} · ${entries.length} segment${entries.length === 1 ? '' : 's'}`;
}

function rangeSpanText(entries: RangeEntry[]): string {
  if (entries.length === 0) return '—';
  const lo = Math.min(...entries.map((e) => e.low));
  const hi = Math.max(...entries.map((e) => e.high));
  return `${lo}–${hi} mg/dL · ${entries.length} segment${entries.length === 1 ? '' : 's'}`;
}

/** Start | End | value, as Omnipod's settings page lays segments out. */
function segmentRows<T extends { startMinutes: number }>(entries: T[], value: (e: T) => string): string[][] {
  return entries.map((e, i) => [
    formatStart(e.startMinutes),
    formatStart(i + 1 < entries.length ? entries[i + 1].startMinutes : 24 * 60),
    value(e),
  ]);
}

function scheduleTable(caption: string, unit: string, entries: ScheduleEntry[]): ReportTable {
  return { caption, columns: ['Start', 'End', unit], rows: segmentRows(entries, (e) => n2(e.value)) };
}

function lowHighFrom(m: GlucoseMetrics) {
  return { low: m.tir.low + m.tir.veryLow, high: m.tir.high + m.tir.veryHigh };
}

// ── Overview ───────────────────────────────────────────────────────────────

function glanceSection(s: DataSnapshot): ReportSection {
  const base: ReportSection = { id: 'glance', tab: 'summary', title: 'At a glance' };
  const metrics = usable(s.metrics);
  const cols = GLANCE_RANGES.map((r) => ({ ...r, m: metrics?.[r.id] ?? null }));
  const ref = cols.find((c) => c.m && c.m.daysCovered > 0)?.m;
  if (!ref) return { ...base, unavailable: 'No glucose history yet.' };
  const cell = (m: GlucoseMetrics | null, f: (m: GlucoseMetrics) => string) => (m && m.daysCovered > 0 ? f(m) : '—');
  const row = (label: string, f: (m: GlucoseMetrics) => string) => [label, ...cols.map((c) => cell(c.m, f))];
  return {
    ...base,
    window: `Same windows and thresholds as the LoopStack home screen: urgent low <${ref.urgentLowMgdl}, low <${ref.targetLowMgdl}, in range ${ref.targetLowMgdl}–${ref.targetHighMgdl}, high >${ref.targetHighMgdl}, very high >250 mg/dL.`,
    tables: [
      {
        columns: ['', ...cols.map((c) => c.label)],
        rows: [
          row('Days with CGM data', (m) => `${m.daysCovered}/${m.daysInWindow}`),
          row(`In range ${ref.targetLowMgdl}–${ref.targetHighMgdl}`, (m) => pct(m.tir.inRange)),
          row(`Low <${ref.targetLowMgdl}`, (m) => pct(lowHighFrom(m).low)),
          row(`Urgent low <${ref.urgentLowMgdl}`, (m) => pct(m.tir.veryLow)),
          row(`High >${ref.targetHighMgdl}`, (m) => pct(lowHighFrom(m).high)),
          row('Very high >250', (m) => pct(m.tir.veryHigh)),
          row('Mean glucose', (m) => `${Math.round(m.avgGlucose)}`),
          row('GMI', (m) => `${n1(m.gmi)}%`),
          row('CV', (m) => `${n1(m.cv)}%`),
          row('Insulin / day', (m) => `${n1(m.totalInsulin)} U`),
        ],
      },
    ],
    notes: [
      'GMI is reliable from about 14 days of data; 3- and 7-day values are context only.',
      ...(cols.some((c) => c.m && c.m.daysCovered < c.m.daysInWindow) ? ['Where days with data fall short of the window, figures cover only the days that have readings.'] : []),
    ],
  };
}

function glucoseSection(s: DataSnapshot, range: ReportRange): ReportSection {
  const base: ReportSection = { id: 'glucose', tab: 'summary', title: 'Selected period in detail' };
  const m = usable(s.metrics)?.[range];
  if (!m || m.daysCovered === 0) return { ...base, unavailable: 'No glucose history in this period.' };
  const consensus = m.targetLowMgdl === 70 && m.targetHighMgdl === 180 && m.urgentLowMgdl === 54;
  const { low, high } = lowHighFrom(m);
  // Data sufficiency first, as clinicians are taught to read an AGP report.
  const wear = usable(s.agp)?.[range];
  const hoursPerDay = (p: number) => {
    const min = Math.round((p / 100) * 24 * 60);
    return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m/day` : `${min}m/day`;
  };
  return {
    ...base,
    window: `${m.daysCovered} of ${m.daysInWindow} days have CGM readings`,
    summary: `Time in range ${pct(m.tir.inRange)}, low ${pct(low)}, high ${pct(high)}. Mean ${Math.round(m.avgGlucose)} mg/dL, GMI ${n1(m.gmi)}%, CV ${n1(m.cv)}%.`,
    tir: { bands: m.tir, lowMgdl: m.targetLowMgdl, highMgdl: m.targetHighMgdl, urgentLowMgdl: m.urgentLowMgdl },
    facts: [
      ...(wear && wear.readings > 0
        ? [{ label: 'CGM active (wear)', value: `${Math.round(wear.wearPct)}% · ${wear.daysCovered} of ${wear.windowDays} days`, target: '≥ 70%' }]
        : []),
      { label: `In range ${m.targetLowMgdl}–${m.targetHighMgdl}`, value: `${pct(m.tir.inRange)} · ${hoursPerDay(m.tir.inRange)}`, target: consensus ? '> 70%' : undefined },
      { label: `Low <${m.targetLowMgdl}`, value: `${pct(low)} · ${hoursPerDay(low)}`, target: consensus ? '< 4%' : undefined },
      { label: `Urgent low <${m.urgentLowMgdl}`, value: `${pct(m.tir.veryLow)} · ${hoursPerDay(m.tir.veryLow)}`, target: consensus ? '< 1%' : undefined },
      { label: `High >${m.targetHighMgdl}`, value: pct(high), target: consensus ? '< 25%' : undefined },
      { label: 'Very high >250', value: pct(m.tir.veryHigh), target: consensus ? '< 5%' : undefined },
      { label: 'Mean glucose', value: `${Math.round(m.avgGlucose)} mg/dL` },
      { label: 'GMI (estimated A1c)', value: `${n1(m.gmi)}%`, target: consensus ? '< 7%' : undefined },
      { label: 'Coefficient of variation', value: `${n1(m.cv)}%`, target: '≤ 36%' },
      { label: 'Standard deviation', value: `${Math.round(m.sd)} mg/dL` },
    ],
    notes: [
      consensus
        ? 'Targets are the International Consensus on Time in Range (2019) for most adults with type 1 diabetes; individual targets may differ.'
        : `Bands use the patient's own thresholds (as on the home screen), so they are not directly comparable with a standard AGP report; consensus goals are omitted except CV and CGM wear.`,
      ...(wear && wear.readings > 0 && wear.wearPct < 70
        ? ['CGM wear is under the 70% consensus minimum, so these figures may not represent a typical day.']
        : []),
    ],
  };
}

function lowsSection(s: DataSnapshot, range: ReportRange, mode: ReportMode): ReportSection {
  const base: ReportSection = { id: 'lows', tab: 'summary', title: 'Lows: events and overnight' };
  const h: HypoReport | undefined = usable(s.hypoEvents)?.[range];
  if (!h || h.daysCovered === 0) return { ...base, unavailable: 'No glucose history in this period.' };
  const { low, urgentLow: urgent } = h;
  const cols = (f: (st: HypoStat) => string) => [f(low.all), f(low.day), f(low.overnight)];
  const ucols = (f: (st: HypoStat) => string) => [f(urgent.all), f(urgent.day), f(urgent.overnight)];
  const count = (st: HypoStat) => String(st.count);
  const rate = (st: HypoStat) => n1(st.perWeek);
  const dur = (st: HypoStat) => (st.medianDurationMin == null ? '—' : `${Math.round(st.medianDurationMin)} min`);
  const lowest = (st: HypoStat) => (st.lowestMgdl == null ? '—' : `${Math.round(st.lowestMgdl)}`);
  return {
    ...base,
    window: `${h.daysCovered} of ${h.windowDays} days have CGM readings`,
    summary: `${plural(low.all.count, 'low')} of 15+ minutes below ${low.thresholdMgdl} mg/dL (${n1(low.all.perWeek)} a week), ${low.overnight.count} overnight; ${plural(urgent.all.count, 'urgent low')} below ${urgent.thresholdMgdl}. Overnight, ${pct(h.overnight.lowPct)} of readings were below ${low.thresholdMgdl}.`,
    facts: [
      { label: `Low events <${low.thresholdMgdl}`, value: eventRate(low.all) },
      { label: 'Overnight low events (00–06)', value: eventRate(low.overnight) },
      { label: `Urgent-low events <${urgent.thresholdMgdl}`, value: eventRate(urgent.all) },
      { label: `Overnight time low <${low.thresholdMgdl}`, value: pct(h.overnight.lowPct) },
      { label: `Overnight time urgent low <${urgent.thresholdMgdl}`, value: pct(h.overnight.urgentLowPct) },
    ],
    tables:
      mode === 'full'
        ? [{
            caption: 'Events of 15 minutes or more, by when they started',
            columns: ['', 'All', 'Day 06–24', 'Overnight 00–06'],
            rows: [
              [`Below ${low.thresholdMgdl}: events`, ...cols(count)],
              ['Per week', ...cols(rate)],
              ['Median duration', ...cols(dur)],
              ['Lowest reading', ...cols(lowest)],
              [`Below ${urgent.thresholdMgdl}: events`, ...ucols(count)],
              ['Per week', ...ucols(rate)],
              ['Median duration', ...ucols(dur)],
              ['Lowest reading', ...ucols(lowest)],
            ],
          }]
        : undefined,
    notes: [
      'An event is 15 consecutive minutes or more below the line and ends after 15 minutes back above it (International Consensus definition). Rates are per week of CGM data held, so sensor gaps do not dilute them.',
      'Thresholds are the patient’s own, as on the home screen. Overnight is 00:00–06:00 local time.',
    ],
  };
}

/** Carb entries per day by Omnipod's four time blocks, from the loaded records. */
function carbBlocks(carbs: CarbEntry[], now: Date, days: number) {
  const start = now.getTime() - days * DAY;
  const within = carbs.filter((c) => Date.parse(c.iso) >= start && Date.parse(c.iso) < now.getTime());
  if (!within.length) return null;
  const first = Math.min(...within.map((c) => Date.parse(c.iso)));
  const spanDays = Math.max(1, Math.min(days, Math.ceil((now.getTime() - first) / DAY)));
  const blocks = [
    { label: 'Overnight 00–06', from: 0, to: 6 },
    { label: 'Morning 06–12', from: 6, to: 12 },
    { label: 'Afternoon 12–18', from: 12, to: 18 },
    { label: 'Evening 18–24', from: 18, to: 24 },
  ];
  return {
    spanDays,
    perDay: within.length / spanDays,
    gramsPerDay: within.reduce((a, c) => a + c.grams, 0) / spanDays,
    rows: blocks.map((b) => {
      const inBlock = within.filter((c) => {
        const h = new Date(c.iso).getHours();
        return h >= b.from && h < b.to;
      });
      return [b.label, n1(inBlock.length / spanDays), `${Math.round(inBlock.reduce((a, c) => a + c.grams, 0) / spanDays)} g`];
    }),
  };
}

function insulinSection(s: DataSnapshot, range: ReportRange, now: Date): ReportSection {
  const base: ReportSection = { id: 'insulin', tab: 'summary', title: 'Insulin, carbs and Loop use' };
  const m = usable(s.metrics)?.[range];
  if (!m || m.daysCovered === 0) return { ...base, unavailable: 'No insulin or carb history in this period.' };
  const basalShare = m.totalInsulin > 0 ? (m.basalInsulin / m.totalInsulin) * 100 : null;
  const loop = usable(s.loopMode);
  const carbs = carbBlocks(usable(s.recentCarbs) ?? [], now, RANGE_DAYS[range]);
  const facts: ReportFact[] = [
    { label: 'Total daily insulin', value: `${n1(m.totalInsulin)} U` },
    { label: m.basalIsScheduled ? 'Basal / day (scheduled)' : 'Basal / day (delivered)', value: `${n1(m.basalInsulin)} U${basalShare != null ? ` · ${Math.round(basalShare)}%` : ''}` },
    { label: 'Bolus / day', value: `${n1(m.bolusInsulin)} U${basalShare != null ? ` · ${Math.round(100 - basalShare)}%` : ''}` },
    { label: 'Carbs / day', value: `${Math.round(m.carbs)} g` },
  ];
  if (carbs) facts.push({ label: 'Carb entries / day', value: n1(carbs.perDay), target: '≥ 3 typical' });
  if (loop) {
    facts.push({ label: 'Closed loop', value: `${Math.round(loop.closedLoopPct)}% of the time`, target: '> 90%' });
    facts.push({ label: 'Open loop', value: `${Math.round(loop.manualMinutesPerDay)} min/day · ${loop.manualEpisodeCount} episodes` });
    const used = loop.overrideOutcomes.reduce((a, o) => a + o.count, 0);
    if (used) facts.push({ label: 'Overrides used', value: `${used}× · ${Math.round(loop.overrideOutcomes.reduce((a, o) => a + o.totalMinutes, 0) / 60)} h total` });
  }
  return {
    ...base,
    window: loop ? `Loop use ${windowLabel(loop.windowDays).toLowerCase()}` : undefined,
    facts,
    tables: carbs ? [{ caption: `Carb entries by time of day (per day, last ${carbs.spanDays} days of records)`, columns: ['Block', 'Entries', 'Carbs'], rows: carbs.rows }] : undefined,
    notes: [
      ...(m.basalIsScheduled ? ['Basal is the Loop schedule total, not measured delivery: this source does not report basal. Loop adjusts basal continuously, so delivered basal will differ.'] : []),
      'Unlike Omnipod 5 (where only Target Glucose drives Automated Mode), Loop’s basal schedule, insulin sensitivity, carb ratio and max basal all feed its automation.',
    ],
  };
}

function correctionsSection(s: DataSnapshot): ReportSection | null {
  const c = usable(s.correctionOutcomes);
  const tb = usable(s.tempBasalUse);
  if (!c && !tb) return null;
  const facts: ReportFact[] = [];
  if (c) {
    facts.push({ label: 'Clean corrections read', value: `${c.clean} of ${c.candidates} ${c.candidates === 1 ? 'bolus' : 'boluses'} without food` });
    if (c.clean > 0) {
      facts.push({ label: 'Median dose · glucose at dose', value: `${n2(c.medianUnits ?? 0)} U · ${c.medianStartMgdl ?? '—'} mg/dL` });
      for (const [label, hz] of [['2-hour', c.at2h], ['3-hour', c.at3h]] as const) {
        facts.push({
          label: `${label} change vs ISF-predicted`,
          value: `${signed(hz.medianObservedMgdl)} vs ${signed(hz.medianPredictedMgdl)} mg/dL${hz.medianAchievedPct != null ? ` · ${hz.medianAchievedPct}%` : ''}`,
        });
      }
      facts.push({ label: 'Followed by a low within 3 h', value: `${c.followedByLow} of ${c.clean}` });
    }
  }
  if (tb) {
    facts.push({ label: `Time at max basal (${n2(tb.maxBasalRate)} U/h)`, value: `${n1(tb.atMaxPct)}% · ${Math.round(tb.atMaxMinutesPerDay)} min/day` });
    facts.push({ label: 'Zero temps', value: `${n1(tb.zeroEpisodesPerDay)}/day · ${Math.round(tb.zeroMinutesPerDay)} min/day` });
  }
  const windowDays = c?.windowDays ?? tb?.windowDays ?? 0;
  return {
    id: 'corrections',
    tab: 'insights',
    title: 'Correction boluses and temp basals',
    window: `${windowLabel(windowDays)}${tb ? ` · temp basals on ${tb.daysWithTemps} days` : ''}`,
    facts,
    notes: [
      ...(c
        ? [
            'A clean correction is a bolus of 0.5 U or more with no carb entry from 3 h before to 3 h after and little other bolus insulin around it. Predicted change is dose × ISF on file × the share of the dose acted by then (the app’s insulin curve); the percentage is observed ÷ predicted.',
            'Loop keeps adjusting temp basals after a correction, so this reads the whole system’s response, not ISF alone.',
          ]
        : []),
      ...(tb ? [] : ['Time at max basal and zero temps need temp-basal records (Nightscout); this source has none.']),
    ],
  };
}

// ── Trends to act on ───────────────────────────────────────────────────────

function actSection(s: DataSnapshot, mode: ReportMode, range: ReportRange): ReportSection {
  // Priority order follows the clinician workflow: lows first, then highs,
  // then automation and settings. Each row names the lever worth reviewing,
  // never a value to set.
  const rows: string[][] = [];
  // Hypoglycaemia events lead: how often and when is the first question.
  const hypo = usable(s.hypoEvents)?.[range];
  if (hypo && hypo.daysCovered > 0) {
    const lever = (b: HypoReport['low']) =>
      b.overnight.count * 2 >= b.all.count ? 'Overnight basal; ISF and correction range at night' : 'Basal or ISF in the hours before; meal and activity timing';
    const evidence = (b: HypoReport['low']) =>
      `${n1(b.all.perWeek)}/week · ${b.overnight.count} of ${b.all.count} overnight · median ${Math.round(b.all.medianDurationMin ?? 0)} min`;
    if (hypo.urgentLow.all.count > 0) rows.push(['1 · Low', `Urgent lows <${hypo.urgentLow.thresholdMgdl} (15+ min)`, evidence(hypo.urgentLow), lever(hypo.urgentLow)]);
    if (hypo.low.all.perWeek >= 1) rows.push(['1 · Low', `Lows <${hypo.low.thresholdMgdl} (15+ min)`, evidence(hypo.low), lever(hypo.low)]);
    // Consensus: under 4% low and 1% urgent low overall; the same lines read
    // for the night alone.
    if (hypo.overnight.lowPct >= 4 || hypo.overnight.urgentLowPct >= 1) {
      rows.push(['1 · Low', 'Overnight time below range (00–06)', `${pct(hypo.overnight.lowPct)} below ${hypo.low.thresholdMgdl} · ${pct(hypo.overnight.urgentLowPct)} below ${hypo.urgentLow.thresholdMgdl}`, 'Overnight basal; bedtime corrections and snacks']);
    }
  }
  const meals = usable(s.mealPanels);
  for (const p of meals?.panels ?? []) {
    if (hypo && p.median3to4hMgdl != null && p.median3to4hMgdl < hypo.low.thresholdMgdl) {
      rows.push(['1 · Low', `${p.label}: low 3–4 h after`, `median ${p.median3to4hMgdl} mg/dL · ${p.meals} meals`, 'Carb ratio or absorption time for this meal']);
    }
    if (p.readMeals >= 5 && p.medianRise2hMgdl != null && p.medianRise2hMgdl >= RISE_GOAL_MGDL) {
      rows.push(['2 · High', `${p.label}: 2-hour rise`, `median ${signed(p.medianRise2hMgdl)} mg/dL · ${Math.round(p.riseUnderGoalPct ?? 0)}% of ${p.readMeals} meals under ${RISE_GOAL_MGDL}`, 'Bolus timing, carb ratio, absorption time for this meal']);
    }
  }
  if (mode === 'full') {
    const c = usable(s.correctionOutcomes);
    if (c && c.clean >= 5 && c.followedByLow / c.clean >= 0.25) {
      rows.push(['1 · Low', 'Corrections followed by a low', `${c.followedByLow} of ${c.clean} clean corrections within 3 h`, 'ISF; correction range']);
    }
    if (c && c.clean >= 5 && c.at3h.medianAchievedPct != null && (c.at3h.medianAchievedPct < 60 || c.at3h.medianAchievedPct > 140)) {
      rows.push(['4 · Settings', 'Correction boluses vs ISF', `3-hour change ${c.at3h.medianAchievedPct}% of what the ISF predicts · ${c.clean} corrections`, 'ISF schedule (Loop temp basals also act)']);
    }
    const tb = usable(s.tempBasalUse);
    if (tb && tb.atMaxPct >= 5) rows.push(['3 · Loop use', 'Time at max basal', `${n1(tb.atMaxPct)}% of the time · ${Math.round(tb.atMaxMinutesPerDay)} min/day`, 'Max basal rate; basal and ISF']);
  }
  const risk = [...(usable(s.riskWindows) ?? [])].sort((a, b) => b.recurrencePct - a.recurrencePct);
  for (const w of risk.filter((x) => x.kind === 'low').slice(0, mode === 'brief' ? 3 : 8)) {
    rows.push(['1 · Low', `${w.label}`, `${w.occurrences} of ${w.weeksObserved} weeks · lowest ${w.extremeMgdl} mg/dL · ${w.confidence} evidence`, 'Basal or ISF in the hours before; activity/override timing']);
  }
  const review = usable(s.settingsReview);
  const safety = review?.items.find((i) => i.id === 'safetyLimit');
  if (safety?.reading && safety.confidence !== 'unusable') rows.push(['1 · Low', 'Time under glucose safety limit', safety.reading, 'Glucose safety limit; basal']);
  const basal = usable(s.basalInsights);
  for (const b of basal?.blocks ?? []) {
    if (b.verdict === 'drifts_down') rows.push(['1 · Low', `${b.label} fasting glucose falls`, `${n1(Math.abs(b.avgDriftPerHour))} mg/dL/h · ${b.windowCount} fasting windows · ${b.consistencyPct}% consistent`, `Basal ${formatHour(b.startHour)}–${formatHour(b.endHour % 24)}`]);
  }
  for (const w of risk.filter((x) => x.kind === 'high').slice(0, mode === 'brief' ? 3 : 8)) {
    rows.push(['2 · High', w.label, `${w.occurrences} of ${w.weeksObserved} weeks · peak ${w.extremeMgdl} mg/dL · ${w.confidence} evidence`, 'Carb ratio if after meals; basal if fasting']);
  }
  for (const b of basal?.blocks ?? []) {
    if (b.verdict === 'drifts_up') rows.push(['2 · High', `${b.label} fasting glucose rises`, `${n1(b.avgDriftPerHour)} mg/dL/h · ${b.windowCount} fasting windows · ${b.consistencyPct}% consistent`, `Basal ${formatHour(b.startHour)}–${formatHour(b.endHour % 24)}`]);
  }
  const trends = usable(s.timeTrends);
  const worstHour = trends ? worstBucket(trends.byHourOfDay) : null;
  if (worstHour) rows.push(['2 · High', `Weakest hour: ${worstHour.label}`, `${Math.round(worstHour.inRangePct)}% in range · ${Math.round(worstHour.lowPct)}% low · ${Math.round(worstHour.highPct)}% high`, worstHour.lowPct > worstHour.highPct ? 'Lows: basal/ISF before this hour' : 'Highs: meal timing, carb ratio']);
  const loop = usable(s.loopMode);
  if (loop && loop.closedLoopPct < 90) rows.push(['3 · Loop use', 'Closed loop below 90%', `${Math.round(loop.closedLoopPct)}% closed loop · ${Math.round(loop.manualMinutesPerDay)} min/day open`, 'CGM/pump connectivity; why Loop is open']);
  for (const o of loop?.overrideOutcomes.filter((x) => x.verdict === 'review') ?? []) {
    rows.push(['3 · Loop use', `Override “${o.name}”`, `${o.count} uses · TIR ${o.tirPct == null ? '—' : `${Math.round(o.tirPct)}%`} vs ${Math.round(o.baselineTirPct)}% otherwise`, 'Override target, sensitivity % or duration']);
  }
  // Only the settings that are dosing levers; delivery limits and insulin
  // duration stay in Analyses, where their readings are context.
  const LEVERS: Partial<Record<string, string>> = {
    basalRates: 'Basal schedule, by time block',
    insulinSensitivity: 'ISF schedule',
    carbRatio: 'Carb ratio schedule',
    correctionRange: 'Correction range',
    preMealRange: 'Pre-meal preset range',
    absorptionPresets: 'Absorption time chosen at carb entry',
  };
  for (const i of review?.items ?? []) {
    const lever = LEVERS[i.id];
    if (!lever || !i.reading || i.confidence === 'unusable' || (mode === 'brief' && i.confidence !== 'good')) continue;
    rows.push(['4 · Settings', i.label, `On file ${i.current} · observed ${i.reading} · ${confidenceLabel(i.confidence).toLowerCase()}`, lever]);
  }
  // Stable: rows keep their order within a priority.
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    id: 'act',
    tab: 'insights',
    title: 'Trends to act on',
    window: review ? `Settings evidence ${windowLabel(review.windowDays).toLowerCase()}; patterns need at least 3 recurring weeks` : undefined,
    summary: rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}, ordered lows first, then highs, Loop use and settings evidence.` : 'No pattern has cleared the evidence thresholds yet.',
    tables: rows.length ? [{ columns: ['Priority', 'Pattern', 'Evidence', 'Lever to review'], rows }] : undefined,
    notes: ['Review points for the care team, not instructions. Each pattern is gated on repeated weeks; “limited evidence” rows are context, not conclusions.'],
  };
}

// ── Hour & day ─────────────────────────────────────────────────────────────

function agpSection(s: DataSnapshot, range: ReportRange, mode: ReportMode, bands: { lowMgdl: number; highMgdl: number }): ReportSection {
  const base: ReportSection = { id: 'agp', tab: 'agp', title: 'Ambulatory glucose profile (AGP)' };
  const a = usable(s.agp)?.[range];
  const filled = a?.bins.filter((b) => b.p50 != null) ?? [];
  if (!a || filled.length === 0) return { ...base, unavailable: 'Not enough CGM readings in this period to draw the profile.' };
  const maxP95 = Math.max(...filled.map((b) => b.p95 ?? 0));
  const peak = filled.reduce((x, b) => (b.p50! > x.p50! ? b : x));
  const trough = filled.reduce((x, b) => (b.p50! < x.p50! ? b : x));
  const widest = filled.reduce((x, b) => (b.p95! - b.p5! > x.p95! - x.p5! ? b : x));
  const row = (b: (typeof a.bins)[number]) => [clock(b.minute - 15), ...[b.p5, b.p25, b.p50, b.p75, b.p95].map((v) => (v == null ? '—' : String(v)))];
  return {
    ...base,
    window: `${a.daysCovered} of ${a.windowDays} days · CGM active ${Math.round(a.wearPct)}%`,
    summary: `Median glucose is highest around ${clock(peak.minute)} (${peak.p50} mg/dL) and lowest around ${clock(trough.minute)} (${trough.p50} mg/dL). The widest spread is around ${clock(widest.minute)}, ${widest.p5}–${widest.p95} mg/dL (5th–95th percentile).`,
    agp: {
      bins: a.bins.map(({ minute, p5, p25, p50, p75, p95 }) => ({ minute, p5, p25, p50, p75, p95 })),
      lowMgdl: bands.lowMgdl,
      highMgdl: bands.highMgdl,
      yMax: Math.min(400, Math.max(300, Math.ceil(maxP95 / 50) * 50)),
    },
    // Every two hours, in mg/dL: the curve's numbers for anyone reading on paper.
    tables:
      mode === 'full'
        ? [{ caption: 'Percentiles by time of day (mg/dL)', columns: ['From', '5th', '25th', 'Median', '75th', '95th'], rows: a.bins.filter((_, i) => i % 4 === 0).map(row) }]
        : undefined,
    notes: [
      `Every day of the period overlaid on one 24-hour axis. Line: median. Dark band: 25th–75th percentile (the usual day). Light band: 5th–95th percentile (the excursions). Dashed lines: the patient’s range ${bands.lowMgdl}–${bands.highMgdl} mg/dL.`,
      'Smoothed over a 1-hour moving window; times of day with fewer than 10 readings are left blank.',
      ...(a.wearPct < 70 || a.daysCovered < 10 ? ['Less than the consensus minimum of 14 days at 70% CGM wear: the curve may not represent a typical day.'] : []),
    ],
  };
}

function mealsSection(s: DataSnapshot, mode: ReportMode): ReportSection | null {
  const mp = usable(s.mealPanels);
  if (!mp) return null;
  const base: ReportSection = { id: 'meals', tab: 'agp', title: 'Meals: breakfast, lunch and dinner' };
  if (mp.panels.every((p) => p.meals === 0)) return { ...base, window: windowLabel(mp.windowDays), unavailable: 'No carb entries of 10 g or more in this window.' };
  const mg = (v: number | null) => (v == null ? '—' : String(v));
  const lead = (v: number | null) => (v == null ? '—' : v === 0 ? 'At entry' : v > 0 ? `${v} min before` : `${-v} min after`);
  const name = (p: (typeof mp.panels)[number]) => `${p.label} ${String(p.fromHour).padStart(2, '0')}–${String(p.toHour).padStart(2, '0')}`;
  const full = mode === 'full';
  return {
    ...base,
    window: `${windowLabel(mp.windowDays)} · ${mp.daysWithData} days with CGM data`,
    tables: [
      full
        ? {
            columns: ['Meal', 'Days logged', 'Carbs', 'Pre-meal', '2-h change', `Rise <${RISE_GOAL_MGDL}`, '3–4 h', 'Bolus'],
            rows: mp.panels.map((p) => [
              name(p),
              `${Math.round(p.loggedDaysPct)}% · ${p.meals}`,
              p.medianCarbsG == null ? '—' : `${p.medianCarbsG} g`,
              mg(p.medianPreMgdl),
              signed(p.medianRise2hMgdl),
              p.riseUnderGoalPct == null ? '—' : `${Math.round(p.riseUnderGoalPct)}%`,
              mg(p.median3to4hMgdl),
              lead(p.medianLeadMin),
            ]),
          }
        : {
            columns: ['Meal', 'Days logged', 'Pre-meal', '2-h change', '3–4 h'],
            rows: mp.panels.map((p) => [name(p), `${Math.round(p.loggedDaysPct)}%`, mg(p.medianPreMgdl), signed(p.medianRise2hMgdl), mg(p.median3to4hMgdl)]),
          },
    ],
    notes: [
      `Medians in mg/dL. The meal is each day’s first carb entry of 10 g or more in the window. Pre-meal is the reading at the entry; 2-h change is the reading two hours later minus pre-meal (AID consensus goal: a rise under ${RISE_GOAL_MGDL} mg/dL); 3–4 h is the mean from three to four hours after.`,
      ...(full ? ['Bolus is the bolus nearest the entry, from 60 minutes before to 30 after; “before” is a pre-bolus.'] : []),
      'Days logged is the share of days with CGM data that have an entry in the window. A missing entry may be an unlogged meal, a skipped one, or one eaten outside these hours.',
    ],
  };
}

function hourlySection(s: DataSnapshot, mode: ReportMode): ReportSection | null {
  const t = usable(s.timeTrends);
  if (!t) return null;
  const hours: HourBar[] = t.byHourOfDay.map((b) => ({
    label: hourLabel(b.key),
    lowPct: b.lowPct,
    inRangePct: b.inRangePct,
    highPct: b.highPct,
    avgMgdl: b.avgMgdl,
    readings: b.readingCount,
  }));
  const row = (b: (typeof t.byHourOfDay)[number]) => [b.label, b.avgMgdl == null ? '—' : String(Math.round(b.avgMgdl)), `${Math.round(b.inRangePct)}%`, `${Math.round(b.lowPct)}%`, `${Math.round(b.highPct)}%`];
  return {
    id: 'hourly',
    tab: 'agp',
    title: 'Hour by hour',
    window: `All loaded history · in range ${t.targetLowMgdl}–${t.targetHighMgdl} mg/dL`,
    hours,
    tables: mode === 'full' ? [{ columns: ['Hour', 'Mean', 'In range', 'Low', 'High'], rows: t.byHourOfDay.filter((b) => b.readingCount > 0).map(row) }] : undefined,
    notes: ['Each bar is one hour of the day across every loaded day: red share low, green in range, amber high.'],
  };
}

function dayByDaySection(s: DataSnapshot): ReportSection | null {
  const t = usable(s.timeTrends);
  if (!t) return null;
  const week = t.rhythmByRange['7d'] ?? [];
  const month = t.rhythmByRange['30d'] ?? [];
  const fmt = (iso: string, span = 1) => {
    const d = new Date(iso);
    const label = d.toLocaleDateString(undefined, { weekday: span === 1 ? 'short' : undefined, month: 'short', day: 'numeric' });
    return span === 1 ? label : `${label} +${span - 1}d`;
  };
  return {
    id: 'days',
    tab: 'daily',
    title: 'Day by day',
    tables: [
      { caption: 'Last 7 days', columns: ['Day', 'In range', 'Readings'], rows: week.filter((d) => !d.isFuture).map((d) => [fmt(d.dateIso), d.tirPct == null ? '—' : `${Math.round(d.tirPct)}%`, String(d.readingCount)]) },
      { caption: 'Last 30 days in 5-day blocks', columns: ['From', 'In range', 'Readings'], rows: month.map((d) => [fmt(d.dateIso, d.spanDays), d.tirPct == null ? '—' : `${Math.round(d.tirPct)}%`, String(d.readingCount)]) },
      {
        caption: 'By weekday',
        columns: ['Weekday', 'Mean', 'In range', 'Low', 'High'],
        rows: t.byDayOfWeek.filter((b) => b.readingCount > 0).map((b) => [b.label, b.avgMgdl == null ? '—' : String(Math.round(b.avgMgdl)), `${Math.round(b.inRangePct)}%`, `${Math.round(b.lowPct)}%`, `${Math.round(b.highPct)}%`]),
      },
    ],
  };
}

function weekdayHourSection(s: DataSnapshot): ReportSection | null {
  const g = usable(s.dayHourGrid);
  if (!g) return null;
  // Monday-first, like the app's day report.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const heatmap: HeatRow[] = order.map((wd) => {
    const d = g.days.find((x) => x.weekday === wd);
    return {
      label: WEEKDAYS[wd],
      cells: Array.from({ length: 24 }, (_, h) => {
        const c = d?.hours.find((x) => x.hour === h);
        return c && c.reliable && c.inRangePct != null
          ? { lowPct: c.lowPct ?? 0, inRangePct: c.inRangePct, highPct: c.highPct ?? 0, medianMgdl: c.medianMgdl }
          : null;
      }),
    };
  });
  return {
    id: 'weekdayHour',
    tab: 'daily',
    title: 'Weekday × hour',
    window: `${g.weeksObserved} weeks observed · a cell needs 3 sampled weeks`,
    heatmap,
    notes: ['Each cell is one weekday-hour across weeks, labelled with its median mg/dL. Red where 10% or more of readings were low; amber where highs outnumber in-range readings; green otherwise. Blank cells lack evidence.'],
  };
}

// ── Settings ───────────────────────────────────────────────────────────────

function settingsSection(t: LoopTherapy, mode: ReportMode): ReportSection {
  const captured = new Date(t.capturedIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return {
    id: 'settings',
    tab: 'devices',
    title: 'Loop therapy settings',
    window: `Confirmed against Loop ${captured}`,
    facts: [
      { label: 'Correction range', value: rangeSpanText(t.correctionRange) },
      { label: 'Pre-meal range', value: `${t.preMealRange.low}–${t.preMealRange.high} mg/dL` },
      { label: 'Glucose safety limit', value: `${t.glucoseSafetyLimitMgdl} mg/dL` },
      { label: 'Basal rates', value: `${spanText(t.basalSchedule, 'U/h')} · ${n2(scheduleDailyTotal(t.basalSchedule))} U/day` },
      { label: 'Insulin sensitivity', value: spanText(t.insulinSensitivitySchedule, 'mg/dL/U') },
      { label: 'Carb ratio', value: spanText(t.carbRatioSchedule, 'g/U') },
      { label: 'Max basal rate', value: `${n2(t.maxBasalRate)} U/h` },
      { label: 'Max bolus', value: `${n2(t.maxBolus)} U` },
      { label: 'Insulin duration', value: `${n1(t.insulinDurationHours)} h` },
    ],
    tables:
      mode === 'full'
        ? [
            { caption: 'Correction range', columns: ['Start', 'End', 'mg/dL'], rows: segmentRows(t.correctionRange, (e) => `${e.low}–${e.high}`) },
            scheduleTable('Basal rates', 'U/h', t.basalSchedule),
            scheduleTable('Insulin sensitivity (1 U lowers glucose by)', 'mg/dL', t.insulinSensitivitySchedule),
            scheduleTable('Carb ratio (1 U covers)', 'g', t.carbRatioSchedule),
          ]
        : undefined,
    notes: [
      'In Loop the basal schedule, insulin sensitivity, carb ratio and correction range all drive automated dosing, unlike Omnipod 5 where basal programmes only affect Manual Mode.',
      'Transcribed by the patient from the Loop app; LoopStack reads but never writes Loop settings. Confirm against the device before acting on any value.',
    ],
  };
}

// ── Analyses (Full) ────────────────────────────────────────────────────────

function reviewSection(s: DataSnapshot): ReportSection {
  const base: ReportSection = { id: 'review', tab: 'analyses', title: 'Every setting compared with observed data' };
  const review = usable(s.settingsReview);
  if (!review) return { ...base, unavailable: 'The settings review needs glucose, insulin and carb history.' };
  return {
    ...base,
    window: windowLabel(review.windowDays),
    tables: [{ columns: ['Setting', 'On file', 'Observed', 'Evidence'], rows: review.items.map((i) => [i.label, i.current, i.reading ?? '—', confidenceLabel(i.confidence)]) }],
    bullets: review.items.map((i) => `${i.label}: ${i.evidence}${i.note ? ` ${i.note}` : ''}`),
    notes: ['Observed values are retrospective estimates (autotune-style, damped 20%), shown for review with the care team. They are not dose or setting instructions.'],
  };
}

function basalSection(s: DataSnapshot): ReportSection | null {
  const b = usable(s.basalInsights);
  if (!b) return null;
  return {
    id: 'basal',
    tab: 'analyses',
    title: 'Basal and fasting analysis',
    window: windowLabel(b.windowDays),
    facts: [
      { label: 'Scheduled basal', value: `${n2(b.scheduledDailyU)} U/day` },
      { label: 'Delivered basal', value: b.deliveredDailyU == null ? 'Not reported by source' : `${n2(b.deliveredDailyU)} U/day` },
      ...(b.deliveryDeltaU != null ? [{ label: 'Delivered − scheduled', value: `${b.deliveryDeltaU > 0 ? '+' : ''}${n2(b.deliveryDeltaU)} U/day` }] : []),
      { label: 'Clean fasting windows', value: String(b.fastingWindows.length) },
    ],
    tables: [
      {
        columns: ['Block', 'Windows', 'Drift (mg/dL/h)', 'Consistency', 'Reading'],
        rows: b.blocks.map((x) => [
          x.label,
          String(x.windowCount),
          x.windowCount ? `${x.avgDriftPerHour > 0 ? '+' : ''}${n1(x.avgDriftPerHour)}` : '—',
          x.windowCount ? `${x.consistencyPct}%` : '—',
          x.verdict === 'flat' ? 'Flat' : x.verdict === 'drifts_up' ? 'Drifts up' : x.verdict === 'drifts_down' ? 'Drifts down' : 'Building',
        ]),
      },
    ],
    bullets: b.suggestions.length ? b.suggestions : undefined,
    notes: ['Fasting windows exclude carbs and active bolus insulin, so drift there is attributable to background insulin and its interaction with Loop temp basals.'],
  };
}

function autotuneSection(s: DataSnapshot): ReportSection | null {
  const a = usable(s.autotune);
  if (!a) return null;
  const implied = (v: number | null, unit: string) => (v == null ? 'Not enough data' : `${n1(v)} ${unit}`);
  return {
    id: 'autotune',
    tab: 'analyses',
    title: 'Retrospective tuning read',
    window: `${a.daysWithData} days with data of ${a.windowDays}`,
    facts: [
      { label: 'ISF on file → observed (damped)', value: `${n1(a.isf.current)} → ${implied(a.isf.damped, 'mg/dL/U')}` },
      { label: 'Carb ratio on file → observed (damped)', value: `${n1(a.carbRatio.current)} → ${implied(a.carbRatio.damped, 'g/U')}` },
      { label: 'Basal scheduled → implied', value: `${n2(a.basal.scheduledDailyU)} → ${n2(a.basal.impliedDailyU)} U/day` },
      { label: 'Carb logging coverage', value: `${a.carbQuality.coveragePct}% of days · ${a.carbQuality.mealCount} meals` },
      { label: 'Unannounced-meal share', value: `${a.carbQuality.uamSharePct}%` },
      ...(a.iobAgreement
        ? [{ label: 'Insulin history vs Loop IOB', value: `${Math.round(a.iobAgreement.agreementPct)}% agreement${a.iobAgreement.trustworthy ? '' : ' · below trust threshold'}` }]
        : []),
    ],
    bullets: [a.isf.note, a.carbRatio.note, a.basal.note, a.carbQuality.note, ...a.suggestions].filter(Boolean),
    notes: ['Modelled on oref0 autotune: deviations from predicted glucose are attributed to basal, ISF or carb ratio and damped 20% per run. Confidence is graded per lever.'],
  };
}

function riskSection(s: DataSnapshot): ReportSection | null {
  const risk = usable(s.riskWindows);
  if (!risk) return null;
  return {
    id: 'risk',
    tab: 'analyses',
    title: 'Recurring low and high windows',
    summary: risk.length ? undefined : 'No window has recurred in at least three observed weeks.',
    tables: risk.length
      ? [{
          columns: ['Window', 'Type', 'Weeks seen', 'Extreme', 'Evidence'],
          rows: [...risk]
            .sort((a, b) => b.recurrencePct - a.recurrencePct)
            .map((w) => [
              `${w.weekday == null ? 'Most days' : WEEKDAYS[w.weekday]} ${formatHour(w.startHour)}–${formatHour(w.endHour)}`,
              w.kind === 'low' ? 'Low' : 'High',
              `${w.occurrences}/${w.weeksObserved}`,
              `${w.extremeMgdl} mg/dL`,
              w.confidence === 'good' ? 'Good' : 'Limited',
            ]),
        }]
      : undefined,
  };
}

function absorptionSection(s: DataSnapshot): ReportSection | null {
  const a = usable(s.absorptionInsights);
  if (!a) return null;
  const mins = (m: number | null) => (m == null ? '—' : `${Math.round(m)} min`);
  const verdict: Record<string, string> = { matches: 'Matches', finishes_early: 'Finishes early', outlasts: 'Outlasts preset', building: 'Building' };
  return {
    id: 'absorption',
    tab: 'analyses',
    title: 'Observed carb absorption',
    window: `${windowLabel(a.windowDays)} · ${a.cleanMeals} of ${a.totalMeals} meals read cleanly`,
    tables: [
      {
        caption: 'By absorption preset',
        columns: ['Preset', 'Meals', 'Median peak', '90% absorbed', 'Reading'],
        rows: a.presets.map((p) => [`${n1(p.presetHours)} h · ${p.modelLabel}`, String(p.mealCount), mins(p.medianMinutesToPeak), mins(p.medianMinutesTo90), verdict[p.verdict] ?? p.verdict]),
      },
      ...(a.foods.length
        ? [{
            caption: 'Repeated foods',
            columns: ['Food', 'Meals', 'Median carbs', '90% absorbed', 'Closest preset'],
            rows: a.foods.map((f) => [f.label, String(f.mealCount), `${Math.round(f.medianGrams)} g`, mins(f.medianMinutesTo90), f.closestPresetHours == null ? '—' : `${n1(f.closestPresetHours)} h`]),
          }]
        : []),
    ],
    notes: [a.dataNote, 'Absorption is inferred from glucose deviations and inherits any ISF/carb-ratio error. Overlapping meals are excluded.'].filter(Boolean),
  };
}

function loopSection(s: DataSnapshot): ReportSection | null {
  const l = usable(s.loopMode);
  if (!l) return null;
  return {
    id: 'loop',
    tab: 'analyses',
    title: 'Loop operation and overrides',
    window: windowLabel(l.windowDays),
    facts: [
      { label: 'Closed loop', value: `${Math.round(l.closedLoopPct)}% of the time` },
      { label: 'Open loop', value: `${Math.round(l.manualMinutesPerDay)} min/day · ${l.manualEpisodeCount} episodes` },
      { label: 'Longest open-loop stretch', value: `${Math.round(l.longestManualMinutes)} min` },
      ...(l.peakManualHour != null ? [{ label: 'Open loop clusters around', value: formatHour(l.peakManualHour) }] : []),
    ],
    tables: l.overrideOutcomes.length
      ? [{
          caption: 'Overrides (Loop’s equivalent of Omnipod Activity)',
          columns: ['Override', 'Uses', 'TIR during', 'TIR otherwise', 'Reading'],
          rows: l.overrideOutcomes.map((o) => [o.name, String(o.count), o.tirPct == null ? '—' : `${Math.round(o.tirPct)}%`, `${Math.round(o.baselineTirPct)}%`, o.verdict === 'working' ? 'Working' : o.verdict === 'review' ? 'Review' : 'Building']),
        }]
      : undefined,
    bullets: l.suggestions.length ? l.suggestions : undefined,
  };
}

function lifestyleSection(s: DataSnapshot, range: ReportRange): ReportSection | null {
  const m = usable(s.metrics)?.[range];
  if (!m || (m.steps === 0 && m.exerciseMinutes === 0 && m.sleepHours === 0)) return null;
  return {
    id: 'lifestyle',
    tab: 'analyses',
    title: 'Activity and sleep (Apple Health, daily average)',
    facts: [
      { label: 'Steps', value: Math.round(m.steps).toLocaleString() },
      { label: 'Exercise', value: `${Math.round(m.exerciseMinutes)} min` },
      { label: 'Sleep', value: `${n1(m.sleepHours)} h` },
    ],
  };
}

export function feedbackSection(f: ClaudeFeedback): ReportSection {
  return {
    id: 'claude',
    tab: 'insights',
    title: 'Discussion notes drafted by Claude',
    window: `${f.model} · ${new Date(f.generatedIso).toLocaleString()}`,
    aiGenerated: true,
    summary: f.overview,
    bullets: f.observations.map((o) => `${o.title}: ${o.detail} (Evidence: ${o.evidence})`),
    tables: f.discussionQuestions.length
      ? [{ caption: 'Questions to discuss', columns: ['#', 'Question'], rows: f.discussionQuestions.map((q, i) => [String(i + 1), q]) }]
      : undefined,
    notes: [
      ...f.dataGaps.map((g) => `Data gap: ${g}`),
      'AI-generated from the report sections only. Not reviewed by a clinician; may contain errors. Not a recommendation to change therapy.',
    ],
  };
}

// ── report ──────────────────────────────────────────────────────────────────

export function buildClinicReport(input: {
  snapshot: DataSnapshot;
  therapy: LoopTherapy;
  mode: ReportMode;
  range: ReportRange;
  sourceLabel: string;
  patientName?: string;
  feedback?: ClaudeFeedback | null;
  now: Date;
}): ClinicReport {
  const { snapshot: s, therapy, mode, range, now } = input;
  const days = RANGE_DAYS[range];
  const m = usable(s.metrics)?.[range];
  const full = mode === 'full';

  const hypo = usable(s.hypoEvents)?.[range];
  const bands = {
    lowMgdl: m?.targetLowMgdl ?? hypo?.low.thresholdMgdl ?? 70,
    highMgdl: m?.targetHighMgdl ?? 180,
  };

  const candidates: (ReportSection | null)[] = [
    glanceSection(s),
    glucoseSection(s, range),
    lowsSection(s, range, mode),
    insulinSection(s, range, now),
    full ? correctionsSection(s) : null,
    actSection(s, mode, range),
    input.feedback ? feedbackSection(input.feedback) : null,
    agpSection(s, range, mode, bands),
    hourlySection(s, mode),
    mealsSection(s, mode),
    full ? dayByDaySection(s) : null,
    weekdayHourSection(s),
    settingsSection(therapy, mode),
    ...(full ? [reviewSection(s), basalSection(s), autotuneSection(s), riskSection(s), absorptionSection(s), loopSection(s), lifestyleSection(s, range)] : []),
  ];
  const sections = candidates.filter((x): x is ReportSection => x != null);

  const used: DataResult<unknown>[] = [s.metrics, s.riskWindows, s.timeTrends, s.basalInsights, s.loopMode, s.settingsReview, s.dayHourGrid, s.hypoEvents, s.agp, s.mealPanels];
  if (full) used.push(s.autotune, s.absorptionInsights, s.correctionOutcomes, s.tempBasalUse);
  const sample = used.some(isSample);

  return {
    mode,
    range,
    title: mode === 'brief' ? 'Diabetes data summary — brief' : 'Diabetes data summary — full settings overview',
    generatedIso: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    period: { startIso: new Date(now.getTime() - days * DAY).toISOString(), endIso: now.toISOString(), days, daysCovered: m?.daysCovered ?? null },
    sourceLabel: input.sourceLabel,
    patientName: (input.patientName ?? '').trim().slice(0, 80),
    thresholds: m ? { urgentLowMgdl: m.urgentLowMgdl, lowMgdl: m.targetLowMgdl, highMgdl: m.targetHighMgdl, veryHighMgdl: 250 } : null,
    sample,
    sections,
    disclaimer:
      'Generated by LoopStack, a personal data tool, from CGM, insulin and carb records the patient connected. LoopStack is not a medical device. It does not control insulin delivery and never writes to Loop. Observations are retrospective and descriptive; any therapy change should be made by the patient with their care team.',
  };
}

/** Sections grouped under their tabs, in tab order, skipping empty tabs. */
export function sectionsByTab(report: ClinicReport): { tab: (typeof REPORT_TABS)[number]; sections: ReportSection[] }[] {
  return REPORT_TABS.map((tab) => ({ tab, sections: report.sections.filter((x) => x.tab === tab.id) })).filter((g) => g.sections.length > 0);
}

/** Exactly what is sent to Claude: the report minus the patient's name and
 *  chart-only data. The renderer shows this verbatim before anything is sent. */
export function reportForClaude(report: ClinicReport): string {
  const { patientName: _omit, ...rest } = report;
  void _omit;
  return JSON.stringify(
    { ...rest, sections: rest.sections.filter((x) => !x.aiGenerated).map(({ heatmap: _h, agp: _a, ...x }) => (void _h, void _a, x)) },
    null,
    2,
  );
}
