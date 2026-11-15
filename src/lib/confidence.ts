import type { ConfidenceLevel, ConfidenceScore } from '@/data/types';

// Four tiers map to UI zones: ring color, micro-label, and CTA behavior.
//   0–30  → learning    (red)           no action, just watching
//   30–60 → building    (orange)        early signal, optional tracking
//   60–80 → actionable  (yellow-green)  stage into Fix Log
//   80+   → ready       (green)         safe to implement in Loop
export type ConfidenceTier = 'learning' | 'building' | 'actionable' | 'ready';

export type ResolvedConfidence = {
  percent: number;        // 0-100 integer
  tier: ConfidenceTier;
  label: string;          // micro-label shown in/next to the ring
  color: string;          // CSS variable or hex for the ring fill
};

const LEVEL_DEFAULT_SCORE: Record<ConfidenceLevel, number> = {
  low: 25,
  medium: 55,
  high: 85,
};

const TIER_COLOR: Record<ConfidenceTier, string> = {
  learning: 'var(--confidence-learning, #c65a2c)',
  building: 'var(--confidence-building, #d98628)',
  actionable: 'var(--confidence-actionable, #a4bf3d)',
  ready: 'var(--confidence-ready, var(--brand-primary))',
};

const TIER_LABEL: Record<ConfidenceTier, string> = {
  learning: 'Learning',
  building: 'Building',
  actionable: 'Actionable',
  ready: 'Ready',
};

export function scoreToTier(pct: number): ConfidenceTier {
  if (pct < 30) return 'learning';
  if (pct < 60) return 'building';
  if (pct < 80) return 'actionable';
  return 'ready';
}

export function resolveConfidence(
  level: ConfidenceLevel,
  score?: ConfidenceScore,
): ResolvedConfidence {
  const pct = Math.max(0, Math.min(100, Math.round(score ?? LEVEL_DEFAULT_SCORE[level])));
  const tier = scoreToTier(pct);
  return { percent: pct, tier, label: TIER_LABEL[tier], color: TIER_COLOR[tier] };
}

// CTA stage determines which primary action to show on a suggestion card.
//   < 60%        → watch         (Track pattern — passive)
//   60% - 80%    → stage         (Add to Fix Log)
//   >= 80%       → implement     (Implement in Loop)
export type CtaStage = 'watch' | 'stage' | 'implement';

export function ctaStageFor(pct: number): CtaStage {
  if (pct < 60) return 'watch';
  if (pct < 80) return 'stage';
  return 'implement';
}
