// "What Loop did": 14 days × 24 hours (or 8 three-hour blocks). Each cell is
// delivered insulin against the schedule; state is carried by colour AND glyph
// (triangle down = less, up = more, pause = suspended, hatch = no data).
import { useId } from 'react';
import { blocks, count, hourTick, hourVerdict, rangeLabel, stretchOf, USABLE, USABLE_N, type Mode } from '../data/derive';
import { DAYS, NOT_COUNTED, NOT_COUNTED_CAUSE, RUN_DAYS, RUN_TIME, STATE, type Day, type HourState } from '../data/current';
import { Hatch, STATE_FILL } from '../ui/kit';

// Geometry is in real pixels: the caller passes the width it measured, so
// labels stay 11px at any tile size (desktop tiles run 300–1400px wide).
const LW = 50;
const TOP = 18;
const RG = 2;

export function gridGeom(mode: Mode, W = 350, RH = 15) {
  const N = mode === 'hours' ? 24 : 8;
  const GAP = mode === 'hours' ? 1.5 : 3;
  const cw = (W - LW - GAP * (N - 1)) / N;
  const pitch = cw + GAP;
  const x = (c: number) => LW + c * pitch;
  const gh = TOP + DAYS.length * (RH + RG);
  const histTop = gh + 8;
  const histH = 30;
  const H = histTop + histH + 16;
  return { N, GAP, cw, pitch, x, gh, histTop, histH, H, W, LW, RH, span: mode === 'hours' ? 1 : 3 };
}

function columnStates(mode: Mode): ((d: Day) => HourState)[] {
  if (mode === 'hours') return Array.from({ length: 24 }, (_, h) => (d: Day) => STATE[d][h]);
  return blocks().map((b) => (d: Day) => b.states[d]);
}

/** Stretches worth labelling under the histogram: columns with a non-"about" verdict, grouped. */
function histLabels(mode: Mode): { a: number; b: number; text: string }[] {
  const out: { a: number; b: number; text: string }[] = [];
  if (mode === 'blocks') {
    for (const b of blocks()) {
      if (b.verdict === 'a') continue;
      out.push({ a: b.index, b: b.index + 1, text: b.verdict === 's' ? 'Fri' : String(b.counts[b.verdict]) });
    }
    return out;
  }
  for (let h = 0; h < 24; ) {
    const v = hourVerdict(h);
    const [a, b] = stretchOf('hours', h);
    if (v !== 'a') {
      const texts = Array.from({ length: b - a }, (_, i) => String(count(a + i, v)));
      out.push({ a, b, text: v === 's' ? 'Fri' : texts.join(' · ') });
    }
    h = b;
  }
  return out;
}

