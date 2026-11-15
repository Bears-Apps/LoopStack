// One stretch, day by day: delivered basal per hour as bars against the
// scheduled rate (dotted, VIS-A1), with 6am glucose alongside when the stretch
// starts at 6am (the only glucose the synthetic set carries per morning).
import { useId } from 'react';
import { morningValue, rangeLabel } from '../data/derive';
import { DAYS, G6, NOT_COUNTED, SCHED, STATE } from '../data/current';
import { Hatch } from '../ui/kit';

const LW = 46;
const RH = 22;
const TOP = 30;
const MAX = 1.2;

export function MorningsChart({ from, to, label, W = 350 }: { from: number; to: number; label: string; W?: number }) {
  const uid = useId().replace(/:/g, '');
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const withGlucose = from === 6;
  const GW = withGlucose ? 66 : 0;
  const n = hours.length;
  const bw = (W - LW - GW - 8 * n) / n;
  const sc = (v: number) => (v / MAX) * (bw - 8);
  const H = TOP + DAYS.length * RH + 6;
  const ink = { fill: 'var(--ink-900)' };
  const muted = { fill: 'var(--ink-700)' };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <defs><Hatch id={`${uid}h`} /></defs>
      {hours.map((h, j) => {
        const x0 = LW + j * (bw + 8);
        const sx = x0 + sc(SCHED[h]);
        return (
          <g key={h}>
            <text x={x0} y="11" fontSize="11" fontWeight="600" style={{ fill: 'var(--accent-info-ink)' }}>{rangeLabel(h, h + 1)}</text>
            <text x={x0} y="24" fontSize="10" style={muted}>0</text>
            <text x={x0 + bw - 8} y="24" fontSize="10" textAnchor="end" style={muted}>{MAX} U/h</text>
            <line x1={sx} y1={TOP - 2} x2={sx} y2={H - 4} style={{ stroke: 'var(--ink-900)' }} strokeWidth="1" strokeDasharray="2 2" />
          </g>
        );
      })}
      {withGlucose && (
        <>
          <text x={W - GW} y="11" fontSize="11" fontWeight="500" style={muted}>Glucose</text>
          <text x={W - GW} y="24" fontSize="10" style={muted}>6am, mg/dL</text>
        </>
      )}
      {DAYS.map((d, i) => {
        const y = TOP + i * RH;
        const nc = d === NOT_COUNTED;
        const g = G6[d];
        return (
          <g key={d}>
            <text x="0" y={y + 14} fontSize="11" style={{ fill: 'var(--ink-700)' }}>{d}</text>
            {hours.map((h, j) => {
              const x0 = LW + j * (bw + 8);
              if (nc) return <rect key={h} x={x0} y={y + 5} width={bw - 8} height="11" rx="2" fill={`url(#${uid}h)`} style={{ stroke: 'var(--ink-400)' }} strokeWidth="0.8" opacity="0.6" />;
              const st = STATE[d][h];
              const w = Math.max(sc(morningValue(i, h)), 2);
              const fill = st === 'l' ? 'var(--hour-less-mark)' : st === 'm' ? 'var(--graph-insulin)' : st === 's' ? 'var(--ink-700)' : 'var(--ink-300)';
              const ex = x0 + w + 3;
              return (
                <g key={h}>
                  <rect x={x0} y={y + 5} width={w} height="11" rx="2" style={{ fill }} />
                  {st === 'l' && <path d={`M${ex} ${y + 8}L${ex + 5} ${y + 8}L${ex + 2.5} ${y + 12}Z`} style={ink} />}
                  {st === 'm' && <path d={`M${ex} ${y + 12}L${ex + 5} ${y + 12}L${ex + 2.5} ${y + 8}Z`} style={ink} />}
                  {st === 's' && (
                    <>
                      <rect x={ex} y={y + 6} width="1.6" height="9" style={ink} />
                      <rect x={ex + 3.4} y={y + 6} width="1.6" height="9" style={ink} />
                    </>
                  )}
                </g>
              );
            })}
            {withGlucose && (g ? (
              <>
                <text x={W - GW} y={y + 14} fontSize="12" fontWeight="600" style={ink}>{g.mgdl}</text>
                <text x={W - GW + 26} y={y + 14} fontSize="12" style={muted}>{g.trend}</text>
              </>
            ) : (
              <text x={W - GW} y={y + 14} fontSize="11" style={{ fill: 'var(--ink-700)' }}>not counted</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
