import { useState } from 'react';
import {
  DEFAULT_SCOPE,
  WEEKDAY_WINDOWS,
  describeScopeCoverage,
  type SampleScope,
} from '@/data/sampleScope';
import { WEEKDAY_LABELS } from '@/lib/metrics/dayHourGrid';
import type { MetricsRange } from '@/data/types';
import styles from './SampleScopePicker.module.css';

// One sheet for the whole question of what the screen is showing.
//
// It replaces three controls that each answered part of it: the range selector
// (which governed some cards and not others, with nothing saying which), the
// day stepper (one day per tap — the wrong gesture for "what do Tuesdays do"),
// and the day-of-week screen, which was a separate destination for what is
// really just a differently-shaped sample.
//
// The coverage line at the bottom is not decoration. Widening the window is a
// real trade — more Tuesdays is a stronger claim and slower to notice a change
// — and a window can outrun the history behind it, so the sheet reports what
// the sample HOLDS rather than what was requested.

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const RANGES: MetricsRange[] = ['7d', '14d', '30d', '90d', '180d'];

type Mode = 'today' | 'weekday' | 'range';

function modeOf(scope: SampleScope): Mode {
  if (scope.kind === 'today') return 'today';
  if (scope.kind === 'weekday') return 'weekday';
  return 'range';
}

type Props = {
  scope: SampleScope;
  /** Timestamps of the readings available, for the coverage line. */
  timestamps: number[];
  onApply: (next: SampleScope) => void;
  onDismiss: () => void;
};

export function SampleScopePicker({ scope, timestamps, onApply, onDismiss }: Props) {
  const [draft, setDraft] = useState<SampleScope>(scope);
  const mode = modeOf(draft);
  const now = new Date();

  // Switching mode keeps whatever the other mode had chosen, so flipping to
  // compare and back does not silently reset the weekday you were looking at.
  const [weekday, setWeekday] = useState(
    scope.kind === 'weekday' ? scope.weekday : new Date().getDay(),
  );
  const [windowDays, setWindowDays] = useState(
    scope.kind === 'weekday' ? scope.windowDays : 84,
  );

  const setMode = (next: Mode) => {
    if (next === 'today') setDraft({ kind: 'today' });
    else if (next === 'weekday') setDraft({ kind: 'weekday', weekday, windowDays });
    else setDraft(scope.kind === 'range' ? scope : DEFAULT_SCOPE);
  };

  const coverage = describeScopeCoverage(draft, timestamps, now);

  return (
    <div className={styles.wrap} role="dialog" aria-modal="true" aria-label="Choose what to show">
      <button className={styles.scrim} onClick={onDismiss} aria-label="Close" />
      <div className={styles.sheet}>
        <span className={styles.grabber} aria-hidden />

        <div className={styles.head}>
          <h2 className={styles.title}>What are you looking at?</h2>
          <p className={styles.sub}>Every figure on the screen is scored against this sample.</p>
        </div>

        <div className={styles.modes} role="tablist" aria-label="Sample shape">
          {(['today', 'weekday', 'range'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`${styles.mode} ${mode === m ? styles.modeActive : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'today' ? 'Today' : m === 'weekday' ? 'Day of week' : 'Range'}
            </button>
          ))}
        </div>

        {mode === 'weekday' ? (
          <>
            <div className={styles.group}>
              <span className={styles.groupLabel}>Which day</span>
              <div className={styles.chips}>
                {LETTERS.map((letter, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={WEEKDAY_LABELS[i]}
                    aria-pressed={weekday === i}
                    className={`${styles.chip} ${weekday === i ? styles.chipActive : ''}`}
                    onClick={() => {
                      setWeekday(i);
                      setDraft({ kind: 'weekday', weekday: i, windowDays });
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.group}>
              <div className={styles.groupHead}>
                <span className={styles.groupLabel}>How far back</span>
                <span className={styles.groupHint}>Wider is steadier, slower to react</span>
              </div>
              <div className={styles.chips}>
                {WEEKDAY_WINDOWS.map((weeks) => {
                  const days = weeks * 7;
                  return (
                    <button
                      key={weeks}
                      type="button"
                      aria-pressed={windowDays === days}
                      className={`${styles.chip} ${windowDays === days ? styles.chipActive : ''}`}
                      onClick={() => {
                        setWindowDays(days);
                        setDraft({ kind: 'weekday', weekday, windowDays: days });
                      }}
                    >
                      {weeks}w
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {mode === 'range' ? (
          <div className={styles.group}>
            <span className={styles.groupLabel}>How far back</span>
            <div className={styles.chips}>
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={draft.kind === 'range' && draft.range === r}
                  className={`${styles.chip} ${
                    draft.kind === 'range' && draft.range === r ? styles.chipActive : ''
                  }`}
                  onClick={() => setDraft({ kind: 'range', range: r })}
                >
                  {r.replace('d', 'd')}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className={styles.coverage}>{coverage}</p>

        <button type="button" className={styles.apply} onClick={() => onApply(draft)}>
          Show {scopeButtonLabel(draft)}
        </button>
      </div>
    </div>
  );
}

function scopeButtonLabel(scope: SampleScope): string {
  if (scope.kind === 'weekday') return `${WEEKDAY_LABELS[scope.weekday]}s`;
  if (scope.kind === 'today') return 'today';
  if (scope.kind === 'range') return `the last ${scope.range.replace('d', ' days')}`;
  return 'these dates';
}
