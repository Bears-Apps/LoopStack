import { Section, Row } from '@/components/Section/Section';
import { EvidenceCard } from '@/components/EvidenceCard/EvidenceCard';
import { SampleNote } from '@/components/SampleTag/SampleTag';
import type { FitnessTrend, HealthConnection } from '@/data/types';
import styles from './Profile.module.css';

type Props = {
  connections: HealthConnection[];
  fitness: FitnessTrend | null;
  onToggle: (id: HealthConnection['id']) => void;
};

export function HealthConnections({ connections, fitness, onToggle }: Props) {
  return (
    <Section
      label="Data sources"
      title="Health connections"
      description="Connect sources to continuously refine your ISF, carb estimation, and suggested Loop inputs."
    >
      {/* Every mock number in this app carries a disclosure except the one
          that says whether the numbers are real. These rows are hand-authored
          in userProfile.ts — three fixed "Connected" states and a fixed
          last-sync date — and the toggles only flip a label. Sources (above)
          is what actually reports the live source, and the dashboard is
          simultaneously telling the user "example data until Apple Health
          wiring lands", so the two screens contradicted each other with
          nothing on either to say which was right. */}
      <SampleNote>
        Placeholder statuses, and the toggles do not connect anything. The
        source actually being read is under Data → Sources above.
      </SampleNote>

      {connections.map((c) => (
        <Row
          key={c.id}
          label={c.label}
          hint={c.connected ? `Last sync ${formatSync(c.lastSync)}` : 'Not connected'}
          onClick={() => onToggle(c.id)}
          trailing={
            <span className={`${styles.connTag} ${c.connected ? styles.connOn : ''}`}>
              {c.connected ? 'Connected' : 'Connect'}
            </span>
          }
        />
      ))}

      {fitness ? (
        <div className={styles.fitnessCallout}>
          <div className={styles.fitnessHeader}>
            <span className="label">Current fitness trend</span>
            <span className={styles.fitnessBadge}>
              {fitness.delta14d >= 0 ? '↑' : '↓'}
              {Math.abs(Math.round(fitness.delta14d * 100))}% · 14d
            </span>
          </div>
          <p className={styles.fitnessSummary}>{fitness.summary}</p>
          <div className={styles.fitnessStat}>
            <span className="label">Applied ISF multiplier</span>
            <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>
              ×{fitness.isfMultiplier.toFixed(2)}
            </span>
          </div>
          {/* This multiplier is not decorative — insulinStrategy.ts multiplies
              total units by it. A seeded value that really does move a dose has
              to say it was seeded. */}
          <SampleNote>
            Example figure. It still scales the strategy engine's total, so
            treat any dose it produced as example-derived too.
          </SampleNote>
        </div>
      ) : null}

      <EvidenceCard
        title="How fitness affects insulin strategy"
        summary="Apple Health data tunes ISF and upfront dosing automatically"
        body={
          <>
            <p>
              Improved cardiovascular fitness raises insulin sensitivity. When your 14-day
              activity load trends up, LoopStack applies an ISF multiplier below 1.0 — reducing
              total insulin per meal by the observed factor.
            </p>
            <ul>
              <li>Post-workout windows (24–48h) can carry 10–30% more sensitivity.</li>
              <li>Sedentary weeks push the multiplier back toward 1.0 or above.</li>
              <li>Sleep quality affects overnight basal needs, surfaced in patterns.</li>
            </ul>
            <p>
              When you enter a new meal, the suggested upfront dose and the hourly split are
              recomputed against the current multiplier. You can see which adjustments moved
              the numbers in the strategy card's "Why this split?" panel.
            </p>
          </>
        }
      />
    </Section>
  );
}

function formatSync(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const mins = Math.round((now - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}
