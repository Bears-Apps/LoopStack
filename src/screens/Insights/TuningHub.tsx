import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { MetricTile } from '@/components/MetricTile/MetricTile';
import { isSample, useAutosens, useAutotune, useSettingsReview } from '@/data/sources/hooks';
import { DAMPING, type Confidence } from '@/lib/metabolism/autotune';
import type { Autosens } from '@/lib/metabolism/autosens';
import type { SettingReview } from '@/lib/metabolism/settingsReview';
import styles from './TuningHub.module.css';

// The tuning hub: what weeks of history say about the settings themselves.
//
// Three readings sit here, and the difference between them is the point:
//
//   Sensitivity today  — a short-window signal about the last day. Context.
//   Basal by hour      — a slow read over weeks. The only one worth acting on.
//   Carb ratio         — the same slow read, and the first to become unreadable
//                        when meals go unlogged.
//
// Every figure carries the evidence behind it, and anything that failed its
// gate says so instead of showing a number. A confident-looking recommendation
// built on three days of patchy carb entries is worse than no recommendation.

const confidenceLabel: Record<Confidence, string> = {
  good: 'Readable',
  limited: 'Caveated',
  unusable: 'Not enough data',
};

const autosensLabel: Record<Autosens['verdict'], string> = {
  sensitive: 'More sensitive',
  resistant: 'More resistant',
  as_expected: 'As expected',
  building: 'Building',
};

function ConfidencePill({ level }: { level: Confidence }) {
  return (
    <span className={`${styles.pill} ${styles[`pill_${level}`]}`}>
      {confidenceLabel[level]}
    </span>
  );
}

