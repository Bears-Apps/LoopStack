// Which dataset the app shows: the synthetic patient, or the person's own
// Nightscout once connected (desktop app only; the browser demo has no bridge).
import { DATA, useDataset } from './current';
import { buildNightscoutDataset, type NsRaw } from './nightscout';
import { SYNTHETIC } from './synthetic';

export interface NsConfig { url: string; name: string; hasToken: boolean; connected: boolean }
type Result<T> = { ok: true } & T | { ok: false; error: string };
export interface NightscoutBridge {
  config: () => Promise<NsConfig>;
  connect: (input: { url: string; token: string; name: string }) => Promise<Result<{ version: string | null }>>;
  fetch: () => Promise<Result<{ raw: NsRaw }>>;
  disconnect: () => Promise<{ ok: true }>;
}

export const bridge = (): NightscoutBridge | null => window.loopstack?.nightscout ?? null;

const PREF = 'loopstack.desktop.source';
/** The person can look at the sample patient while connected; remembered per computer. */
export function prefersSample(): boolean {
  try { return window.localStorage.getItem(PREF) === 'sample'; } catch { return false; }
}
function setPref(v: 'sample' | 'nightscout') {
  try { window.localStorage.setItem(PREF, v); } catch { /* storage unavailable */ }
}

/** Read Nightscout and switch the app to it. Throws a person-readable message. */
export async function loadNightscout(): Promise<void> {
  const b = bridge();
  if (!b) throw new Error('Nightscout works in the desktop app.');
  const res = await b.fetch();
  if (!res.ok) throw new Error(res.error);
  if (!res.raw.entries.length) throw new Error('Connected, but Nightscout has no CGM readings from the last 12 weeks.');
  useDataset(buildNightscoutDataset(res.raw));
  setPref('nightscout');
}

export function showSample(): void {
  setPref('sample');
  if (DATA !== SYNTHETIC) useDataset(SYNTHETIC);
}

/** On launch: connected and not asked for the sample → read Nightscout. */
export async function boot(): Promise<string | null> {
  const b = bridge();
  if (!b || prefersSample()) return null;
  const cfg = await b.config();
  if (!cfg.connected) return null;
  try {
    await loadNightscout();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
