import { useState } from 'react';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { Section } from '@/components/Section/Section';
import { useDataSourceContext } from '@/data/sources/DataSourceContext';
import { useCurrentGlucose } from '@/data/sources/hooks';
import { isImplemented } from '@/data/sources/registry';
import {
  loadNightscoutConfig,
  saveNightscoutConfig,
} from '@/data/sources/nightscoutConfig';
import {
  loadInsulinOwner,
  saveInsulinOwner,
  type InsulinOwner,
} from '@/data/sources/combinedConfig';
import type { DataSourceKind } from '@/data/sources/types';
import styles from './SourcesSettings.module.css';

type SourceOption = {
  kind: DataSourceKind;
  label: string;
  description: string;
  status: 'live' | 'partial' | 'soon';
  statusNote?: string;
};

const options: SourceOption[] = [
  {
    kind: 'mock',
    label: 'Mock data',
    description: 'Hand-authored sample profile for design and demos.',
    status: 'live',
  },
  {
    kind: 'healthkit',
    label: 'Apple Health',
    description:
      'Reads glucose, insulin, carbs, workouts, heart rate, steps, and sleep from HealthKit. iOS only.',
    status: 'live',
    statusNote: 'Full reads · no Loop-status signal',
  },
  {
    kind: 'combined',
    label: 'Apple Health + Nightscout',
    description:
      'Sleep, workouts, steps and heart rate from Apple Health; glucose, treatments, overrides and Loop status from Nightscout. The fullest picture — needs both set up.',
    status: 'live',
    statusNote: 'Recommended on iPhone',
  },
  {
    kind: 'nightscout',
    label: 'Nightscout',
    description:
      'Polls your Nightscout site for glucose, treatments, overrides, and Loop status — the source that unlocks closed-loop vs manual tracking.',
    status: 'live',
    statusNote: 'Needs your site URL below',
  },
];

const statusLabel: Record<SourceOption['status'], string> = {
  live: 'Live',
  partial: 'Partial',
  soon: 'Coming soon',
};

export function SourcesSettings() {
  const { activeKind, setActiveKind, refresh } = useDataSourceContext();
  const glucose = useCurrentGlucose();
  const [refreshing, setRefreshing] = useState(false);
  const [nsConfig, setNsConfig] = useState(loadNightscoutConfig);
  const [nsSaved, setNsSaved] = useState(false);
  const [insulinOwner, setInsulinOwner] = useState<InsulinOwner>(loadInsulinOwner);

  const pickInsulinOwner = (owner: InsulinOwner) => {
    saveInsulinOwner(owner);
    setInsulinOwner(owner);
    // The merge reads this at snapshot time, so the change only reaches the
    // dashboard on the next read.
    void refresh();
  };
  const onPick = (kind: DataSourceKind) => {
    if (!isImplemented(kind)) return;
    setActiveKind(kind);
  };

  const onSaveNs = () => {
    saveNightscoutConfig(nsConfig);
    setNsConfig(loadNightscoutConfig());
    setNsSaved(true);
    setTimeout(() => setNsSaved(false), 2000);
    // Re-pull with the new settings when Nightscout is the active source.
    if (activeKind === 'nightscout') void refresh();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <AppHeader title="Data sources" showBack />
      <main className="screen">
        <div className={styles.intro}>
          <p className={styles.introText}>
            Choose where LoopStack reads glucose, insulin, and meal data from.
            You can switch any time — your local Fix Log and Commit Log stay
            put.
          </p>
        </div>

        <Section
          label="Active source"
          title={options.find((o) => o.kind === activeKind)?.label ?? 'Mock data'}
          description={
            glucose.error
              ? glucose.error.message
              : glucose.data
                ? `Last reading ${glucose.data.mgdl} mg/dL`
                : 'No glucose reading yet.'
          }
        >
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </Section>

        <Section
          label="Available"
          title="Pick a source"
          description="Tap to switch. Disabled options are not yet implemented."
        >
          {options.map((opt) => {
            const enabled = isImplemented(opt.kind);
            const active = activeKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                className={`${styles.option} ${active ? styles.optionActive : ''} ${
                  !enabled ? styles.optionDisabled : ''
                }`}
                onClick={() => onPick(opt.kind)}
                disabled={!enabled}
                aria-pressed={active}
              >
                <div className={styles.optionHead}>
                  <span className={styles.optionLabel}>{opt.label}</span>
                  <span className={`${styles.statusChip} ${styles[`status_${opt.status}`]}`}>
                    {statusLabel[opt.status]}
                  </span>
                </div>
                <p className={styles.optionDesc}>{opt.description}</p>
                {opt.statusNote ? (
                  <span className={styles.statusNote}>{opt.statusNote}</span>
                ) : null}
              </button>
            );
          })}
        </Section>

        {activeKind === 'combined' ? (
          <Section
            label="Combined source"
            title="Which one reports insulin"
            description="Loop writes the same bolus to both Apple Health and Nightscout. Counting both would double every unit, so exactly one reports insulin and the other is ignored for it."
          >
            <div className={styles.radioGroup} role="radiogroup" aria-label="Insulin source">
              {([
                {
                  value: 'healthkit' as const,
                  label: 'Apple Health',
                  hint: 'Includes delivered temp basals, so scheduled-vs-delivered basal and the observed carb ratio can be computed. Needs Loop’s Health sharing switched on.',
                },
                {
                  value: 'nightscout' as const,
                  label: 'Nightscout',
                  hint: 'Boluses only in this build — the basal comparison stays hidden. Does not depend on Loop’s Health permissions.',
                },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={insulinOwner === opt.value}
                  className={`${styles.radio} ${insulinOwner === opt.value ? styles.radioActive : ''}`}
                  onClick={() => pickInsulinOwner(opt.value)}
                >
                  <span className={styles.radioDot} aria-hidden />
                  <span className={styles.radioBody}>
                    <span className={styles.radioLabel}>{opt.label}</span>
                    <span className={styles.radioHint}>{opt.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        <Section
          label="Nightscout"
          title="Connection settings"
          description="Your site URL and an access token with the readable role (Admin tools → Subjects). Leave the token empty for open sites. Data is read-only — LoopStack never writes to Nightscout."
        >
          <div className={styles.nsField}>
            <label className="label" htmlFor="ns-url">Site URL</label>
            <input
              id="ns-url"
              className={styles.nsInput}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://yoursite.nightscout.example"
              value={nsConfig.url}
              onChange={(e) => setNsConfig((c) => ({ ...c, url: e.target.value }))}
            />
          </div>
          <div className={styles.nsField}>
            <label className="label" htmlFor="ns-token">Access token (optional)</label>
            <input
              id="ns-token"
              className={styles.nsInput}
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="readable-xxxxxxxx"
              value={nsConfig.token}
              onChange={(e) => setNsConfig((c) => ({ ...c, token: e.target.value }))}
            />
          </div>
          <button type="button" className={styles.refreshBtn} onClick={onSaveNs}>
            {nsSaved ? 'Saved ✓' : 'Save connection'}
          </button>
        </Section>

      </main>
    </>
  );
}
