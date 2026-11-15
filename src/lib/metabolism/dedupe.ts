import type { CarbEntry, InsulinEvent } from '@/data/sources/types';

// Duplicate-event suppression for carb and insulin streams.
//
// WHY THIS EXISTS: "Avg carbs 715 g/day" on the Trends dashboard. Nothing in
// the metrics aggregator was wrong — it was fed the same meals more than once.
//
// Both back ends can hand us the same physical event twice:
//
//   • Nightscout — Loop re-uploads a treatment when a carb entry is edited, and
//     any second uploader (a spare phone, a restored backup, a bridge) posts its
//     own copy. Each lands as a distinct document with its own `_id`, so the
//     site itself never sees them as duplicates. A meal bolus treatment can also
//     carry `carbs` alongside the standalone carb treatment for the same meal.
//   • HealthKit — more than one app writing dietaryCarbohydrates (Loop plus a
//     food logger, or Loop on two devices sharing one Health store) produces two
//     samples with different UUIDs for one meal.
//
// De-duplication is by physical identity, not by document id: the same amount,
// at the same moment, is the same event. Two genuinely separate entries of an
// identical size inside the same minute do not happen in practice — and when
// they nearly do, the meal detector merges anything within 15 minutes into one
// meal anyway, so the only figure at stake is the daily total.
//
// Deliberately NOT deduplicated: same timestamp, different amount. That is a
// real split entry (a correction on top of a meal) and must keep counting twice.

/** Two events this far apart or closer are candidates for being the same one. */
const DUPLICATE_WINDOW_MS = 60_000;

/** Grams are compared at 0.1 g; units at 0.001 U — the precision each is stored with. */
const CARB_GRAM_PRECISION = 10;
const INSULIN_UNIT_PRECISION = 1000;

function ms(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Generic pass: keep the first of any run of events that carry the same
 * quantised amount within `DUPLICATE_WINDOW_MS` of each other.
 *
 * The kept copy is the earliest, so `iso` stays the moment the meal actually
 * happened rather than whenever the duplicate uploader got around to posting.
 */
function dedupeByAmount<T>(
  items: T[],
  getIso: (item: T) => string,
  getAmount: (item: T) => number,
  precision: number,
): T[] {
  // Unparseable timestamps are dropped BEFORE sorting, not during the scan: a
  // NaN comparison makes the sort order arbitrary, and the pass below relies on
  // events arriving oldest-first to tell "duplicate" from "later entry".
  const sorted = items
    .filter((item) => Number.isFinite(ms(getIso(item))))
    .sort((a, b) => ms(getIso(a)) - ms(getIso(b)));
  const kept: T[] = [];
  // amountKey -> timestamp of the most recent kept event with that amount.
  const lastKeptAt = new Map<number, number>();

  for (const item of sorted) {
    const t = ms(getIso(item));
    const key = Math.round(getAmount(item) * precision);
    const previous = lastKeptAt.get(key);
    if (previous != null && t - previous <= DUPLICATE_WINDOW_MS) continue;
    kept.push(item);
    lastKeptAt.set(key, t);
  }
  return kept;
}

/**
 * Drop duplicate carb entries. Returns entries sorted oldest-first.
 *
 * Metadata is not part of the identity check on purpose: a duplicate posted by
 * a second uploader routinely loses the food label and absorption time, and we
 * would rather keep one copy of a meal that has lost its label than count the
 * meal twice.
 */
export function dedupeCarbEntries(carbs: CarbEntry[]): CarbEntry[] {
  return dedupeByAmount(carbs, (c) => c.iso, (c) => c.grams, CARB_GRAM_PRECISION);
}

/**
 * Drop duplicate insulin events. Same rule as carbs, applied per `kind` so a
 * bolus and a temp-basal delivery of the same size at the same minute both
 * survive — they are different deliveries, not a duplicate.
 */
export function dedupeInsulinEvents(insulin: InsulinEvent[]): InsulinEvent[] {
  const byKind = new Map<InsulinEvent['kind'], InsulinEvent[]>();
  for (const ev of insulin) {
    const bucket = byKind.get(ev.kind);
    if (bucket) bucket.push(ev);
    else byKind.set(ev.kind, [ev]);
  }

  const kept: InsulinEvent[] = [];
  for (const events of byKind.values()) {
    kept.push(
      ...dedupeByAmount(events, (e) => e.iso, (e) => e.units, INSULIN_UNIT_PRECISION),
    );
  }
  return kept.sort((a, b) => ms(a.iso) - ms(b.iso));
}

/** How many events a de-duplication pass removed. Surfaced for diagnostics. */
export function duplicateCount(before: unknown[], after: unknown[]): number {
  return Math.max(0, before.length - after.length);
}
