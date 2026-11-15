import { useState } from 'react';
import { Section } from '@/components/Section/Section';
import { EvidenceCard } from '@/components/EvidenceCard/EvidenceCard';
import { ConfidenceRing } from '@/components/ConfidenceRing/ConfidenceRing';
import type {
  ClinicalSettings as Clinical,
  TargetMetric,
  TrendDirection,
} from '@/data/types';
import {
  therapyLimits,
  toEditable,
  validateTherapy,
  type EditableTherapy,
  type TherapyField,
} from '@/data/loopTherapyStore';
import styles from './Profile.module.css';

type Props = {
  clinical: Clinical;
  /** Persist an accepted edit. */
  onChange: (next: EditableTherapy) => void;
  /** Drop every override and fall back to the profile defaults. */
  onReset: () => void;
  /** True when any value has been entered by hand. */
  edited: boolean;
};

const fieldOrder: TherapyField[] = [
  'baseIsf',
  'carbRatio',
  'insulinDurationHours',
];

const trendGlyph: Record<TrendDirection, string> = {
  up: '↑',
  down: '↓',
  steady: '→',
};

const trendLabel: Record<TrendDirection, string> = {
  up: 'Trending up',
  down: 'Trending down',
  steady: 'Holding steady',
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / 36e5);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function ObservedMeta({ meta }: { meta: TargetMetric }) {
  return (
    <div className={styles.observedMeta}>
      <span className={`${styles.trendPill} ${styles[`trend_${meta.trend}`]}`}>
        <span aria-hidden>{trendGlyph[meta.trend]}</span>
        {trendLabel[meta.trend]}
      </span>
      <span className={styles.metaDot} aria-hidden>·</span>
      <span className={styles.metaFacet}>{meta.evidenceCount} meals</span>
      <span className={styles.metaDot} aria-hidden>·</span>
      <span className={styles.metaFacet}>Updated {formatRelative(meta.lastUpdatedIso)}</span>
    </div>
  );
}

/** How a therapy value reads when the section is not being edited. */
function TherapyReadout({ field, value }: { field: TherapyField; value: number }) {
  const limit = therapyLimits[field];
  return (
    <div className={styles.therapyReadRow}>
      <span className={styles.therapyReadLabel}>{limit.label}</span>
      <span className={styles.therapyReadValue}>
        {value} <span className={styles.therapyUnit}>{limit.unit}</span>
      </span>
    </div>
  );
}

