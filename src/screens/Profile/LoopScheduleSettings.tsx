import { useState } from 'react';
import { Section } from '@/components/Section/Section';
import {
  formatStart,
  loadSchedules,
  normalizeSchedule,
  saveSchedules,
  scalarLimits,
  scheduleDailyTotal,
  scheduleLimits,
  RANGE_LIMITS,
  type EditableSchedules,
  type ScalarField,
  type ScheduleField,
} from '@/data/loopTherapySchedules';
import type { RangeEntry, ScheduleEntry } from '@/data/loopTherapy';
import styles from './LoopScheduleSettings.module.css';

// Every Loop therapy setting, entered by hand.
//
// This replaces the screenshot-upload tiles: those were never wired, and the
// values they were meant to capture were sitting hardcoded in a source file
// with a note to re-transcribe them manually. A stale mirror silently corrupts
// every dose estimate, so the settings now have a real home and a visible
// "last confirmed" date.

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 15, 30, 45];

type Props = {
  onChanged?: () => void;
};

export function LoopScheduleSettings({ onChanged }: Props) {
  const [s, setS] = useState<EditableSchedules>(loadSchedules);
  const [saved, setSaved] = useState(false);
  // Read-only by default. These are forty-odd numbers that quietly govern every
  // dose estimate — a screen full of live inputs invites a mistyped basal from
  // a stray tap, and there is no undo once it reaches the engine.
  const [editing, setEditing] = useState(false);

  const commit = (next: EditableSchedules) => {
    setS(next);
    saveSchedules(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    onChanged?.();
  };

  const setScalar = (field: ScalarField, raw: string) => {
    const v = Number(raw);
    const lim = scalarLimits[field];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) return;
    commit({ ...s, [field]: v });
  };

  const setScheduleValue = (field: ScheduleField, index: number, raw: string) => {
    const v = Number(raw);
    const lim = scheduleLimits[field];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) return;
    const next = s[field].map((e, i) => (i === index ? { ...e, value: v } : e));
    commit({ ...s, [field]: next });
  };

  const setScheduleStart = (field: ScheduleField, index: number, minutes: number) => {
    const next = normalizeSchedule(
      s[field].map((e, i) => (i === index ? { ...e, startMinutes: minutes } : e)),
    );
    commit({ ...s, [field]: next });
  };

  const addScheduleEntry = (field: ScheduleField) => {
    const last = s[field].at(-1);
    const startMinutes = Math.min(23 * 60 + 45, (last?.startMinutes ?? 0) + 60);
    const entry: ScheduleEntry = { startMinutes, value: last?.value ?? 1 };
    commit({ ...s, [field]: normalizeSchedule([...s[field], entry]) });
  };

  const removeScheduleEntry = (field: ScheduleField, index: number) => {
    // The midnight entry defines the value at the start of the day; without it
    // the schedule has no value until its first entry.
    if (s[field].length <= 1) return;
    commit({ ...s, [field]: s[field].filter((_, i) => i !== index) });
  };

  const setRangeField = (index: number, key: 'low' | 'high', raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < RANGE_LIMITS.min || v > RANGE_LIMITS.max) return;
    const next = s.correctionRange.map((e, i) => (i === index ? { ...e, [key]: v } : e));
    commit({ ...s, correctionRange: next });
  };

  const setRangeStart = (index: number, minutes: number) => {
    const next = normalizeSchedule(
      s.correctionRange.map((e, i) => (i === index ? { ...e, startMinutes: minutes } : e)),
    );
    commit({ ...s, correctionRange: next });
  };

  const addRangeEntry = () => {
    const last = s.correctionRange.at(-1);
    const entry: RangeEntry = {
      startMinutes: Math.min(23 * 60 + 45, (last?.startMinutes ?? 0) + 60),
      low: last?.low ?? 100,
      high: last?.high ?? 120,
    };
    commit({ ...s, correctionRange: normalizeSchedule([...s.correctionRange, entry]) });
  };

  const removeRangeEntry = (index: number) => {
    if (s.correctionRange.length <= 1) return;
    commit({ ...s, correctionRange: s.correctionRange.filter((_, i) => i !== index) });
  };

  const confirmNow = () => commit({ ...s, capturedIso: new Date().toISOString() });

  const captured = new Date(s.capturedIso);
  const daysOld = Math.floor((Date.now() - captured.getTime()) / 86_400_000);

  return (
    <Section
      label="Loop mirror"
      title="Therapy settings from Loop"
      description="Every value Loop is running — the reference the dose engine resolves against. LoopStack never writes to your pump; keeping this current is what keeps its estimates honest."
      action={
        <button
          type="button"
          className={styles.editToggle}
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          aria-label={editing ? 'Finish editing therapy settings' : 'Edit therapy settings'}
        >
          {editing ? (
            'Done'
          ) : (
            <>
              <PencilIcon />
              <span>Edit</span>
            </>
          )}
        </button>
      }
    >
      <div className={`${styles.captured} ${daysOld > 60 ? styles.capturedStale : ''}`}>
        <span>
          Last confirmed {captured.toLocaleDateString()}
          {daysOld > 0 ? ` · ${daysOld} day${daysOld === 1 ? '' : 's'} ago` : ''}
        </span>
        <button type="button" className={styles.confirmBtn} onClick={confirmNow}>
          {saved ? 'Saved ✓' : 'Confirm current'}
        </button>
      </div>
      {daysOld > 60 ? (
        <p className={styles.staleWarn}>
          These have not been confirmed in {daysOld} days. If Loop changed since,
          every dose estimate here is measured against the wrong reference.
        </p>
      ) : null}

      {/* ── schedule editors ── */}
      <ScheduleBlock
        editing={editing}
        title="Basal rates"
        hint={`Background insulin per hour. Total ${scheduleDailyTotal(s.basalSchedule)} U/day — check this against Loop's own total.`}
        field="basalSchedule"
        entries={s.basalSchedule}
        onValue={setScheduleValue}
        onStart={setScheduleStart}
        onAdd={addScheduleEntry}
        onRemove={removeScheduleEntry}
      />

      <ScheduleBlock
        editing={editing}
        title="Carb ratios"
        hint="Grams of carb covered by one unit, resolved by time of day."
        field="carbRatioSchedule"
        entries={s.carbRatioSchedule}
        onValue={setScheduleValue}
        onStart={setScheduleStart}
        onAdd={addScheduleEntry}
        onRemove={removeScheduleEntry}
      />

      <ScheduleBlock
        editing={editing}
        title="Insulin sensitivities"
        hint="Expected mg/dL drop from one unit."
        field="insulinSensitivitySchedule"
        entries={s.insulinSensitivitySchedule}
        onValue={setScheduleValue}
        onStart={setScheduleStart}
        onAdd={addScheduleEntry}
        onRemove={removeScheduleEntry}
      />

      {/* ── correction range (Loop's own aim, distinct from dashboard TIR) ── */}
      <div className={styles.block}>
        {editing ? (
          <div className={styles.blockHead}>
            <span className={styles.blockTitle}>Correction range</span>
            <button type="button" className={styles.addBtn} onClick={addRangeEntry}>
              + Add segment
            </button>
          </div>
        ) : (
          <span className={styles.blockTitle}>Correction range</span>
        )}
        <p className={styles.blockHint}>
          The range Loop itself aims for. Deliberately separate from your
          dashboard's in-range target, which is the band your own numbers are
          scored against.
        </p>
        {!editing
          ? s.correctionRange.map((e, i) => (
              <div key={`${e.startMinutes}-${i}`} className={styles.readRow}>
                <span className={styles.readStart}>{formatStart(e.startMinutes)}</span>
                <span className={styles.readValue}>
                  {e.low}–{e.high} <span className={styles.unit}>mg/dL</span>
                </span>
              </div>
            ))
          : null}
        {editing && s.correctionRange.map((e, i) => (
          <div key={`${e.startMinutes}-${i}`} className={styles.row}>
            <StartPicker
              value={e.startMinutes}
              onChange={(m) => setRangeStart(i, m)}
            />
            <input
              className={styles.numInput}
              type="number"
              inputMode="decimal"
              defaultValue={e.low}
              aria-label={`Correction low from ${formatStart(e.startMinutes)}`}
              onBlur={(ev) => setRangeField(i, 'low', ev.target.value)}
            />
            <span className={styles.dash} aria-hidden>–</span>
            <input
              className={styles.numInput}
              type="number"
              inputMode="decimal"
              defaultValue={e.high}
              aria-label={`Correction high from ${formatStart(e.startMinutes)}`}
              onBlur={(ev) => setRangeField(i, 'high', ev.target.value)}
            />
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => removeRangeEntry(i)}
              disabled={s.correctionRange.length <= 1}
              aria-label="Remove segment"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* ── pre-meal + scalars ── */}
      <div className={styles.block}>
        <span className={styles.blockTitle}>Pre-meal range</span>
        <p className={styles.blockHint}>The lower target Loop aims for before a meal.</p>
        {!editing ? (
          <div className={styles.readRow}>
            <span className={styles.readStart}>Target</span>
            <span className={styles.readValue}>
              {s.preMealRange.low}–{s.preMealRange.high} <span className={styles.unit}>mg/dL</span>
            </span>
          </div>
        ) : (
        <div className={styles.row}>
          <input
            className={styles.numInput}
            type="number"
            defaultValue={s.preMealRange.low}
            aria-label="Pre-meal low"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) commit({ ...s, preMealRange: { ...s.preMealRange, low: v } });
            }}
          />
          <span className={styles.dash} aria-hidden>–</span>
          <input
            className={styles.numInput}
            type="number"
            defaultValue={s.preMealRange.high}
            aria-label="Pre-meal high"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) commit({ ...s, preMealRange: { ...s.preMealRange, high: v } });
            }}
          />
        </div>
        )}
      </div>

      <div className={styles.block}>
        <span className={styles.blockTitle}>Limits &amp; guards</span>
        {(Object.keys(scalarLimits) as ScalarField[]).map((field) =>
          !editing ? (
            <div key={field} className={styles.readRow}>
              <span className={styles.readStart}>{scalarLimits[field].label}</span>
              <span className={styles.readValue}>
                {s[field]} <span className={styles.unit}>{scalarLimits[field].unit}</span>
              </span>
            </div>
          ) : (
          <div key={field} className={styles.scalarRow}>
            <label className={styles.scalarLabel} htmlFor={`sched-${field}`}>
              {scalarLimits[field].label}
            </label>
            <div className={styles.scalarInputWrap}>
              <input
                id={`sched-${field}`}
                className={styles.numInput}
                type="number"
                inputMode="decimal"
                step={scalarLimits[field].step}
                defaultValue={s[field]}
                onBlur={(e) => setScalar(field, e.target.value)}
              />
              <span className={styles.unit}>{scalarLimits[field].unit}</span>
            </div>
          </div>
          ),
        )}
      </div>
    </Section>
  );
}