export function HourGrid({ mode, sel, onSelect, label, valueText, W, RH = 15, interactive = true }: {
  mode: Mode;
  sel: number;
  onSelect?: (col: number) => void;
  label: string;
  valueText: string;
  W: number;
  RH?: number;
  /** The glance face draws the grid without the scrubber. */
  interactive?: boolean;
}) {
  const g = gridGeom(mode, W, RH);
  const uid = useId().replace(/:/g, '');
  const cols = columnStates(mode);
  const [a, b] = mode === 'hours' ? stretchOf('hours', sel) : [sel * 3, sel * 3 + 3];
  const bandA = mode === 'hours' ? a : sel;
  const bandB = mode === 'hours' ? b : sel + 1;
  const bandX = g.x(bandA) - g.GAP;
  const bandW = (bandB - bandA) * g.pitch + g.GAP;
  const bandLabel = rangeLabel(a, b).replace(/m$/, '').replace(/m–/, '–');
  const lineX = g.x(sel) + g.cw / 2;

  // Size the native range thumb to one column, so a tap lands on the column under the finger.
  const thumb = g.pitch;

  const ink = { fill: 'var(--ink-900)' };
  const rows = DAYS.map((d, i) => {
    const y = TOP + i * (RH + RG);
    const nc = d === NOT_COUNTED;
    const op = nc ? 0.45 : 1;
    const isFri = d.startsWith('Fri');
    return (
      <g key={d}>
        <text x="0" y={y + RH / 2 + 4} fontSize="11" fontWeight={isFri ? 600 : 400} style={{ fill: isFri && !nc ? 'var(--ink-900)' : 'var(--ink-700)' }}>{d}</text>
        {cols.map((stOf, c) => {
          const st = stOf(d);
          const cx = g.x(c);
          if (st === 'x') {
            return <rect key={c} x={cx} y={y} width={g.cw} height={RH} rx="2" fill={`url(#${uid}h)`} style={{ stroke: 'var(--ink-400)' }} strokeWidth="0.8" />;
          }
          const m = cx + g.cw / 2;
          return (
            <g key={c} opacity={op}>
              <rect x={cx} y={y} width={g.cw} height={RH} rx="2" style={{ fill: STATE_FILL[st] }} />
              {st === 'l' && <path d={`M${m - 2.6} ${y + RH / 2 - 2}L${m + 2.6} ${y + RH / 2 - 2}L${m} ${y + RH / 2 + 2}Z`} style={ink} />}
              {st === 'm' && <path d={`M${m - 2.6} ${y + RH / 2 + 2}L${m + 2.6} ${y + RH / 2 + 2}L${m} ${y + RH / 2 - 2}Z`} style={ink} />}
              {st === 's' && (
                <>
                  <rect x={m - 2.4} y={y + RH / 2 - 3.5} width="1.3" height="7" style={{ fill: 'var(--surface-0)' }} />
                  <rect x={m + 1.1} y={y + RH / 2 - 3.5} width="1.3" height="7" style={{ fill: 'var(--surface-0)' }} />
                </>
              )}
            </g>
          );
        })}
        {RUN_DAYS.includes(d) && RUN_TIME && (() => {
          if (!RUN_TIME) return null;
          const m = g.LW + ((RUN_TIME.start + RUN_TIME.end) / 2 / g.span) * g.pitch - g.GAP / 2;
          return <path d={`M${m} ${y + RH / 2 - 4}L${m + 3.4} ${y + RH / 2 + 2.5}L${m - 3.4} ${y + RH / 2 + 2.5}Z`} style={{ fill: 'var(--graph-activity)', stroke: 'var(--surface-0)' }} strokeWidth="0.8" />;
        })()}
        {nc && (() => {
          const from = mode === 'hours' ? 8 : 2;
          const x0 = g.x(from) + 1;
          return (
            <>
              <rect x={x0} y={y} width={W - x0} height={RH} rx="2" style={{ fill: 'var(--surface-0)' }} opacity="0.92" />
              <text x={x0 + 4} y={y + RH / 2 + 4} fontSize="10" style={{ fill: 'var(--ink-700)' }}>{NOT_COUNTED_CAUSE} · not counted</text>
            </>
          );
        })()}
      </g>
    );
  });

  const hist = cols.map((stOf, c) => {
    const n = { s: 0, l: 0, m: 0 };
    for (const d of USABLE) {
      const st = stOf(d);
      if (st === 's' || st === 'l' || st === 'm') n[st] += 1;
    }
    const base = g.histTop + g.histH;
    const cx = g.x(c);
    if (n.s + n.l + n.m === 0) return <rect key={c} x={cx} y={base - 1} width={g.cw} height="1" style={{ fill: 'var(--ink-300)' }} />;
    let yy = base;
    const fills = { s: 'var(--ink-700)', l: 'var(--hour-less-mark)', m: 'var(--graph-insulin)' };
    return (
      <g key={c}>
        {(['s', 'l', 'm'] as const).filter((k) => n[k]).map((k) => {
          const hh = (g.histH * n[k]) / USABLE_N;
          yy -= hh;
          return <rect key={k} x={cx} y={yy} width={g.cw} height={hh} style={{ fill: fills[k] }} />;
        })}
      </g>
    );
  });

  const headTicks = mode === 'hours'
    ? [0, 3, 6, 9, 12, 15, 18, 21].filter((h) => g.x(h) + 14 < bandX || g.x(h) > bandX + bandW + 2)
    : Array.from({ length: 8 }, (_, c) => c).filter((c) => c !== sel);

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${g.H}`} width={W} height={g.H} role="img" aria-label={label} style={{ display: 'block' }}>
        <defs><Hatch id={`${uid}h`} /></defs>
        <rect x={bandX} y="0" width={bandW} height={g.H} rx="4" style={{ fill: 'var(--accent-info-soft)', transition: 'x var(--dur-screen) var(--ease), width var(--dur-screen) var(--ease)' }} />
        {headTicks.map((c) => (
          <text key={c} x={g.x(c)} y="11" fontSize="11" style={{ fill: 'var(--ink-700)' }}>{hourTick(mode === 'hours' ? c : c * 3)}</text>
        ))}
        <text x={bandX + bandW / 2} y="11" fontSize="11" textAnchor="middle" fontWeight="600" style={{ fill: 'var(--accent-info-ink)' }}>{bandLabel}</text>
        {rows}
        <text x="0" y={g.histTop + 12} fontSize="11" style={{ fill: 'var(--ink-700)' }}>Days off</text>
        <text x="0" y={g.histTop + 25} fontSize="11" style={{ fill: 'var(--ink-700)' }}>of {USABLE_N}</text>
        {hist}
        {histLabels(mode).map((l) => (
          <text key={l.a} x={(g.x(l.a) + g.x(l.b) - g.GAP) / 2} y={g.histTop + g.histH + 12} fontSize="10" textAnchor="middle" fontWeight="600" style={{ fill: 'var(--ink-900)' }}>{l.text}</text>
        ))}
        <g className="scrubber-line" style={{ transform: `translateX(${lineX}px)` }}>
          <rect x="-0.75" y={TOP - 4} width="1.5" height={g.histTop + g.histH - TOP + 4} style={{ fill: 'var(--ink-900)' }} />
        </g>
      </svg>
      {interactive && onSelect && <input
        className="scrub"
        type="range"
        min={0}
        max={g.N - 1}
        step={1}
        value={sel}
        aria-label={mode === 'hours' ? 'Select an hour' : 'Select a 3-hour block'}
        aria-valuetext={valueText}
        onChange={(e) => onSelect(Number(e.target.value))}
        onClick={(e) => onSelect(Number(e.currentTarget.value))}
        style={{
          left: `${(g.LW / W) * 100}%`,
          width: `${((g.N * g.pitch) / W) * 100}%`,
          top: 0,
          height: '100%',
          ['--thumb-w' as string]: `${thumb}px`,
        }}
      />}
    </div>
  );
}
