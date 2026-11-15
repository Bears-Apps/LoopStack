import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Section, Row } from '@/components/Section/Section';
import {
  CLAUDE_MODELS,
  claudeModelLabel,
  claudeReady,
  clearClaudeConfig,
  EMPTY_CLAUDE_CONFIG,
  loadClaudeConfig,
  maskClaudeKey,
  saveClaudeConfig,
  type ClaudeConfig,
} from '@/data/claudeConfig';
import sourceStyles from '../SourcesSettings/SourcesSettings.module.css';
import styles from './ClaudeSettings.module.css';

// Profile → Claude. Connect a Claude Console API key so the clinic report and
// Ask data can request explanations. The copy says plainly what this is (a
// separately billed API key, not a Claude.ai sign-in) and what it can see
// (only what a screen shows you and you choose to send).

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message: string };

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ClaudeSettings() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ClaudeConfig>(loadClaudeConfig);
  const [keyDraft, setKeyDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle', message: '' });

  // A blank key field means "keep the stored key", as on the OpenAI setting.
  const draft = (): ClaudeConfig => {
    const apiKey = keyDraft.trim() ? keyDraft.trim() : config.apiKey;
    return { ...config, apiKey, verifiedIso: apiKey === config.apiKey ? config.verifiedIso : null };
  };

  const persist = (next: ClaudeConfig) => {
    saveClaudeConfig(next);
    setConfig(next);
    setKeyDraft('');
  };

  const onSave = () => {
    persist(draft());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const onTest = async () => {
    const next = draft();
    setTest({ status: 'testing', message: 'Checking the key with Anthropic…' });
    try {
      // The SDK loads on first use, not at app start.
      const { testClaudeConnection } = await import('@/lib/ai/claudeClient');
      const name = await testClaudeConnection(next);
      persist({ ...next, verifiedIso: new Date().toISOString() });
      setTest({ status: 'ok', message: `Connected. ${name} is available to this key. No tokens were used.` });
    } catch (err) {
      persist({ ...next, verifiedIso: null });
      setTest({ status: 'error', message: err instanceof Error ? err.message : 'Connection test failed.' });
    }
  };

  const onRemove = () => {
    clearClaudeConfig();
    setConfig(EMPTY_CLAUDE_CONFIG);
    setKeyDraft('');
    setTest({ status: 'idle', message: '' });
  };

  const ready = claudeReady(config);
  const status = !config.apiKey
    ? { label: 'Not connected', tone: sourceStyles.status_soon }
    : !config.enabled
      ? { label: 'Off', tone: sourceStyles.status_soon }
      : config.verifiedIso
        ? { label: 'Connected', tone: sourceStyles.status_live }
        : { label: 'Not tested', tone: sourceStyles.status_partial };

  return (
    <>
      <AppHeader title="Claude" showBack />
      <main className="screen">
        <div>
          <h1 className="screen-title">Claude insights</h1>
          <p className={styles.support}>
            Connect Claude to draft discussion notes for your clinic report and explain Ask-data evidence. Claude reads only what
            a screen shows you first, and never doses or changes Loop.
          </p>
        </div>

        <Section label="Connection" title="Status" action={<span className={`${sourceStyles.statusChip} ${status.tone}`}>{status.label}</span>}>
          <Row label="Model" value={claudeModelLabel(config.model)} />
          <Row label="API key" value={config.apiKey ? maskClaudeKey(config.apiKey) : 'None'} />
          <Row label="Last verified" value={config.verifiedIso ? fmt(config.verifiedIso) : 'Never'} />
        </Section>

        <Section
          label="Setup"
          title="Claude API key"
          description="Create a key at console.anthropic.com → API keys. API use is billed per request to that Console account; a Claude Pro or Max subscription does not cover it. The key is stored on this device only."
        >
          <div className={sourceStyles.nsField}>
            <label className="label" htmlFor="claude-key">API key</label>
            <input
              id="claude-key"
              className={sourceStyles.nsInput}
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={config.apiKey ? maskClaudeKey(config.apiKey) : 'sk-ant-…'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
          </div>

          <div className={sourceStyles.radioGroup} role="radiogroup" aria-label="Claude model">
            {CLAUDE_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={config.model === m.id}
                className={`${sourceStyles.radio} ${config.model === m.id ? sourceStyles.radioActive : ''}`}
                onClick={() => setConfig((c) => ({ ...c, model: m.id, verifiedIso: c.model === m.id ? c.verifiedIso : null }))}
              >
                <span className={sourceStyles.radioDot} aria-hidden />
                <span className={sourceStyles.radioBody}>
                  <span className={sourceStyles.radioLabel}>{m.label}</span>
                  <span className={sourceStyles.radioHint}>{m.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <label className={sourceStyles.aiToggleRow}>
            <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))} />
            <span>I agree that data I choose to send goes to Anthropic’s Claude, a third-party AI</span>
          </label>

          <div className={styles.actions}>
            <button type="button" className={sourceStyles.refreshBtn} onClick={onSave}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
            <button
              type="button"
              className={sourceStyles.refreshBtn}
              onClick={() => void onTest()}
              disabled={test.status === 'testing' || (!keyDraft.trim() && !config.apiKey)}
            >
              {test.status === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {config.apiKey ? (
              <button type="button" className={`${sourceStyles.refreshBtn} ${styles.danger}`} onClick={onRemove}>
                Remove key
              </button>
            ) : null}
          </div>
          {test.message ? (
            <p role={test.status === 'error' ? 'alert' : 'status'} className={test.status === 'error' ? styles.error : styles.support}>
              {test.message}
            </p>
          ) : null}
        </Section>

        <Section label="Privacy" title="What Claude can see">
          <ul className={styles.list}>
            <li>Nothing is sent in the background. Each request starts from a button that says it sends to Claude.</li>
            <li>You see the exact data before it is sent: the report sections or the Ask-data evidence, as text.</li>
            <li>Never sent: your name, Nightscout address or token, the OpenAI key, or raw Apple Health records.</li>
            <li>Requests go directly from this phone to Anthropic’s API under Anthropic’s commercial terms. Anthropic does not train models on API data by default.</li>
            <li>Claude’s answers are labelled as AI-generated, kept only on this screen, and never written to Loop, a pump or Nightscout.</li>
          </ul>
        </Section>

        <Section label="Use it" title="Where Claude helps" description={ready ? undefined : 'Turn Claude on above to see these offers.'}>
          <Row label="Clinic report" hint="Discussion notes for your next appointment" onClick={() => navigate('/app/report')} trailing={<span aria-hidden>›</span>} />
          <Row label="Ask data" hint="Explain a meal or weekday-low evidence report" onClick={() => navigate('/app/chat')} trailing={<span aria-hidden>›</span>} />
        </Section>

        <Section
          label="Apple Health"
          title="Using the Claude app instead"
          description="The Claude iPhone app has its own Apple Health connection (beta, Pro/Max, US), set up inside that app. It reads activity, sleep, vitals and nutrition — not glucose or insulin — and LoopStack cannot feed data into it. To bring your Loop picture into a Claude conversation, export a report here and attach the PDF yourself."
        >
          <Row label="Export a report to share" onClick={() => navigate('/app/report')} trailing={<span aria-hidden>›</span>} />
        </Section>
      </main>
    </>
  );
}
