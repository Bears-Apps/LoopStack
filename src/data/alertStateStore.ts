import type { ConfidenceSignal } from '@/lib/alerts/alertEngine';

// Which readings were already trustworthy last time we looked.
//
// "New trend confidence reached" is a TRANSITION, not a state — it fires when
// something crosses from unreadable into readable, and never again. That needs
// a memory of the last check, because the snapshot alone only ever says what
// is true now.
//
// The first run seeds silently. Otherwise switching a data source on for the
// first time would fire a dozen "new confidence!" notifications at once for
// readings that were simply computed for the first time, which is noise
// wearing the costume of a discovery.

const STORAGE_KEY = 'loopstack:alertState:v1';

type StoredState = {
  /** Signal ids that were readable at the last check. */
  readable: string[];
  /** False until the first check has been recorded. */
  seeded: boolean;
};

function load(): StoredState {
  if (typeof window === 'undefined') return { readable: [], seeded: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { readable: [], seeded: false };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      readable: Array.isArray(parsed.readable) ? parsed.readable : [],
      seeded: parsed.seeded === true,
    };
  } catch {
    return { readable: [], seeded: false };
  }
}

function save(state: StoredState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable — worst case a transition is announced twice.
  }
}

/**
 * Signals that became readable since the last call, recording the new state.
 *
 * Pure-ish by necessity: it both reads and advances the stored state, because
 * a transition that is reported without being recorded would be reported again
 * on the very next refresh.
 */
export function detectNewlyReadable(signals: ConfidenceSignal[]): ConfidenceSignal[] {
  const state = load();
  const nowReadable = signals.filter((s) => s.readable).map((s) => s.id);

  if (!state.seeded) {
    save({ readable: nowReadable, seeded: true });
    return [];
  }

  const previously = new Set(state.readable);
  const fresh = signals.filter((s) => s.readable && !previously.has(s.id));

  // Ids that dropped back out of readable are forgotten, so a reading that
  // recovers later is treated as news again — which it is.
  save({ readable: nowReadable, seeded: true });
  return fresh;
}

/** Forget everything — used when the data source changes underneath us. */
export function resetAlertState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
