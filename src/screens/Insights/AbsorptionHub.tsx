import { useState } from 'react';
import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { MetricTile } from '@/components/MetricTile/MetricTile';
import { isSample, useAbsorptionInsights } from '@/data/sources/hooks';
import {
  formatMinutes,
  MIN_MEALS_PER_FOOD,
  type PresetGroup,
  type PresetVerdict,
} from '@/lib/metabolism/absorptionProfile';
import styles from './AbsorptionHub.module.css';

// The absorption hub — measured answers to "which preset does this plate
// actually behave like".
//
// Loop's 3h/4h/6h absorption entries are guesses made at the table. This
// screen reads every meal that stood alone in the history and compares the
// observed impact curve against the curve the preset told Loop to expect —
// per preset, then per food. The export button hands the whole analysis over
// as text, because the stated workflow is pasting it into Claude and working
// the presets over from there.

const verdictLabel: Record<PresetVerdict, string> = {
  matches: 'Fits',
  finishes_early: 'Finishes early',
  outlasts: 'Outlasts preset',
  building: 'Building',
};

export function AbsorptionHub() {
  const result = useAbsorptionInsights();
  const a = result.data;
  const [copied, setCopied] = useState(false);

  if (!a) {
    return (
      <Section label="Absorption" title="How your plates actually absorb">
        <p className={styles.empty}>
          {result.loading
            ? 'Reading your meal history…'
            : result.error
              ? result.error.message
              : 'Needs logged carb entries with glucose history around them.'}
        </p>
      </Section>
    );
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(a.report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (older webview) — surface the text instead.
      window.prompt('Copy the report:', a.report);
    }
  };

  return (
    <>
      <Section
        label="Absorption"
        title="How your plates actually absorb"
        description="Every meal that stood alone in the window, read with insulin netted out and compared against the curve its absorption preset told Loop to expect. Meals overlapping other meals are set aside — a shared curve cannot be attributed to either plate."
        action={
          <button type="button" className={styles.copyBtn} onClick={copyReport}>
            {copied ? 'Copied ✓' : 'Copy for Claude'}
          </button>
        }
      >
        <div className={styles.tiles}>
          <MetricTile
            label="Meals read"
            value={a.cleanMeals}
            sublabel={`of ${a.totalMeals} logged in ${a.windowDays}d`}
          />
          <MetricTile
            label="Set aside"
            value={a.excludedOverlapping + a.excludedOther}
            sublabel="overlapping or unreadable"
          />
        </div>
        <p className={styles.note}>{a.dataNote}</p>
        {isSample(result) ? (
          <SampleNote>Absorption figures are example data.</SampleNote>
        ) : null}
      </Section>

      {a.presets.map((p) => (
        <PresetCard key={`${p.presetHours}|${p.modelKind}`} preset={p} />
      ))}

      {a.foods.length > 0 ? (
        <Section
          label="By food"
          title="What each plate tracks"
          description="Foods with enough clean reads to compare. 'Tracks' names the preset whose modelled done-time sits closest to the observed one — the cue for what to enter next time a plate like this comes around."
        >
          <div className={styles.foods}>
            {a.foods.map((f) => (
              <div key={f.label} className={styles.food}>
                <div className={styles.foodHead}>
                  <span className={styles.foodName}>{f.label}</span>
                  <span
                    className={`${styles.foodTrack} ${
                      f.closestPresetHours != null &&
                      f.closestPresetHours !== f.loggedPresetHours
                        ? styles.foodTrackDiffers
                        : ''
                    }`}
                  >
                    {f.closestPresetHours != null
                      ? `tracks ${f.closestPresetHours}h`
                      : '—'}
                  </span>
                </div>
                <div className={styles.foodStats}>
                  <span>
                    <b>{f.mealCount}</b> meals
                  </span>
                  <span>
                    <b>{f.medianGrams}</b> g median
                  </span>
                  <span>
                    entered <b>{f.loggedPresetHours}h</b>
                  </span>
                  <span>
                    peak <b>{f.medianMinutesToPeak != null ? formatMinutes(f.medianMinutesToPeak) : '—'}</b>
                  </span>
                  <span>
                    done <b>{f.medianMinutesTo90 != null ? formatMinutes(f.medianMinutesTo90) : '—'}</b>
                  </span>
                </div>
                <p className={styles.foodNote}>{f.note}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : a.cleanMeals > 0 ? (
        <Section label="By food" title="What each plate tracks">
          <p className={styles.empty}>
            No food has {MIN_MEALS_PER_FOOD}+ cleanly-read meals yet. Labelling
            carb entries in Loop (the food-type field) is what feeds this table.
          </p>
        </Section>
      ) : null}
    </>
  );
}

function PresetCard({ preset: p }: { preset: PresetGroup }) {
  // Marked entries (🥜/🍲) are individual cases: the card says which curve the
  // fork graded them against, and every "model:" figure below comes from it.
  const marked = p.modelKind !== 'piecewise';
  return (
    <Section
      label={marked ? `${p.presetHours}h · ${p.modelLabel}` : `${p.presetHours}h preset`}
      title={`Entered at ${p.presetHours} hours`}
      description={
        marked
          ? `These entries carry the ${p.modelLabel.replace(' curve', '')} marker, so they are compared against that curve — not the standard piecewise shape.`
          : undefined
      }
      action={
        <span className={`${styles.verdict} ${styles[`verdict_${p.verdict}`]}`}>
          {verdictLabel[p.verdict]}
        </span>
      }
    >
      {p.curve.length > 3 ? <PresetCurve preset={p} /> : null}

      <div className={styles.presetStats}>
        <StatRow
          label="Meals read"
          value={`${p.mealCount} of ${p.loggedCount} logged`}
        />
        <StatRow
          label="Peak impact"
          value={p.medianMinutesToPeak != null ? formatMinutes(p.medianMinutesToPeak) : '—'}
          compare={`model: ${formatMinutes(p.modeledPeakStart)}–${formatMinutes(p.modeledPeakEnd)}`}
        />
        <StatRow
          label="Half done"
          value={p.medianMinutesTo50 != null ? formatMinutes(p.medianMinutesTo50) : '—'}
        />
        <StatRow
          label="90% done"
          value={p.medianMinutesTo90 != null ? formatMinutes(p.medianMinutesTo90) : '—'}
          compare={`model: ${formatMinutes(p.modeledMinutesTo90)}`}
        />
        {p.stillGoingSharePct > 0 ? (
          <StatRow
            label="Still going at window end"
            value={`${p.stillGoingSharePct}%`}
          />
        ) : null}
        {p.impliedVsLoggedPct != null ? (
          <StatRow
            label="Observed vs logged grams"
            value={`${p.impliedVsLoggedPct}%`}
            compare="at current carb sensitivity"
          />
        ) : null}
      </div>

      <p className={styles.note}>{p.note}</p>
    </Section>
  );
}

/** Observed median cumulative % against the modelled curve, with the preset's
 *  own end marked — the picture of "finishes early" or "outlasts". */
function PresetCurve({ preset: p }: { preset: PresetGroup }) {
  const W = 320;
  const H = 120;
  const PAD_L = 6;
  const PAD_R = 6;
  const PAD_T = 8;
  const PAD_B = 20;

  const maxMinute = Math.max(
    p.curve[p.curve.length - 1].minute,
    p.presetMinutes * 1.1,
  );
  const x = (m: number) => PAD_L + (m / maxMinute) * (W - PAD_L - PAD_R);
  const y = (pct: number) => PAD_T + (1 - pct / 100) * (H - PAD_T - PAD_B);

  const path = (key: 'observedPct' | 'modeledPct') =>
    p.curve
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(pt.minute).toFixed(1)},${y(pt[key]).toFixed(1)}`)
      .join(' ');

  const hourTicks: number[] = [];
  for (let m = 60; m <= maxMinute; m += 60) hourTicks.push(m);

  return (
    <>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cumulative absorption for the ${p.presetHours} hour preset: observed median against the modelled curve. Observed 90% at ${
          p.medianMinutesTo90 != null ? formatMinutes(p.medianMinutesTo90) : 'beyond the window'
        }, modelled at ${formatMinutes(p.modeledMinutesTo90)}.`}
      >
        {hourTicks.map((m) => (
          <g key={m}>
            <line x1={x(m)} y1={PAD_T} x2={x(m)} y2={H - PAD_B} className={styles.gridLine} />
            <text x={x(m)} y={H - 7} className={styles.axisText} textAnchor="middle">
              {m / 60}h
            </text>
          </g>
        ))}
        {/* where the preset says the meal ends */}
        <line
          x1={x(p.presetMinutes)}
          y1={PAD_T}
          x2={x(p.presetMinutes)}
          y2={H - PAD_B}
          className={styles.presetEndLine}
        />
        <path d={path('modeledPct')} className={styles.modeledLine} />
        <path d={path('observedPct')} className={styles.observedLine} />
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchObserved}`} aria-hidden />
          Observed (median)
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchModeled}`} aria-hidden />
          Preset models
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchEnd}`} aria-hidden />
          Preset ends
        </span>
      </div>
    </>
  );
}

function StatRow({
  label,
  value,
  compare,
}: {
  label: string;
  value: string;
  compare?: string;
}) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>
        {value}
        {compare ? <span className={styles.statCompare}> · {compare}</span> : null}
      </span>
    </div>
  );
}
