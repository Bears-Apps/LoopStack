// Your next build: the staged suggestions, as a Claude-ready brief (Export)
// and as the payload the main process turns into patches (Build). The values
// are LoopStack's readings; the main process re-checks SAFE-5a before any commit.
import { CONFIDENCE_LABEL, eligibleForBuild, fmtValue, readingLine, stepOf, type Suggestion } from './suggestions';
import type { Tracked } from './tracked';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface NextItem { id: string; kind: Suggestion['kind']; target: Suggestion['target']; label: string; unit: string; current: number; reading: number; confidence: Suggestion['confidence']; evidence: string; scope?: number | string; grams?: number; buildAs: 'branch' | 'code' }
export interface NextBuildBridge {
  exportBrief: (input: { markdown: string }) => Promise<Result<{ canceled?: boolean; path?: string }>>;
  preview: (input: { items: NextItem[] }) => Promise<Result<{ patches: { path: string; title: string; patch: string; dosing: true; files: { path: string; isNew: boolean; added: number; removed: number }[] }[]; skipped: { id: string; reason: string }[] }>>;
  commit: (input: { items: NextItem[]; reviewed: boolean; confirmDosing: boolean }) => Promise<Result<{ commit: { sha: string; url: string } }>>;
}
export const nextBuildBridge = (): NextBuildBridge | null => (window.loopstack as { nextBuild?: NextBuildBridge } | undefined)?.nextBuild ?? null;

/** The staged items as the main process takes them. Anything that fails the gate is left out here and refused there. */
export function nextItems(staged: readonly Suggestion[], tracked: Record<string, Tracked>): NextItem[] {
  return staged.filter((s) => eligibleForBuild(s).ok && s.reading != null).map((s) => ({
    id: s.id, kind: s.kind, target: s.target, label: s.label, unit: s.unit, current: s.current, reading: s.reading!, confidence: s.confidence, evidence: s.evidence, scope: s.scope, grams: s.grams, buildAs: tracked[s.id]?.buildAs ?? 'code',
  }));
}

/** A Markdown brief a Claude build session can work from directly. */
export function briefFor(staged: readonly Suggestion[], tracked: Record<string, Tracked>, today: string): string {
  const items = nextItems(staged, tracked);
  const settings = items.filter((i) => i.kind === 'setting');
  const foods = items.filter((i) => i.kind === 'food');
  const line = (i: NextItem) => {
    const s = staged.find((x) => x.id === i.id)!;
    return [
      `### ${i.label} (\`${i.id}\`)`,
      `- On file: ${fmtValue(s, i.current)} · reading: ${fmtValue(s, i.reading)} · step ${Math.round((stepOf(s) ?? 0) * 100)}%`,
      `- Confidence: ${CONFIDENCE_LABEL[i.confidence]} · evidence: ${i.evidence}`,
      `- Build as: ${i.buildAs === 'branch' ? `its own patch, \`patches/loopstack_${i.id}.patch\`, toggled in LoopStack’s Feature library` : 'folded into `patches/loopstack_proposals.patch`'}`,
      `- Plain words: ${readingLine(s)}`,
    ].join('\n');
  };
  return [
    `# LoopStack next build · ${today}`,
    '',
    'Readings from LoopStack’s measured engines (the Tuning engine and the meal ledger) that reached the top confidence grade and were added to the next build. Build them into the person’s own Loop fork (LoopWorkspace, patches applied by “4. Build Loop”).',
    '',
    '## Rules (PRODUCT.md SAFE-5a, SAFE-3)',
    '- Use the values exactly as listed. Don’t compute, round or pick different therapy values.',
    '- Settings arrive in Loop as a proposal the person confirms: a LoopStack proposals screen showing on file → reading with the evidence, with Apply and Dismiss. Apply saves through Loop’s own settings path (SettingsManager / therapy settings), so Loop’s guardrails validate it. Never overwrite settings silently at launch.',
    '- Never touch safety limits: glucose safety limit, maximum basal, maximum bolus, guardrails.',
    '- Every change here changes dosing: it needs a reviewed diff and a separate dosing confirmation in LoopStack before it’s committed.',
    '- Keep each patch minimal; match the surrounding Swift style.',
    '',
    `## Therapy settings (${settings.length})`,
    '',
    ...(settings.length ? settings.map(line) : ['None.']),
    '',
    `## Favorite foods (${foods.length})`,
    '',
    ...(foods.length ? foods.map(line) : ['None.']),
    '',
    'Favorite foods go through LoopStack’s favorites patch (`loopstack/favorites.json` → `patches/loopstack_favorites.patch`): update the matching favorite’s absorption time to the reading.',
    '',
    '## Acceptance',
    '- Each patch applies cleanly to the fork with `git apply --check`, in file-name order after the existing patches.',
    '- The proposals screen lists every setting above with its evidence; nothing changes until Apply; Dismiss leaves the setting as it was.',
    '- Applying a value outside Loop’s guardrails is refused by Loop.',
    '',
  ].join('\n');
}
