import { SampleNote } from '@/components/SampleTag/SampleTag';
import type { InsulinLedger } from '@/lib/metabolism/insulinLedger';
import { peakHourlyUnits } from '@/lib/metabolism/insulinLedger';
import styles from './InsulinLedgerCard.module.css';

type Props = {
  ledger: InsulinLedger;
  sample?: boolean;
};

// Loop's automatic micro-dosing, accumulated by hour — the "when" behind the
// day's total insulin. Basal (background) and bolus (meals/corrections) are
// stacked and kept distinct, since they read completely differently.

const HOUR_TICKS = [0, 6, 12, 18]; // 12a · 6a · 12p · 6p

function tick(h: number): string {
  const period = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

export function InsulinLedgerCard({ ledger, sample = false }: Props) {
  const { hourly } = ledger;
  const totalBasal = +hourly.reduce((a, h) => a + h.basalU, 0).toFixed(1);
  const totalBolus = +hourly.reduce((a, h) => a + h.bolusU, 0).toFixed(1);
  const total = +(totalBasal + totalBolus).toFixed(1);
  const peak = peakHourlyUnits(hourly);

  if (total === 0) {
    return (
      <section className={styles.card} aria-label="Insulin timing today">
        <div className={styles.head}>
          <span className={styles.kicker}>Insulin timing</span>
          <span className={styles.today}>Today</span>
        </div>
        <p className={styles.empty}>No insulin recorded yet today.</p>
      </section>
    );
  }

  // Busiest bolus hour, for the one-line takeaway.
  const peakBolus = hourly.reduce((a, h) => (h.bolusU > a.bolusU ? h : a));

  return (
    <section className={styles.card} aria-label="Insulin timing today">
      <div className={styles.head}>
        <span className={styles.kicker}>Insulin timing</span>
        <span className={styles.today}>Today</span>
      </div>

      <div className={styles.summary}>
        <span className={styles.total}>
          <span className="num">{total}</span>
          <span className={styles.totalUnit}>U delivered</span>
        </span>
        <span className={styles.breakdown}>
          <span className={styles.legItem}>
            <span className={`${styles.dot} ${styles.dotBasal}`} />
            <span className="num">{totalBasal}</span> basal
          </span>
          <span className={styles.legItem}>
            <span className={`${styles.dot} ${styles.dotBolus}`} />
            <span className="num">{totalBolus}</span> bolus
          </span>
        </span>
      </div>

      <div
        className={styles.chart}
        role="img"
        aria-label={`Hourly insulin today: ${total} units total, ${totalBasal} basal and ${totalBolus} bolus, busiest around ${tick(peakBolus.hour)}.`}
      >
        {hourly.map((h) => {
          const basalPct = (h.basalU / peak) * 100;
          const bolusPct = (h.bolusU / peak) * 100;
          const empty = h.basalU + h.bolusU === 0;
          return (
            <span key={h.hour} className={styles.col} title={`${tick(h.hour)}: ${(h.basalU + h.bolusU).toFixed(2)}U`}>
              <span className={styles.track}>
                {empty ? (
                  <span className={styles.emptyMark} />
                ) : (
                  <>
                    <span className={styles.bolus} style={{ height: `${bolusPct}%` }} />
                    <span className={styles.basal} style={{ height: `${basalPct}%` }} />
                  </>
                )}
              </span>
            </span>
          );
        })}
      </div>
      <div className={styles.axis}>
        {HOUR_TICKS.map((h) => (
          <span key={h} className={styles.axisTick} style={{ left: `${(h / 24) * 100}%` }}>
            {tick(h)}
          </span>
        ))}
      </div>

      {totalBolus > 0 ? (
        <p className={styles.takeaway}>
          Most bolus insulin went in around <b>{tick(peakBolus.hour)}</b>.
        </p>
      ) : null}

      {sample ? <SampleNote>Insulin timing is example data.</SampleNote> : null}
    </section>
  );
}
