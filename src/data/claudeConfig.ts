// Claude connection config.
//
// WHAT THIS CONNECTS TO, HONESTLY: Anthropic's Claude API, authenticated with
// an API key from console.anthropic.com (Claude Console). That is billed per
// token on its own account — a Claude Pro/Max subscription does NOT cover it,
// and there is no "sign in with Claude" flow a third-party app can use to
// spend a subscription. So this stores a key you paste, on this device only.
//
// Nothing leaves the device until you press a button that says it will, and
// every request shows the exact evidence it is about to send first
// (see docs/claude-connection.md). Claude explains app-computed evidence; it
// never doses, and nothing it returns is written to Loop.
//
// STORAGE CAVEAT: like the OpenAI key, this lives in WebView localStorage.
// The iOS Keychain would be stronger; moving both keys there is tracked in
// docs/claude-connection.md as an open item rather than silently assumed.

const STORAGE_KEY = 'loopstack.claudeConfig.v1';

export type ClaudeModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export const CLAUDE_MODELS: { id: ClaudeModelId; label: string; hint: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Most careful reading · $4 / $20 per M tokens' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Faster, cheaper · $2 / $10 per M tokens' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Quickest, lowest cost · $0.10 / $0.50 per M tokens' },
];

export const DEFAULT_CLAUDE_MODEL: ClaudeModelId = 'claude-opus-5-5';

export type ClaudeConfig = {
  /** Claude Console API key (sk-ant-…). Stored on device only. */
  apiKey: string;
  model: ClaudeModelId;
  /** Master switch — off means no screen offers to call Claude. */
  enabled: boolean;
  /** ISO time the key last passed a connection test, or null. */
  verifiedIso: string | null;
};

export const EMPTY_CLAUDE_CONFIG: ClaudeConfig = {
  apiKey: '',
  model: DEFAULT_CLAUDE_MODEL,
  enabled: false,
  verifiedIso: null,
};

const isModel = (v: unknown): v is ClaudeModelId => CLAUDE_MODELS.some((m) => m.id === v);

export function loadClaudeConfig(): ClaudeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CLAUDE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ClaudeConfig>;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: isModel(parsed.model) ? parsed.model : DEFAULT_CLAUDE_MODEL,
      enabled: Boolean(parsed.enabled),
      verifiedIso: typeof parsed.verifiedIso === 'string' ? parsed.verifiedIso : null,
    };
  } catch {
    return EMPTY_CLAUDE_CONFIG;
  }
}

export function saveClaudeConfig(config: ClaudeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable — config applies for this session only.
  }
}

export function clearClaudeConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True when a call could actually be made. */
export function claudeReady(config: ClaudeConfig): boolean {
  return config.enabled && config.apiKey.trim().length > 0;
}

export function claudeModelLabel(id: ClaudeModelId): string {
  return CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** A key we can show without leaking it — "sk-ant…4f2a". */
export function maskClaudeKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return k ? '••••' : '';
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
