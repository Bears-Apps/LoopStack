// The AGP curve and the five-band time-in-range bar, in the layout clinicians
// already read (VIS-10). Solid ground, never glass (GLASS-1).
import { AGP, READ } from '../data/current';
import { hourTick } from '../data/derive';

const PAD = { L: 34, R: 10, T: 10, B: 20 };

export function AgpChart({ W, H }: { W: number; H: number }) {
  const pw = W - PAD.L - PAD.R;
  const ph = H - PAD.T - PAD.B;
  const X = (h: number) => PAD.L + (h / 24) * pw;
  const Y = (g: number) => PAD.T + ((300 - g) / 260) * ph;
  const band = (lo: readonly number[], hi: readonly number[]) =>
    `M${AGP.hours.map((h, i) => `${X(h).toFixed(1)} ${Y(hi[i]).toFixed(1)}`).join('L')}L${[...AGP.hours].reverse().map((h, i) => `${X(h).toFixed(1)} ${Y(lo[lo.length - 1 - i]).toFixed(1)}`).join('L')}Z`;
  const minP5 = Math.min(...AGP.p5);
  const label = `AGP, 14 days, glucose by time of day. The median stays between 124 and 162 mg/dL, inside the 70 to 180 range all day. The 5th percentile dips to ${minP5} mg/dL around 4pm, the only time it goes below 70. The 95th percentile peaks at 256 mg/dL around 8pm.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <rect x={PAD.L} y={Y(180)} width={pw} height={Y(70) - Y(180)} style={{ fill: 'var(--range-in-soft)' }} />
      <path d={band(AGP.p5, AGP.p95)} style={{ fill: 'var(--surface-2)' }} />
      <path d={band(AGP.p25, AGP.p75)} style={{ fill: 'var(--ink-300)' }} opacity="0.8" />
      {[70, 180].map((v) => (
        <g key={v}>
          <line x1={PAD.L} x2={PAD.L + pw} y1={Y(v)} y2={Y(v)} style={{ stroke: 'var(--brand-primary-hover)' }} strokeWidth="1.5" />
          <text x={PAD.L - 5} y={Y(v) + 4} fontSize="11" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>
        </g>
      ))}
      <path d={`M${AGP.hours.map((h, i) => `${X(h).toFixed(1)} ${Y(AGP.p50[i]).toFixed(1)}`).join('L')}`} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.5" strokeLinejoin="round" />
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <text key={h} x={X(h)} y={H - 4} fontSize="11" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} style={{ fill: 'var(--ink-700)' }}>{hourTick(h % 24)}</text>
      ))}
    </svg>
  );
}

export const bands = () => [
  { key: 'very-high', label: 'Very high', range: 'over 250', pct: READ.veryHighPct, fill: 'var(--range-very-high)' },
  { key: 'high', label: 'High', range: '181–250', pct: READ.highPct, fill: 'var(--range-high)' },
  { key: 'in', label: 'In range', range: '70–180', pct: READ.inRangePct, fill: 'var(--range-in)' },
  { key: 'low', label: 'Low', range: '54–69', pct: READ.lowPct, fill: 'var(--range-low)' },
  { key: 'very-low', label: 'Very low', range: 'under 54', pct: READ.veryLowPct, fill: 'var(--range-very-low)' },
] as const;

/** The stacked five-band bar, high at the top as on the AGP report. Labels carry the numbers (COL-5). */
export function TirBar({ W, H, labels = true }: { W: number; H: number; labels?: boolean }) {
  const barW = Math.min(36, W * 0.3);
  // Tiny bands still get 3px so they stay visible.
  const min = 3;
  const total = bands().reduce((t, b) => t + Math.max(min, (b.pct / 100) * H), 0);
  let y = 0;
  const label = `Time in range, 14 days: ${bands().map((b) => `${b.label.toLowerCase()} ${b.pct}%`).join(', ')}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      {bands().map((b) => {
        const h = (Math.max(min, (b.pct / 100) * H) / total) * H;
        const y0 = y;
        y += h;
        return (
          <g key={b.key}>
            <rect x="0" y={y0} width={barW} height={Math.max(1, h - 1)} rx="2" style={{ fill: b.fill }} />
            {labels && (
              <text x={barW + 10} y={Math.min(H - 3, Math.max(11, y0 + h / 2 + 4))} fontSize={b.key === 'in' ? 13 : 11} fontWeight={b.key === 'in' ? 600 : 400} style={{ fill: b.key === 'in' ? 'var(--ink-900)' : 'var(--ink-700)' }}>
                {b.label} {b.pct}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
