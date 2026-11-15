// The care-team review read: the fixed order every packet opens in (PROD-1),
// the AGP order clinicians already review in (VIS-10). Page one is glucose
// only: enough data, then lows, then time in range, then the curve.
import { blocks, diff, partOfDay, rangeLabel, USABLE_N } from './derive';
import { CHANGES, LUNCH, READ, TEXT } from './current';

export type ReadKey = 'sensor' | 'lows' | 'tir' | 'automation' | 'gmi-cv' | 'agp';

export interface ReadItem {
  key: ReadKey;
  /** Where it sits in the clinician's review order, 1-based; null for context beside the read. */
  step: number | null;
  label: string;
  value: string;
  note: string;
}

export function reviewRead(r = READ): ReadItem[] {
  return [
    { key: 'sensor', step: 1, label: 'Sensor worn', value: `${r.sensorWornPct}%`, note: 'goal over 70%' },
    { key: 'lows', step: 2, label: 'Very low · low', value: `${r.veryLowPct} · ${r.lowPct}%`, note: `below 70: ${(r.veryLowPct + r.lowPct).toFixed(1)}% · goals under 1% and 4%` },
    { key: 'tir', step: 3, label: 'In range', value: `${r.inRangePct}%`, note: `${r.inRangeSinceLastVisit == null ? '' : `${r.inRangeSinceLastVisit >= 0 ? '↑' : '↓'}${Math.abs(r.inRangeSinceLastVisit)} since the 14 days before · `}goal over 70%` },
    { key: 'automation', step: null, label: 'Time in automation', value: `${r.automationPct}%`, note: `gaps: ${r.automationGaps}` },
    { key: 'gmi-cv', step: null, label: 'GMI · CV', value: `${r.gmiPct}% · ${r.cvPct}%`, note: 'CV goal 36% or lower' },
    { key: 'agp', step: 4, label: 'AGP', value: '14 days', note: 'median, 25–75% and 5–95% bands' },
  ];
}

/** The three TLDR lines, in clinician terms (DATA-2, VIS-A3). Observations only (SAFE-1). */
export function tldrLines() {
  // The 3-hour block where Loop most often ran away from the schedule.
  const strongest = blocks()
    .filter((b) => b.verdict === 'l' || b.verdict === 'm')
    .sort((a, b) => b.counts[b.verdict] - a.counts[a.verdict] || Math.abs(diff(b.loop, b.sched)) - Math.abs(diff(a.loop, a.sched)))[0];
  const loop = strongest
    ? `Most ${partOfDay(strongest.start).many} ${rangeLabel(strongest.start, strongest.end)}, algorithm-modulated basal ran about ${Math.abs(Math.round(diff(strongest.loop, strongest.sched) * 100))}% ${strongest.verdict === 'l' ? 'below' : 'above'} the scheduled rate (${strongest.counts[strongest.verdict]} of ${USABLE_N} days).`
    : `Algorithm-modulated basal ran about as scheduled in every 3-hour block (${USABLE_N} days).`;
  const peakDrop = Math.max(...LUNCH.before.map((p) => p[1])) - Math.max(...LUNCH.after.map((p) => p[1]));
  const applied = CHANGES.filter((c) => c.status === 'applied' || c.status === 'reviewed');
  const change = applied[0];
  const since = change
    ? `${change.setting} ${change.from} → ${change.to} on ${change.date}, ${change.proposedBy} proposed${change.agreedBy ? ` and ${change.agreedBy} agreed` : ''}. Lunch peaks ${Math.abs(peakDrop)} mg/dL ${peakDrop >= 0 ? 'lower' : 'higher'}.${applied.length === 1 ? ' Nothing else changed.' : ''}`
    : `No settings changes recorded in this window. ${TEXT.lunchFinding}`;
  return [
    { key: 'pattern', title: 'Pattern', text: TEXT.pattern, section: 'glucose' as const },
    { key: 'loop', title: 'What Loop did', text: loop, section: 'loop' as const },
    { key: 'since', title: 'Since last visit', text: since, section: 'changes' as const },
  ];
}

export type ReviewSection = 'glucose' | 'loop' | 'changes' | 'trends' | 'notes';
export const REVIEW_SECTIONS: { id: ReviewSection; label: string }[] = [
  { id: 'glucose', label: 'Visit TLDR' },
  { id: 'loop', label: 'What Loop did' },
  { id: 'changes', label: 'Settings timeline' },
  { id: 'trends', label: 'Trends' },
  { id: 'notes', label: 'Notes' },
];
