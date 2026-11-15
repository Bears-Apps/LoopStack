import type { CommitLogItem, FixLogChangeKind, FixLogItem } from '@/data/types';

// Where a change actually gets made.
//
// LoopStack never writes to Loop. That is the whole contract — but it leaves a
// real question unanswered for anyone reading the Fix Log: once I decide to do
// this, WHERE do I do it? And the honest answer is not the same for every kind
// of change:
//
//   settings   Basal, ISF, carb ratio, targets. Typed into Loop's own settings
//              screens. No build, no Xcode, takes a minute.
//
//   code       Absorption presets and the insulin model constants are compiled
//              into the app. Changing them means editing the Loop source and
//              rebuilding — a different kind of task, with a different risk
//              profile, and one worth handing to an assistant with the full
//              context rather than doing from memory at 11pm.
//
//   behaviour  Split timing, pre-bolus habits. Nothing to change anywhere;
//              they are things you do differently next time.
//
// Sorting them is what lets the app stop pretending a committed item is
// "done". A committed setting is done the moment you type it into Loop. A
// committed code change is not done until a build ships to your phone.

export type ChangeSurface = 'settings' | 'code' | 'behaviour';

export const SURFACE_LABELS: Record<ChangeSurface, string> = {
  settings: 'Loop settings',
  code: 'Loop source',
  behaviour: 'Habit',
};

export const SURFACE_BLURBS: Record<ChangeSurface, string> = {
  settings:
    "Typed into Loop's own settings screens on your phone. No build required — it takes effect on the next loop cycle.",
  code: 'Compiled into the app. Needs an edit in your Loop source checkout and a rebuild to your phone before it does anything.',
  behaviour:
    'Nothing to change in Loop. This is a thing to do differently next time, and the app measures whether it helped.',
};

export function surfaceFor(kind: FixLogChangeKind): ChangeSurface {
  switch (kind) {
    case 'isf':
    case 'carb_ratio':
    case 'schedule_override':
      return 'settings';
    case 'absorption_window':
      // Loop's absorption-time choices are defined in source, not typed per
      // meal — which is exactly why a custom 3/4/6h set needs a rebuild.
      return 'code';
    case 'favorite_carbs':
      // Favorite Foods are stored in the app, edited in its own screen.
      return 'settings';
    case 'timing_split':
      return 'behaviour';
    default:
      return 'settings';
  }
}

/** Where in the Loop checkout a code change lives. Best-effort orientation, not
 *  a promise about a specific line — LoopKit moves between releases. */
const CODE_LOCATIONS: Partial<Record<FixLogChangeKind, string>> = {
  absorption_window:
    'LoopKit — the default carb absorption times offered at carb entry (commonly `CarbStore.defaultAbsorptionTimes`, surfaced through the carb entry view).',
};

export type ClaudeHandoff = {
  /** The prompt to paste into Claude alongside the Loop repo. */
  prompt: string;
  /** Plain-language version of the same change, for reading rather than pasting. */
  readMore: string;
};

type HandoffInput = {
  title: string;
  change: { kind: FixLogChangeKind; label: string; currentValue: string; proposedValue: string };
  explanation: string;
  rationale: string[];
  confidence: string;
  /** Optional upstream — a missing score is reported as such rather than as 0,
   *  which would read as "no evidence" instead of "not scored". */
  confidenceScore?: number;
};

/**
 * Build the two views of a change: one to read, one to paste.
 *
 * The prompt is written to be handed to an assistant that has the Loop
 * checkout open and does NOT have any of this app's context. So it carries the
 * evidence, the exact current and proposed values, and — the part that matters
 * most — the constraints: this is a personal medical device build, the change
 * is a starting point rather than an instruction, and nothing about dosing
 * logic should be touched on the way past.
 */
export function buildClaudeHandoff(item: HandoffInput): ClaudeHandoff {
  const surface = surfaceFor(item.change.kind);
  const location = CODE_LOCATIONS[item.change.kind];

  const readMore = [
    item.explanation,
    '',
    'Why this came up:',
    ...item.rationale.map((r) => `• ${r}`),
    '',
    `Where it changes: ${SURFACE_LABELS[surface]}. ${SURFACE_BLURBS[surface]}`,
    '',
    'LoopStack cannot make this change for you, and would not if it could — it has no view of what Loop is doing right now, and no way to undo a bad edit. Discuss it with your care team before it reaches your pump.',
  ].join('\n');

  const prompt = [
    `# Loop change request — ${item.title}`,
    '',
    '## Context for you, the assistant',
    'I run DIY Loop (LoopKit) built from source for my own Type 1 diabetes management. I have a companion analytics app (LoopStack) that reads my Nightscout/Apple Health history read-only and surfaces patterns. It never writes to Loop or my pump.',
    'This request came out of that analysis. I am the one deciding to make the change; I want your help implementing it correctly in the Loop source.',
    '',
    '## The change',
    `- Setting: ${item.change.label}`,
    `- Current: ${item.change.currentValue}`,
    `- Proposed: ${item.change.proposedValue}`,
    `- Evidence confidence: ${item.confidence}${
      item.confidenceScore != null ? ` (${item.confidenceScore}/100)` : ' (not scored)'
    }`,
    location ? `- Likely location: ${location}` : null,
    '',
    '## Evidence behind it',
    item.explanation,
    '',
    ...item.rationale.map((r) => `- ${r}`),
    '',
    '## What I want from you',
    '1. Find where this value is defined in the checkout and show me the current code before changing anything.',
    '2. Make the minimal edit to move it from the current value to the proposed one. Do not refactor around it.',
    '3. Tell me what else reads that value, so I know what the change touches.',
    '4. Point out anything that makes you think the proposed value is wrong or unsafe.',
    '',
    '## Constraints',
    '- Do NOT modify dosing algorithms, safety limits, or the insulin model unless that is literally the setting named above.',
    '- Do NOT change anything else you happen to notice while you are in there. Show me instead.',
    '- This builds to a medical device I wear. A change that is merely plausible is not good enough — if you are unsure, say so and stop.',
    '- The proposed value is a starting point from retrospective data, not a prescription. It is going to my care team before it goes to my pump.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return { prompt, readMore };
}

export function handoffForFix(item: FixLogItem): ClaudeHandoff {
  return buildClaudeHandoff({
    title: item.title,
    change: item.change,
    explanation: item.explanation,
    rationale: item.rationale,
    confidence: item.confidence,
    confidenceScore: item.confidenceScore,
  });
}

export function handoffForCommit(item: CommitLogItem): ClaudeHandoff {
  return buildClaudeHandoff({
    title: item.title,
    change: item.change,
    explanation: item.explanation,
    rationale: item.rationale,
    confidence: item.confidence,
    confidenceScore: item.confidenceScore,
  });
}
