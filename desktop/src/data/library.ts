// The feature library's bridge to the main process (electron/library.cjs).
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface LibraryItem { id: string; variants: string[]; inPatches: boolean }
export interface LibraryCommit { sha: string; message: string; date: string | null; url: string; byLoopStack: boolean }
export interface CheckResult {
  id: string;
  variant: string | null;
  /** apply: fits your Loop · applied: already in the code · conflict: no version fits */
  status: 'apply' | 'applied' | 'conflict';
  files: { path: string; isNew: boolean; added: number; removed: number }[];
  patch: string | null;
}
export interface LibraryBridge {
  list: () => Promise<Result<{ sourceSha: string; items: LibraryItem[]; patches: string[]; history: LibraryCommit[] }>>;
  check: (input: { id: string; sourceSha: string }) => Promise<Result<CheckResult>>;
  add: (input: { id: string; sourceSha: string; variant: string; reviewed: boolean; confirmDosing: boolean }) => Promise<Result<{ commit: { sha: string; url: string } }>>;
  remove: (input: { id: string }) => Promise<Result<{ commit: { sha: string; url: string } }>>;
}
export const libraryBridge = (): LibraryBridge | null => window.loopstack?.library ?? null;

// The person's own patches (electron/personal.cjs): on in patches/, off in patches/off/.
export interface MineItem { file: string; on: boolean }
export interface MineMove { name: string; to: 'on' | 'off' }
export interface MineBridge {
  list: () => Promise<Result<{ items: MineItem[] }>>;
  check: (input: { file: string }) => Promise<Result<{ file: string; on: boolean; patch: string; files: { path: string; isNew: boolean; added: number; removed: number }[] }>>;
  toggle: (input: { file: string; to: 'on' | 'off'; together?: boolean; reviewed?: boolean; confirmDosing?: boolean }) => Promise<({ ok: true; moves: MineMove[]; commit: { sha: string; url: string } }) | { ok: false; error: string; needs?: string[] }>;
}
export const mineBridge = (): MineBridge | null => (window.loopstack as { mine?: MineBridge } | undefined)?.mine ?? null;