export function TuningHub() {
  const autosensResult = useAutosens();
  const autotuneResult = useAutotune();
  const a = autosensResult.data;
  const t = autotuneResult.data;

  const sample = isSample(autotuneResult) || isSample(autosensResult);

  return (
    <>
      {/* ── sensitivity today ─────────────────────────────────────────── */}
      <Section
        label="Right now"
        title="Sensitivity today"
        description="How insulin has been behaving over the last day, measured only across stretches with no food in play. A short-window signal — useful as context for the day, not as a reason to change a setting."
      >
        {!a ? (
          <p className={styles.empty}>
            {autosensResult.loading
              ? 'Reading the last day…'
              : autosensResult.error
                ? autosensResult.error.message
                : 'Needs glucose and insulin history from a connected source.'}
          </p>
        ) : (
          <>
            <div className={styles.ratioRow}>
              <div className={styles.ratioMain}>
                <span className={`${styles.ratioValue} ${styles[`ratio_${a.verdict}`]}`}>
                  {a.verdict === 'building' ? '—' : `${Math.round(a.ratio * 100)}%`}
                </span>
                <span className={styles.ratioCaption}>
                  {autosensLabel[a.verdict]}
                  {a.clamped ? ' · at the limit' : ''}
                </span>
              </div>
              <div className={styles.ratioMeta}>
                <span>
                  <b>{a.cleanStepCount}</b> food-free readings
                </span>
                <span>
                  <b>{a.excludedStepCount}</b> set aside as meal time
                </span>
                {a.verdict !== 'building' ? (
                  <span>
                    <b>{a.negativeSharePct}%</b> fell below prediction
                  </span>
                ) : null}
              </div>
            </div>
            <p className={styles.note}>{a.note}</p>
          </>
        )}
        {sample ? <SampleNote>Sensitivity figures are example data.</SampleNote> : null}
      </Section>

      {!t ? (
        <Section label="Over weeks" title="Settings review">
          <p className={styles.empty}>
            {autotuneResult.loading
              ? 'Reading the last few weeks…'
              : autotuneResult.error
                ? autotuneResult.error.message
                : 'Needs several weeks of glucose, insulin and meal history.'}
          </p>
        </Section>
      ) : (
        <>
          {/* ── evidence quality, first, because it gates everything ───── */}
          <Section
            label="Evidence"
            title="How complete the record is"
            description="Every figure below depends on this. An unlogged meal looks exactly like an hour of missing basal, so the answer to 'how well were meals logged' decides what any of it is allowed to claim."
          >
            <div className={styles.tiles}>
              <MetricTile
                label="Days with data"
                value={t.daysWithData}
                sublabel={`of ${t.windowDays} in window`}
              />
              <MetricTile
                label="Days with meals"
                value={`${t.carbQuality.coveragePct}%`}
                sublabel={`${t.carbQuality.daysWithCarbs} of ${t.carbQuality.daysInWindow} days`}
              />
              <MetricTile
                label="Unexplained rises"
                value={`${t.carbQuality.uamSharePct}%`}
                sublabel="set aside, not blamed on basal"
              />
              {t.iobAgreement ? (
                <MetricTile
                  label="Matches Loop's IOB"
                  value={`${t.iobAgreement.agreementPct}%`}
                  sublabel={`${t.iobAgreement.sampleCount} checks against Loop`}
                />
              ) : null}
            </div>
            <p className={styles.note}>{t.carbQuality.note}</p>
            {t.iobAgreement ? (
              <p
                className={
                  t.iobAgreement.trustworthy ? styles.note : styles.warnNote
                }
              >
                {t.iobAgreement.note}
              </p>
            ) : null}
          </Section>

          {/* ── basal by hour ──────────────────────────────────────────── */}
          <Section
            label="Over weeks"
            title="Basal by hour"
            description={`Each hour read from food-free stretches across the window, then damped to ${Math.round(
              DAMPING * 100,
            )}% of the computed correction. This method is built to be run repeatedly — one nudge per pass, over weeks.`}
            action={<ConfidencePill level={t.basal.confidence} />}
          >
            {t.basal.confidence === 'unusable' ? (
              <p className={styles.empty}>{t.basal.note}</p>
            ) : (
              <>
                <div className={styles.tiles}>
                  <MetricTile
                    label="Scheduled"
                    value={t.basal.scheduledDailyU.toFixed(1)}
                    unit="U/day"
                    sublabel="from your Loop schedule"
                  />
                  <MetricTile
                    label="History points at"
                    value={t.basal.impliedDailyU.toFixed(1)}
                    unit="U/day"
                    sublabel={`${
                      t.basal.impliedDailyU >= t.basal.scheduledDailyU ? '+' : ''
                    }${(t.basal.impliedDailyU - t.basal.scheduledDailyU).toFixed(1)} vs scheduled`}
                  />
                </div>

                <div className={styles.hours}>
                  {t.basal.hours.map((h) => (
                    <HourBar
                      key={h.hour}
                      hour={h}
                      peak={Math.max(
                        0.1,
                        ...t.basal.hours.flatMap((x) => [x.scheduledRate, x.dampedRate]),
                      )}
                    />
                  ))}
                </div>
                <p className={styles.note}>{t.basal.note}</p>
              </>
            )}
          </Section>

          {/* ── ISF and carb ratio ─────────────────────────────────────── */}
          <Section
            label="Over weeks"
            title="Sensitivity and carb ratio"
            description="One figure each for the whole day. This method does not tune either by time of day, so a per-hour version of these numbers would be inventing detail the maths cannot support."
          >
            <ParameterRow
              name="Insulin sensitivity"
              unit="mg/dL per unit"
              current={t.isf.current}
              damped={t.isf.damped}
              confidence={t.isf.confidence}
              note={t.isf.note}
              higherIsStronger
            />
            <ParameterRow
              name="Carb ratio"
              unit="g per unit"
              current={t.carbRatio.current}
              damped={t.carbRatio.damped}
              confidence={t.carbRatio.confidence}
              note={t.carbRatio.note}
              extra={
                t.carbRatio.observedCsf != null
                  ? `Meals raised glucose about ${t.carbRatio.observedCsf} mg/dL per gram, against the ${t.carbRatio.seededCsf} your settings imply — read from ${t.carbRatio.mealCount} logged meals.`
                  : undefined
              }
            />
          </Section>

          {/* ── suggestions ────────────────────────────────────────────── */}
          {t.suggestions.length > 0 ? (
            <Section
              label="Worth reviewing"
              title="What the history points at"
              description="Discussion points for your care team. LoopStack never changes a setting and never proposes a dose — Loop and your clinician own those."
            >
              <ul className={styles.suggestions}>
                {t.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Section>
          ) : t.basal.confidence !== 'unusable' ? (
            <Section label="Worth reviewing">
              <p className={styles.empty}>
                Nothing stands out. What could be read lines up with the settings
                on file, which is the result you want.
              </p>
            </Section>
          ) : null}
        </>
      )}

      <SettingsRoster sample={sample} />
    </>
  );
}

// One row for every setting Loop's UI exposes — the roster the deep engines
// hang off. A setting with no evidence still gets its row, saying so; a
// missing row would read as "nothing to see" when the truth is "nothing
// measured yet".
function SettingsRoster({ sample }: { sample: boolean }) {
  const result = useSettingsReview();
  const review = result.data;

  return (
    <Section
      label="The full roster"
      title="Every Loop setting, reviewed"
      description="Each setting Loop exposes, matched against what the backlog shows: the value on file, the reading the history supports, and a confidence grade stating what that evidence can carry. Review points for you and your care team — changes still happen in Loop."
    >
      {!review ? (
        <p className={styles.empty}>
          {result.loading
            ? 'Reading the backlog…'
            : result.error
              ? result.error.message
              : 'Needs a connected source.'}
        </p>
      ) : (
        <div className={styles.roster}>
          {review.items.map((item) => (
            <RosterRow key={item.id} item={item} />
          ))}
        </div>
      )}
      {review && sample ? (
        <SampleNote>Settings readings are example data.</SampleNote>
      ) : null}
    </Section>
  );
}

function RosterRow({ item }: { item: SettingReview }) {
  return (
    <div className={styles.rosterRow}>
      <div className={styles.rosterHead}>
        <span className={styles.rosterName}>{item.label}</span>
        <ConfidencePill level={item.confidence} />
      </div>
      <div className={styles.rosterValues}>
        <span className={styles.rosterCurrent}>{item.current}</span>
        {item.reading ? (
          <>
            <span className={styles.rosterArrow} aria-hidden>→</span>
            <span className={styles.rosterReading}>{item.reading}</span>
          </>
        ) : null}
      </div>
      <p className={styles.rosterNote}>{item.note}</p>
      <span className={styles.rosterEvidence}>{item.evidence}</span>
    </div>
  );
}

function HourBar({
  hour,
  peak,
}: {
  hour: {
    hour: number;
    scheduledRate: number;
    dampedRate: number;
    deltaU: number;
    confidence: Confidence;
    stepCount: number;
  };
  /** Largest rate anywhere in the chart. Bars are scaled against this rather
   *  than against each row's own maximum — a per-row scale makes every bar run
   *  nearly full width, so a 0.40 U/hr hour looks identical to a 0.80 one and
   *  the chart stops carrying any information at all. */
  peak: number;
}) {
  const unreadable = hour.confidence === 'unusable';
  const schedPct = (hour.scheduledRate / peak) * 100;
  const impliedPct = (hour.dampedRate / peak) * 100;

  return (
    <div className={`${styles.hour} ${unreadable ? styles.hourMuted : ''}`}>
      <span className={styles.hourLabel}>{String(hour.hour).padStart(2, '0')}</span>
      <div className={styles.hourBars}>
        <div className={styles.hourTrack}>
          <div className={styles.hourScheduled} style={{ width: `${schedPct}%` }} />
        </div>
        <div className={styles.hourTrack}>
          {/* An hour with too little data draws an empty track, never a bar.
              Filling it to the scheduled rate would render a confident-looking
              recommendation for an hour that was never read. */}
          {unreadable ? null : (
            <div
              className={`${styles.hourImplied} ${
                hour.deltaU > 0 ? styles.hourUp : hour.deltaU < 0 ? styles.hourDown : ''
              }`}
              style={{ width: `${impliedPct}%` }}
            />
          )}
        </div>
      </div>
      <span className={styles.hourValue}>
        {unreadable ? (
          <span className={styles.hourNoData}>no data</span>
        ) : (
          <>
            {hour.scheduledRate.toFixed(2)}
            <span className={styles.hourArrow} aria-hidden> → </span>
            <b>{hour.dampedRate.toFixed(2)}</b>
          </>
        )}
      </span>
    </div>
  );
}

function ParameterRow({
  name,
  unit,
  current,
  damped,
  confidence,
  note,
  extra,
  higherIsStronger = false,
}: {
  name: string;
  unit: string;
  current: number;
  damped: number | null;
  confidence: Confidence;
  note: string;
  extra?: string;
  higherIsStronger?: boolean;
}) {
  const pct =
    damped != null && current > 0 ? Math.round(((damped - current) / current) * 100) : 0;

  return (
    <div className={styles.param}>
      <div className={styles.paramHead}>
        <span className={styles.paramName}>{name}</span>
        <ConfidencePill level={confidence} />
      </div>
      <div className={styles.paramValues}>
        <div className={styles.paramValue}>
          <span className={styles.paramNumber}>{current}</span>
          <span className={styles.paramCaption}>on file</span>
        </div>
        <span className={styles.paramArrow} aria-hidden>→</span>
        <div className={styles.paramValue}>
          <span className={styles.paramNumber}>
            {confidence === 'unusable' || damped == null ? '—' : damped}
          </span>
          <span className={styles.paramCaption}>
            {confidence === 'unusable' || damped == null
              ? 'not readable'
              : `history points at${
                  pct !== 0
                    ? ` · ${pct > 0 ? '+' : ''}${pct}%${higherIsStronger && pct !== 0 ? '' : ''}`
                    : ''
                }`}
          </span>
        </div>
        <span className={styles.paramUnit}>{unit}</span>
      </div>
      {extra ? <p className={styles.paramExtra}>{extra}</p> : null}
      <p className={styles.note}>{note}</p>
    </div>
  );
}
