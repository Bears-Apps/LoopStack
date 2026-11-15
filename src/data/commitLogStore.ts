import { useSyncExternalStore } from 'react';
import type {
  CommitLogItem,
  CommitOutcome,
  FixLogItem,
} from './types';
import { addFixLogItem } from './fixLogStore';

// Seed history — three commits representing the three outcome shapes so the
// screen communicates the 14-day tracking model even on a cold start.
const SEED: CommitLogItem[] = [
  {
    id: 'commit_seed_absorption',
    shortHash: 'a4f10b',
    fixLogId: 'fix_archive_absorption',
    committedIso: '2026-03-24T19:40:00Z',
    title: 'Late pasta absorption: 3h → 5h',
    source: 'memory',
    confidence: 'high',
    confidenceScore: 86,
    change: {
      kind: 'absorption_window',
      label: 'Late pasta absorption',
      currentValue: '3h',
      proposedValue: '5h',
    },
    explanation:
      'The late-dinner pasta pattern showed a consistent second rise past the three-hour mark. Extending absorption to five hours keeps Loop dosing through the tail of the curve.',
    rationale: [
      '12 late-pasta dinners across the 30-day window',
      'Second rise at hour 3 in 9 of 12 meals',
      'Time-in-range drops to 58% between hours 3 and 5 on this pattern',
    ],
    outcome: {
      status: 'positive',
      daysElapsed: 30,
      trackingWindowDays: 14,
      tirDeltaPct: 4.2,
      hypoEventsDelta: 0,
      summary: 'Late-meal TIR up 4.2% over the following 14 days; no new hypos.',
    },
  },
  {
    id: 'commit_seed_target',
    shortHash: '9d22c1',
    fixLogId: 'fix_archive_target',
    committedIso: '2026-04-03T09:15:00Z',
    title: 'Target low: 70 → 75 mg/dL',
    source: 'manual',
    confidence: 'medium',
    confidenceScore: 58,
    change: {
      kind: 'schedule_override',
      label: 'Target low',
      currentValue: '70 mg/dL',
      proposedValue: '75 mg/dL',
    },
    explanation:
      'Raised the lower bound of the target range to reduce overnight alerts during a heavier training block. Left the upper bound unchanged.',
    rationale: [
      'Training load up 28% vs the prior 30 days',
      'Three overnight lows in the prior week',
    ],
    outcome: {
      status: 'neutral',
      daysElapsed: 20,
      trackingWindowDays: 14,
      tirDeltaPct: 0.3,
      hypoEventsDelta: -1,
      summary: 'TIR held steady; one fewer overnight low but within noise.',
    },
  },
  {
    id: 'commit_seed_isf',
    shortHash: 'c7a9f2',
    fixLogId: 'fix_archive_isf',
    committedIso: '2026-04-18T16:22:00Z',
    title: 'Base ISF: 52 → 54 mg/dL per 1U',
    source: 'insight',
    confidence: 'high',
    confidenceScore: 80,
    change: {
      kind: 'isf',
      label: 'Base ISF',
      currentValue: '52 mg/dL per 1U',
      proposedValue: '54 mg/dL per 1U',
    },
    explanation:
      'Observed ISF had drifted above base for two weeks straight. Bumping base closes the gap without overcorrecting.',
    rationale: [
      'Observed ISF at 54 for 14 consecutive days',
      'No hypo events in that window',
    ],
    outcome: {
      status: 'tracking',
      daysElapsed: 5,
      trackingWindowDays: 14,
      summary: 'Day 5 of 14 — tracking outcome.',
    },
  },
];

const STORAGE_KEY = 'loopstack:commitLog:v1';

function loadInitial(): CommitLogItem[] {
  if (typeof window === 'undefined') return [...SEED];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED];
    const parsed = JSON.parse(raw) as CommitLogItem[];
    return Array.isArray(parsed) ? parsed : [...SEED];
  } catch {
    return [...SEED];
  }
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // storage full or unavailable — fail silently; in-memory state is still correct
  }
}

let items: CommitLogItem[] = loadInitial();
const listeners = new Set<() => void>();

function emit() {
  persist();
  for (const l of listeners) l();
}

function newId(): string {
  return `commit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function newShortHash(): string {
  // Pseudo-hash for display — 6 hex-ish chars. Not cryptographic; just Git-flavored.
  return Math.random().toString(16).slice(2, 8);
}

export function getCommitLogItems(): CommitLogItem[] {
  return items;
}

// Append a new commit built from a Fix Log item the user just implemented.
export function commitFixLogItem(fix: FixLogItem): CommitLogItem {
  const outcome: CommitOutcome = {
    status: 'tracking',
    daysElapsed: 0,
    trackingWindowDays: 14,
    summary: 'Day 0 of 14 — tracking outcome.',
  };
  const entry: CommitLogItem = {
    id: newId(),
    shortHash: newShortHash(),
    fixLogId: fix.id,
    committedIso: new Date().toISOString(),
    title: fix.title,
    source: fix.source,
    confidence: fix.confidence,
    confidenceScore: fix.confidenceScore,
    change: fix.change,
    explanation: fix.explanation,
    rationale: fix.rationale,
    outcome,
  };
  items = [entry, ...items];
  emit();
  return entry;
}

// Revert marks the commit reverted *and* stages the inverse change back into
// Fix Log so the user can re-evaluate with the reversed direction.
export function revertCommit(id: string): void {
  const target = items.find((x) => x.id === id);
  if (!target) return;

  items = items.map((x) =>
    x.id === id
      ? {
          ...x,
          outcome: {
            ...x.outcome,
            status: 'reverted',
            summary: 'Reverted — change staged back in Fix Log for review.',
          },
        }
      : x,
  );
  emit();

  addFixLogItem({
    title: `Revert: ${target.title}`,
    source: 'manual',
    sourceId: target.id,
    confidence: target.confidence,
    confidenceScore: target.confidenceScore,
    change: {
      kind: target.change.kind,
      label: target.change.label,
      currentValue: target.change.proposedValue, // swap direction
      proposedValue: target.change.currentValue,
    },
    explanation: `Rolling back ${target.shortHash}. ${target.explanation}`,
    rationale: [
      `Reverting commit ${target.shortHash}`,
      ...target.rationale,
    ],
  });
}

export function useCommitLog(): CommitLogItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getCommitLogItems,
    getCommitLogItems,
  );
}
