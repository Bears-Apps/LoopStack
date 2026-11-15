import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import { MetricTile } from '@/components/MetricTile/MetricTile';
import { isSample, useBasalInsights } from '@/data/sources/hooks';
import { formatStart } from '@/data/loopTherapySchedules';
import type { BasalHourBlock } from '@/lib/metabolism/basalInsights';
import styles from './BasalHub.module.css';

// The basal hub — what Insights opens on.
//
// Basal is the setting that runs 24 hours a day and gets the least attention,
// because unlike a meal there is no obvious moment to judge it. The honest
// read is the quiet stretches: no food, no bolus, just background insulin. This
// screen shows what glucose did in those stretches, block by block, and how
// many of them it had to work from.

const verdictLabel: Record<BasalHourBlock['verdict'], string> = {
  flat: 'Holding',
  drifts_up: 'Drifts up',
  drifts_down: 'Drifts down',
  building: 'Building',
};

export function BasalHub() {
  const result = useBasalInsights();
  const b = result.data;

  if (!b) {
    return (
      <Section label="Basal" title="Background insulin">
        <p className={styles.empty}>
          {result.loading
            ? 'Reading your quiet stretches…'
            : result.error
              ? result.error.message
              : 'No basal read yet — this needs glucose history with stretches where nothing else was happening.'}
        </p>
      </Section>
    );
  }

  const anyReadable = b.blocks.some((x) => x.verdict !== 'building');

  return (
    <>
      <Section
        label="Basal"
        title="Background insulin"
        description="What glucose did when nothing else was acting — no food, no bolus. That is the only view where movement can be laid at the schedule's door."
      >
        <div className={styles.tiles}>
          {/* One decimal on both, and on the delta.
              These read 14.82 next to 16.4 next to "+1.58 vs scheduled":
              three precisions across two tiles that exist to be subtracted
              from each other, so the arithmetic did not visibly close. */}
          <MetricTile
            label="Scheduled"
            value={b.scheduledDailyU.toFixed(1)}
            unit="U/day"
            sublabel="from your Loop schedule"
          />
          {b.deliveredDailyU != null ? (
            <MetricTile
              label="Delivered"
              value={b.deliveredDailyU.toFixed(1)}
              unit="U/day"
              sublabel={
                b.deliveryDeltaU != null
                  ? `${b.deliveryDeltaU > 0 ? '+' : ''}${b.deliveryDeltaU.toFixed(1)} vs scheduled`
                  : undefined
              }
            />
          ) : (
            <MetricTile
              label="Delivered"
              value="—"
              sublabel="needs Apple Health — Nightscout here is bolus-only"
            />
          )}
          <MetricTile
            label="Quiet stretches"
            value={b.fastingWindows.length}
            sublabel={`found in ${b.windowDays}d`}
          />
        </div>
        {isSample(result) ? (
          <SampleNote>Basal figures are example data.</SampleNote>
        ) : null}
      </Section>

      <Section
        label="By time of day"
        title="Where the day drifts"
        description="A block reads only once there are enough quiet stretches inside it. Until then it says so rather than guessing."
      >
        <div className={styles.blocks}>
          {b.blocks.map((blk) => (
            <div key={blk.label} className={styles.block}>
              <div className={styles.blockHead}>
                <div className={styles.blockName}>
                  <span className={styles.blockLabel}>{blk.label}</span>
                  <span className={styles.blockHours}>
                    {formatStart(blk.startHour * 60)} – {formatStart((blk.endHour % 24) * 60)}
                  </span>
                </div>
                <span className={`${styles.verdict} ${styles[`verdict_${blk.verdict}`]}`}>
                  {verdictLabel[blk.verdict]}
                </span>
              </div>
              <div className={styles.blockStats}>
                <span>
                  <b>{blk.scheduledRate}</b> U/hr scheduled
                </span>
                {blk.verdict !== 'building' ? (
                  <span>
                    <b>
                      {blk.avgDriftPerHour > 0 ? '+' : ''}
                      {blk.avgDriftPerHour}
                    </b>{' '}
                    mg/dL per hour
                  </span>
                ) : null}
                <span>
                  <b>{blk.windowCount}</b> stretch{blk.windowCount === 1 ? '' : 'es'}
                </span>
              </div>
              <p className={styles.blockNote}>{blk.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {b.suggestions.length > 0 ? (
        <Section
          label="Worth reviewing"
          title="What the drift points at"
          description="Discussion points for your care team — LoopStack never proposes a rate."
        >
          <ul className={styles.suggestions}>
            {b.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Section>
      ) : anyReadable ? (
        <Section label="Worth reviewing">
          <p className={styles.empty}>
            Nothing stands out. The blocks that could be read held steady, which
            is the result you want from a basal schedule.
          </p>
        </Section>
      ) : null}
    </>
  );
}