function ScheduleBlock({
  editing,
  title,
  hint,
  field,
  entries,
  onValue,
  onStart,
  onAdd,
  onRemove,
}: {
  editing: boolean;
  title: string;
  hint: string;
  field: ScheduleField;
  entries: ScheduleEntry[];
  onValue: (f: ScheduleField, i: number, raw: string) => void;
  onStart: (f: ScheduleField, i: number, minutes: number) => void;
  onAdd: (f: ScheduleField) => void;
  onRemove: (f: ScheduleField, i: number) => void;
}) {
  const lim = scheduleLimits[field];
  if (!editing) {
    return (
      <div className={styles.block}>
        <span className={styles.blockTitle}>{title}</span>
        <p className={styles.blockHint}>{hint}</p>
        {entries.map((e, i) => (
          <div key={`${e.startMinutes}-${i}`} className={styles.readRow}>
            <span className={styles.readStart}>{formatStart(e.startMinutes)}</span>
            <span className={styles.readValue}>
              {e.value} <span className={styles.unit}>{lim.unit}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className={styles.blockTitle}>{title}</span>
        <button type="button" className={styles.addBtn} onClick={() => onAdd(field)}>
          + Add segment
        </button>
      </div>
      <p className={styles.blockHint}>{hint}</p>
      {entries.map((e, i) => (
        <div key={`${e.startMinutes}-${i}`} className={styles.row}>
          <StartPicker value={e.startMinutes} onChange={(m) => onStart(field, i, m)} />
          <div className={styles.scalarInputWrap}>
            <input
              className={styles.numInput}
              type="number"
              inputMode="decimal"
              step={lim.step}
              defaultValue={e.value}
              aria-label={`${title} from ${formatStart(e.startMinutes)}`}
              onBlur={(ev) => onValue(field, i, ev.target.value)}
            />
            <span className={styles.unit}>{lim.unit}</span>
          </div>
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => onRemove(field, i)}
            disabled={entries.length <= 1}
            aria-label="Remove segment"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** 16px pencil, stroked to match the icon weight used across the app. */
function PencilIcon() {
  return (
    <svg
      className={styles.pencil}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11.5 2.5a1.6 1.6 0 0 1 2.3 2.3L5.6 13 2.5 13.5l.5-3.1z" />
    </svg>
  );
}

function StartPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (minutes: number) => void;
}) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return (
    <div className={styles.startPicker}>
      <select
        className={styles.select}
        value={hour}
        aria-label="Start hour"
        onChange={(e) => onChange(Number(e.target.value) * 60 + minute)}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {formatStart(h * 60).replace(':00', '')}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={minute}
        aria-label="Start minute"
        onChange={(e) => onChange(hour * 60 + Number(e.target.value))}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            :{String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
    </div>
  );
}
