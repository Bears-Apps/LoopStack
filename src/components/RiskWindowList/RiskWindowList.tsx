import { useRiskWindows } from '@/data/sources/hooks';
import { isSample } from '@/data/sources/hooks';
import { Section } from '@/components/Section/Section';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import styles from './RiskWindowList.module.css';

// The recurring low and high stretches, on screen.
//
// The engine that finds these is the app's most carefully-built one — it counts
// weeks rather than readings, so a single rough Friday cannot manufacture a
// pattern — and until now its only surface was a toggle in notification
// settings. You could switch the alerts on; you could not look at what they
// were watching. All three auditors reached the same conclusion independently.
//
// Deliberately reports the recurrence rather than any response to it: "4 of the
// last 6 weeks" is the finding. What to do about a Friday afternoon belongs to
// the person, and this is not a surface the dosing carve-out covers.

export function RiskWindowList() {
  const result = useRiskWindows();
  const windows = result.data ?? [];

  if (result.loading) return null;

  return (
    <Section
      label="Recurring windows"
      description="Stretches that have repeatedly run low or high, counted in weeks — one rough day is not a pattern."
    >
      {isSample(result) ? <SampleNote>Example windows.</SampleNote> : null}

      {windows.length === 0 ? (
        <p className={styles.empty}>
          Nothing recurring yet. A window needs the same stretch to go the same
          way across several weeks before it counts.
        </p>
      ) : (
        <ul className={styles.list}>
          {windows.map((w) => (
            <li key={w.id} className={`${styles.item} ${styles[`item_${w.kind}`]}`}>
              <div className={styles.head}>
                <span className={styles.label}>{w.label}</span>
                <span className={`${styles.badge} ${styles[`badge_${w.confidence}`]}`}>
                  {w.confidence === 'good' ? 'Established' : 'Building'}
                </span>
              </div>
              <span className={styles.detail}>
                Ran {w.kind} in {w.occurrences} of the last {w.weeksObserved} weeks
                {w.extremeMgdl ? ` · worst ${w.extremeMgdl} mg/dL` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
