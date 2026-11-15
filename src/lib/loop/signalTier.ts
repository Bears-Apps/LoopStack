// How much evidence a finding has, and what that entitles it to do.
//
// One threshold used to decide two different things at once: whether a finding
// was worth showing, and whether it was worth acting on. Those are not the same
// question. A pattern that has appeared in three of the last five weeks is
// genuinely interesting — it is the thing you want to watch — and it is
// nowhere near enough to justify changing a basal rate over.
//
// Collapsing them meant everything below the acting bar was invisible, so the
// only way to notice a pattern forming was to already know it was there. For
// absorption work in particular that is backwards: watching a curve take shape
// across a few weeks IS the work.
//
// So the tiers separate visibility from permission:
//
//   established  Enough weeks behind it to stand on. Can be staged into the Fix
//                Log and committed. This is the old bar, unchanged.
//
//   emerging     Real, measured, and not yet settled. Shown, labelled
//                provisional, and deliberately NOT stageable — there is no path
//                from here to a therapy change without more weeks first.
//
//   noise        Not surfaced at all. Below this a "pattern" is mostly the
//                variance of a handful of meals.
//
// The hard rule is the second tier's: emerging findings inform, they never
// authorise. Nothing that has not cleared the established bar can reach the
// Commit Log, which is the only path in this app that ends at a real change.

export type SignalTier = 'established' | 'emerging' | 'noise';

/**
 * Established bar. Unchanged from the single threshold that preceded tiers, so
 * nothing that could be committed before becomes uncommittable now.
 */
export const ESTABLISHED_MIN = 60;

/**
 * Emerging floor. Below this the sample is small enough that the pattern is
 * more likely to be noise than signal, and showing it would train exactly the
 * wrong instinct — reacting to a shape that isn't there yet.
 */
export const EMERGING_MIN = 35;

export function tierFor(confidenceScore: number | undefined | null): SignalTier {
  if (confidenceScore == null || Number.isNaN(confidenceScore)) return 'noise';
  if (confidenceScore >= ESTABLISHED_MIN) return 'established';
  if (confidenceScore >= EMERGING_MIN) return 'emerging';
  return 'noise';
}

/**
 * The safety gate. The ONLY predicate anything should consult before offering a
 * stage/commit action — so that adding a new surface later cannot accidentally
 * open a path around the evidence bar.
 */
export function canStage(confidenceScore: number | undefined | null): boolean {
  return tierFor(confidenceScore) === 'established';
}

export function isVisible(confidenceScore: number | undefined | null): boolean {
  return tierFor(confidenceScore) !== 'noise';
}

export const TIER_LABELS: Record<Exclude<SignalTier, 'noise'>, string> = {
  established: 'Established',
  emerging: 'Early signal',
};

export const TIER_BLURBS: Record<Exclude<SignalTier, 'noise'>, string> = {
  established:
    'Enough weeks behind this to act on. It can be staged into the Fix Log and committed.',
  emerging:
    'Measured, but not settled yet — it needs more weeks before it means anything. Worth watching; not worth changing a setting over.',
};

// ── Promotion: which findings lead, and which wait to be triaged ─────────────
//
// The inbox shows everything, and everything is not equally worth your
// attention on a Tuesday. Code-surface findings are the sharp end of this: each
// one is a request to edit Loop's source and rebuild, and the engine can
// produce one for every absorption-curve mismatch it notices. A list of
// fourteen of those is not a list anyone reads.
//
// So the inbox leads with the few that have earned it and keeps the rest one
// tap away, rather than choosing between a firehose and a filter that hides
// things. Promotion is deliberately strict for `code` precisely because the ask
// is expensive.

/** Confidence a code-surface finding needs before it leads the inbox. */
export const CODE_PROMOTION_MIN = 75;

export function isPromoted(
  confidenceScore: number | undefined | null,
  surface: 'settings' | 'code' | 'behaviour',
): boolean {
  if (!canStage(confidenceScore)) return false;
  const score = confidenceScore as number;
  return surface === 'code' ? score >= CODE_PROMOTION_MIN : true;
}
