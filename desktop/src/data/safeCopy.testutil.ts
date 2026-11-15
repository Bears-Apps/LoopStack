// Test helper: run copy through the governance gate's own checker
// (scripts/system/core.mjs), so tests fail on the same SAFE rules the gate blocks.
// @ts-ignore: plain ESM module without types
import { blocksChange, checkCopy } from '../../../scripts/system/core.mjs';

type Finding = { code: string; message?: string };
export function checkCopyAll(texts: readonly string[]): string[] {
  return texts.flatMap((t) => (checkCopy(t) as Finding[]).filter((f) => blocksChange(f)).map((f) => `${f.code}: ${t}`));
}