// A numeric therapy value. Commits on blur rather than per-keystroke: typing
// "120" passes through "1" and "12", and validating those mid-entry would fight
// the user with an error for every character.
function TherapyField({
  field,
  value,
  draft,
  error,
  onDraft,
  onCommit,
}: {
  field: TherapyField;
  value: number;
  draft: string | null;
  error: string | null;
  onDraft: (field: TherapyField, raw: string) => void;
  onCommit: (field: TherapyField) => void;
}) {
  const limit = therapyLimits[field];
  return (
    <div className={styles.therapyField}>
      <label className={styles.therapyLabel} htmlFor={`therapy-${field}`}>
        {limit.label}
      </label>
      <div className={styles.therapyInputRow}>
        <input
          id={`therapy-${field}`}
          className={`${styles.therapyInput} ${error ? styles.therapyInputError : ''}`}
          type="number"
          inputMode="decimal"
          min={limit.min}
          max={limit.max}
          step={limit.step}
          value={draft ?? String(value)}
          onChange={(e) => onDraft(field, e.target.value)}
          onBlur={() => onCommit(field)}
          aria-invalid={error != null}
          aria-describedby={error ? `therapy-${field}-error` : undefined}
        />
        <span className={styles.therapyUnit}>{limit.unit}</span>
      </div>
      {error ? (
        <span id={`therapy-${field}-error`} className={styles.therapyError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ClinicalSettings({ clinical, onChange, onReset, edited }: Props) {
  const isfDelta = clinical.observedIsf - clinical.baseIsf;
  const isfDeltaPct = Math.round((isfDelta / clinical.baseIsf) * 100);

  // In-flight text per field, and the reason the last commit was rejected.
  const [drafts, setDrafts] = useState<Partial<Record<TherapyField, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<TherapyField, string>>>({});
  // Read-only until asked otherwise — see LoopScheduleSettings for the reasoning.
  const [editing, setEditing] = useState(false);

  const setDraft = (field: TherapyField, raw: string) => {
    setDrafts((d) => ({ ...d, [field]: raw }));
  };

  const commit = (field: TherapyField) => {
    const raw = drafts[field];
    if (raw == null) return;

    const parsed = Number.parseFloat(raw);
    const candidate: EditableTherapy = { ...toEditable(clinical), [field]: parsed };
    const result = validateTherapy(candidate, field);

    if (!result.ok) {
      setErrors((e) => ({ ...e, [field]: result.message }));
      return;
    }
    // Accepted: clear the draft so the field renders the stored value again.
    setErrors((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
    setDrafts((d) => {
      const next = { ...d };
      delete next[field];
      return next;
    });
    onChange(candidate);
  };

  return (
    <Section
      label="Targets"
      title="Targets and sensitivity"
      description="How LoopStack scores your data, and its record of your sensitivity. The in-range band below is the DASHBOARD's — it defines every time-in-range percentage in the app, and is deliberately not Loop's correction range (that lives in Loop settings). Editing here never changes your pump; the Fix Log is still the only route to a real therapy change."
      action={
        <button
          type="button"
          className={styles.editToggle}
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          aria-label={editing ? 'Finish editing targets' : 'Edit targets'}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      }
    >
      {!editing ? (
        <div className={styles.therapyGroup}>
          <div className={styles.therapyBandRow}>
            <span className={styles.therapyBandLabel}>Scored in range</span>
            <span className={styles.therapyBandValue}>
              {clinical.targetLowMgdl}–{clinical.targetHighMgdl}
              <span className={styles.therapyUnit}> mg/dL</span>
            </span>
          </div>
          <div className={styles.therapyBandRow}>
            <span className={styles.therapyBandLabel}>Low</span>
            <span className={styles.therapyBandValue}>
              {clinical.urgentLowMgdl}–{clinical.targetLowMgdl}
              <span className={styles.therapyUnit}> mg/dL</span>
            </span>
          </div>
          <div className={styles.therapyBandRow}>
            <span className={styles.therapyBandLabel}>Urgent low</span>
            <span className={styles.therapyBandValue}>
              Under {clinical.urgentLowMgdl}
              <span className={styles.therapyUnit}> mg/dL</span>
            </span>
          </div>
          {fieldOrder.map((field) => (
            <TherapyReadout key={field} field={field} value={clinical[field]} />
          ))}
        </div>
      ) : null}

      {editing ? (
        <>
      <div className={styles.therapyGroup}>
        <span className={styles.therapyGroupLabel}>Urgent low</span>
        <TherapyField
          field="urgentLowMgdl"
          value={clinical.urgentLowMgdl}
          draft={drafts.urgentLowMgdl ?? null}
          error={errors.urgentLowMgdl ?? null}
          onDraft={setDraft}
          onCommit={commit}
        />
        <span className={styles.therapyHint}>
          Readings below this count as urgent low rather than low. Standard
          reports use 54; yours is what you actually treat differently.
        </span>
      </div>

      <div className={styles.therapyGroup}>
        <span className={styles.therapyGroupLabel}>Target range</span>
        <div className={styles.therapyRangeRow}>
          <TherapyField
            field="targetLowMgdl"
            value={clinical.targetLowMgdl}
            draft={drafts.targetLowMgdl ?? null}
            error={errors.targetLowMgdl ?? null}
            onDraft={setDraft}
            onCommit={commit}
          />
          <span className={styles.therapyRangeDash} aria-hidden>–</span>
          <TherapyField
            field="targetHighMgdl"
            value={clinical.targetHighMgdl}
            draft={drafts.targetHighMgdl ?? null}
            error={errors.targetHighMgdl ?? null}
            onDraft={setDraft}
            onCommit={commit}
          />
        </div>
      </div>

      <div className={styles.therapyGroup}>
        {fieldOrder.map((field) => (
          <TherapyField
            key={field}
            field={field}
            value={clinical[field]}
            draft={drafts[field] ?? null}
            error={errors[field] ?? null}
            onDraft={setDraft}
            onCommit={commit}
          />
        ))}
      </div>

      {edited ? (
        <button type="button" className={styles.therapyReset} onClick={onReset}>
          Reset to defaults
        </button>
      ) : null}
        </>
      ) : null}

      <div className={styles.observedBlock}>
        <div className={styles.observedHeader}>
          <div className={styles.observedLabel}>
            <span className={styles.observedLabelText}>Observed ISF</span>
            <span className={styles.observedHint}>
              {isfDelta >= 0 ? '+' : ''}
              {isfDeltaPct}% vs base
            </span>
          </div>
          <div className={styles.observedRight}>
            <span className={styles.observedValue}>
              {clinical.observedIsf} mg/dL per 1U
            </span>
            {clinical.observedIsfMeta ? (
              <ConfidenceRing
                level={clinical.observedIsfMeta.confidence}
                score={clinical.observedIsfMeta.confidenceScore}
                size="sm"
                showLabel
              />
            ) : null}
          </div>
        </div>
        {clinical.observedIsfMeta ? <ObservedMeta meta={clinical.observedIsfMeta} /> : null}
      </div>

      <EvidenceCard
        title="Base vs observed ISF"
        summary="What the delta means for your suggested strategy"
        body={
          <>
            <p>
              <strong>Base ISF</strong> is what Loop was configured with. <strong>Observed ISF</strong>{' '}
              is what the last 14 days of outcomes imply. LoopStack uses the observed value to
              suggest insulin doses, but never changes Loop directly.
            </p>
            <p>
              A widening gap often signals a base setting worth revisiting with your care team —
              especially when fitness, stress, or cycle phase have shifted.
            </p>
          </>
        }
      />
    </Section>
  );
}
