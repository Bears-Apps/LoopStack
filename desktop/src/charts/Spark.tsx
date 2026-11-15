// Each usable day's delivered rate for one hour, as dots; the dotted line is the schedule.
// Decorative inside a table row whose cells already state the numbers.
import { sparkValue, USABLE } from '../data/derive';
import { SCHED, STATE } from '../data/current';

const W = 86;
const H = 14;
const sc = (v: number) => H - 1 - (v / 1.2) * (H - 2);
const DOT = { a: 'var(--ink-500)', l: 'var(--hour-less-dot)', m: 'var(--graph-insulin)', s: 'var(--ink-700)', x: 'var(--ink-300)' } as const;

export function Spark({ h }: { h: number }) {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1="0" y1={sc(SCHED[h])} x2={W} y2={sc(SCHED[h])} style={{ stroke: 'var(--ink-900)' }} strokeWidth="1" strokeDasharray="2 2" />
      {USABLE.map((d, i) => (
        <circle key={d} cx={3 + (i * (W - 6)) / 12} cy={Math.max(1.9, sc(sparkValue(i, h)))} r="1.9" style={{ fill: DOT[STATE[d][h]] }} />
      ))}
    </svg>
  );
}
