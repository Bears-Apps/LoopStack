import { useSyncExternalStore } from 'react';
import type {
  ConfidenceLevel,
  ConfidenceScore,
  FixLogChange,
  FixLogItem,
  FixLogSourceKind,
  LoopSuggestion,
} from './types';

// Seed list — a couple of plausible items so the screen isn't empty on first
// visit. Real items get added when the user taps "Add to Fix Log".
const SEED: FixLogItem[] = [
  {
    id: 'fix_seed_isf',
    title: 'Base ISF: 50 → 54 mg/dL per 1U',
    source: 'insight',
    sourceId: 'ds_isf_sensitivity_drift',
    createdIso: '2026-04-19T16:22:00Z',
    confidence: 'high',
    confidenceScore: 82,
    change: {
      kind: 'isf',
      label: 'Base ISF',
      currentValue: '50 mg/dL per 1U',
      proposedValue: '54 mg/dL per 1U',
    },
    explanation:
      'Observed ISF has drifted 8% above base over the last 18 meals, consistent with the whole-foods-heavy, lower-saturated-fat pattern on your profile. Raising base ISF to 54 brings Loop in line with what outcomes already imply.',
    rationale: [
      '18 meals in the last 30 days back this',
      'Observed ISF (54) has stayed above base (50) across the window',
      'Dietary pattern corroborates higher sensitivity',
    ],
    status: 'staged',
  },
];

const STORAGE_KEY = 'loopstack:fixLog:v1';

function loadInitial(): FixLogItem[] {
  if (typeof window === 'undefined') return [...SEED];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED];
    const parsed = JSON.parse(raw) as FixLogItem[];
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

let items: FixLogItem[] = loadInitial();
const listeners = new Set<() => void>();

function emit() {
  persist();
  for (const l of listeners) l();
}

function newId(): string {
  return `fix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function getFixLogItems(): FixLogItem[] {
  return items;
}

export function addFixLogItem(item: Omit<FixLogItem, 'id' | 'createdIso' | 'status'>): FixLogItem {
  const full: FixLogItem = {
    ...item,
    id: newId(),
    createdIso: new Date().toISOString(),
    status: 'staged',
  };
  items = [full, ...items];
  emit();
  return full;
}

export function removeFixLogItem(id: string): void {
  items = items.filter((x) => x.id !== id);
  emit();
}

export function markFixLogImplemented(id: string): void {
  items = items.map((x) => (x.id === id ? { ...x, status: 'implemented' } : x));
  emit();
}

export function useFixLog(): FixLogItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getFixLogItems,
    getFixLogItems,
  );
}

// Helper — converts a LoopSuggestion into a FixLogItem shape. Best-effort;
// the caller can override any field before adding.
export function suggestionToFixLogDraft(
  s: LoopSuggestion,
): Omit<FixLogItem, 'id' | 'createdIso' | 'status'> {
  const change = inferChange(s);
  return {
    title: s.title,
    source: 'insight' as FixLogSourceKind,
    sourceId: s.id,
    confidence: s.confidence as ConfidenceLevel,
    confidenceScore: s.confidenceScore as ConfidenceScore | undefined,
    change,
    explanation: s.body,
    rationale: s.rationale,
  };
}

function inferChange(s: LoopSuggestion): FixLogChange {
  switch (s.kind) {
    case 'absorption_model':
      return {
        kind: 'absorption_window',
        label: 'Default absorption',
        currentValue: 'current',
        proposedValue: s.proposedChange,
      };
    case 'favorite_carbs':
      return {
        kind: 'favorite_carbs',
        label: 'Favorite carbs',
        currentValue: 'current estimate',
        proposedValue: s.proposedChange,
      };
    case 'base_setting':
      return {
        kind: s.category === 'sensitivity' ? 'isf' : 'carb_ratio',
        label: s.category === 'sensitivity' ? 'Base ISF' : 'Base setting',
        currentValue: 'current',
        proposedValue: s.proposedChange,
      };
  }
}
