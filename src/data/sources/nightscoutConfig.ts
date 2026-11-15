// Nightscout connection settings, persisted locally. The token is a
// Nightscout access token (Admin tools → Subjects), not the API secret —
// read-only "readable" role is all LoopStack needs.

export type NightscoutConfig = {
  url: string;    // e.g. https://mysite.nightscout.example
  token: string;  // optional access token; empty for open sites
};

const KEY = 'loopstack:nightscout:v1';

export function loadNightscoutConfig(): NightscoutConfig {
  if (typeof window === 'undefined') return { url: '', token: '' };
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as NightscoutConfig) : null;
    return {
      url: typeof parsed?.url === 'string' ? parsed.url : '',
      token: typeof parsed?.token === 'string' ? parsed.token : '',
    };
  } catch {
    return { url: '', token: '' };
  }
}

export function saveNightscoutConfig(config: NightscoutConfig): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ url: config.url.trim().replace(/\/+$/, ''), token: config.token.trim() }),
    );
  } catch {
    // storage unavailable — session-only
  }
}
