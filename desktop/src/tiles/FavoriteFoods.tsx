// Favorite foods: a ledger of the meals the person eats again and again. Each
// favorite is a row to navigate; picking one shows every time it was eaten,
// with how it went (stayed 70-180, went above 180, went below 70) and the
// absorption time Loop was given (entered) against how long glucose took to
// come back near where it started (observed). Unnamed carb entries are left
// out: a ledger needs a name to line repeats up.
// Observations only (SAFE-1, SAFE-2): what happened after each meal, never
// what to enter. The one action is adding a favorite to the person's own Loop
// build, which goes through SAFE-3 in LoopFavorites.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DATA, MEALS, SUGGESTIONS } from '../data/current';
import { foodId } from '../data/suggestions';
import type { Confidence } from '@/lib/metabolism/autotune';
import { useTracked } from '../data/tracked';
import { favoritesBridge } from '../data/favorites';
import { curveBands, dur, lowShare, type CurveBand, type MealGroup, type MealOutcome, type MealResponse } from '../data/meals';
import { Fit, IChevron, IPlus, useAnnounce } from '../ui/kit';
import { LoopFavorites } from './AddFavorite';
import type { FaceProps } from './faces';
import './favoritefoods.css';

const UNNAMED = 'Carbs';
const OUTCOME_WORD: Record<MealOutcome, string> = { in: 'Stayed 70–180', high: 'Above 180', low: 'Below 70' };
const OUTCOME_SHORT: Record<MealOutcome, string> = { in: 'in range', high: 'high', low: 'low' };

function useLedger() {
  return useMemo(() => {
    const groups = MEALS.groups.filter((g) => g.name !== UNNAMED);
    const unnamed = MEALS.groups.find((g) => g.name === UNNAMED)?.n ?? 0;
    const longest = Math.max(60, ...MEALS.recent.flatMap((m) => [m.enteredMin ?? 0, m.observedMin ?? 0]));
    return { groups, unnamed, scale: Math.ceil(longest / 60) * 60 };
  }, []);
}

/** "🥣 Oatmeal + berries" → ["🥣", "Oatmeal + berries"], so the emoji can sit in its own column. */
function split(name: string): [string, string] {
  const m = name.match(/^(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*)\s*(.*)$/u);
  return m ? [m[1], m[2]] : ['', name];
}

const outcomeLine = (o: Record<MealOutcome, number>) =>
  (['in', 'high', 'low'] as const).filter((k) => o[k]).map((k) => `${o[k]} ${OUTCOME_SHORT[k]}`).join(' · ');

// ------------------------------------------------------------ marks

/** One mark per time eaten, oldest first: shape and colour both carry the outcome (COL-5). */
function OutcomeStrip({ meals, max = 30 }: { meals: readonly MealResponse[]; max?: number }) {
  const shown = [...meals].sort((a, b) => a.at - b.at).slice(-max);
  return (
    <span className="ff-strip" aria-hidden="true">
      {shown.map((m) => <i key={m.id} className={`ff-mark ${m.outcome}`} />)}
    </span>
  );
}

/** Entered (outline) against observed (solid) on one shared scale, so the gap reads at a glance. */
function Durations({ entered, observed, scale, compact = false }: { entered: number | null; observed: number | null; scale: number; compact?: boolean }) {
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <span className={`ff-dur${compact ? ' compact' : ''}`} aria-label={`Absorption entered ${dur(entered)}, observed ${dur(observed)}`}>
      <span className="ff-dur-row">
        <span className="ff-dur-key">entered</span>
        <span className="ff-dur-track">{entered != null && <i className="ff-dur-bar entered" style={{ width: pct(entered) }} />}</span>
        <span className="ff-dur-val">{dur(entered)}</span>
      </span>
      <span className="ff-dur-row">
        <span className="ff-dur-key">observed</span>
        <span className="ff-dur-track">{observed != null ? <i className="ff-dur-bar observed" style={{ width: pct(observed) }} /> : <i className="ff-dur-none" />}</span>
        <span className="ff-dur-val">{observed == null ? 'not back' : dur(observed)}</span>
      </span>
    </span>
  );
}

function OutcomeChip({ m }: { m: MealResponse }) {
  const value = m.outcome === 'low' ? m.lowMgdl : m.outcome === 'high' ? m.highMgdl : null;
  return (
    <span className={`ff-chip ${m.outcome}`}>
      <i className={`ff-mark ${m.outcome}`} aria-hidden="true" />
      {OUTCOME_WORD[m.outcome]}{value != null ? ` · ${value}` : ''}
    </span>
  );
}

// ------------------------------------------------------------ chart: every curve, one picked

function Curves({ meals, picked, W, H }: { meals: readonly MealResponse[]; picked: string | null; W: number; H: number }) {
  const pad = { L: 34, R: 10, T: 8, B: 18 };
  const pw = W - pad.L - pad.R;
  const ph = H - pad.T - pad.B;
  const all = meals.flatMap((m) => m.curve.map((c) => c[1]));
  const ymax = Math.max(220, Math.ceil(Math.max(...all, 0) / 20) * 20 + 20);
  const ymin = 40;
  const X = (m: number) => pad.L + (m / 360) * pw;
  const Y = (g: number) => pad.T + ((ymax - Math.min(ymax, Math.max(ymin, g))) / (ymax - ymin)) * ph;
  const on = meals.find((m) => m.id === picked) ?? null;
  const line = (m: MealResponse) => `M${m.curve.map(([t, g]) => `${X(t).toFixed(1)} ${Y(g).toFixed(1)}`).join('L')}`;
  const label = meals.length
    ? `${meals.length} times, glucose for up to 6 hours after each meal; 70 to 180 shaded.${on ? ` Highlighted: ${on.when}, ${OUTCOME_WORD[on.outcome].toLowerCase()}, peak ${on.peakMgdl} mg/dL.` : ''}`
    : 'No meals to show.';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <rect x={pad.L} y={Y(180)} width={pw} height={Y(70) - Y(180)} style={{ fill: 'var(--range-in-soft)' }} />
      {[70, 180].map((v) => <text key={v} x={pad.L - 6} y={Y(v) + 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>)}
      {meals.filter((m) => m !== on).map((m) => (
        <path key={m.id} d={line(m)} fill="none" style={{ stroke: m.outcome === 'low' ? 'var(--range-low)' : 'var(--ink-500)' }} strokeWidth="1.2" opacity={on ? 0.28 : 0.5} strokeLinejoin="round" />
      ))}
      {on && <path d={line(on)} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.4" strokeLinejoin="round" />}
      {[0, 60, 120, 180, 240, 300, 360].map((t) => <text key={t} x={X(t)} y={H - 4} fontSize="10" textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{t ? `${t / 60}h` : 'meal'}</text>)}
    </svg>
  );
}

// ------------------------------------------------------------ glance: food cards, 4 across, each with a dropdown

/** One food's median glucose after it and its middle half, 70–180 shaded: the spotlight. */
function Spotlight({ meals, W, H }: { meals: readonly MealResponse[]; W: number; H: number }) {
  const b = curveBands(meals, Math.min(3, meals.length));
  const pad = { L: 30, R: 8, T: 6, B: 18 };
  const pw = W - pad.L - pad.R;
  const ph = H - pad.T - pad.B;
  const ymax = Math.max(220, Math.ceil(Math.max(0, ...b.map((x) => x.p75)) / 20) * 20 + 20);
  const ymin = 40;
  const X = (m: number) => pad.L + (m / 360) * pw;
  const Y = (g: number) => pad.T + ((ymax - Math.min(ymax, Math.max(ymin, g))) / (ymax - ymin)) * ph;
  const pts = (k: 'p25' | 'p50' | 'p75') => b.map((x) => `${X(x.t).toFixed(1)} ${Y(x[k]).toFixed(1)}`);
  const peak = b.reduce<CurveBand | null>((a, x) => (!a || x.p50 > a.p50 ? x : a), null);
  const label = b.length
    ? `Glucose after it, median of ${meals.length} times: starts at ${b[0].p50}, peaks at ${peak!.p50} mg/dL ${dur(peak!.t)} after, ${b[b.length - 1].p50} at ${dur(b[b.length - 1].t)}. 70 to 180 shaded.`
    : 'Not enough readings after it to draw.';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <rect x={pad.L} y={Y(180)} width={pw} height={Y(70) - Y(180)} style={{ fill: 'var(--range-in-soft)' }} />
      {[70, 180].map((v) => <text key={v} x={pad.L - 6} y={Y(v) + 4} fontSize="10" textAnchor="end" style={{ fill: 'var(--ink-700)' }}>{v}</text>)}
      {b.length > 1 && <path d={`M${pts('p75').join('L')}L${pts('p25').reverse().join('L')}Z`} style={{ fill: 'var(--ink-300)' }} opacity="0.55" />}
      {b.length > 1 && <path d={`M${pts('p50').join('L')}`} fill="none" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.4" strokeLinejoin="round" />}
      {[0, 60, 120, 180, 240, 300, 360].map((t) => <text key={t} x={X(t)} y={H - 4} fontSize="10" textAnchor="middle" style={{ fill: 'var(--ink-700)' }}>{t ? `${t / 60}h` : 'meal'}</text>)}
    </svg>
  );
}

/** The widget's dropdown: the spotlight on the left, the ledger of entered against observed on the right. */
function Dropdown({ g, scale, go }: { g: MealGroup; scale: number; go: FaceProps['go'] }) {
  const meals = MEALS.recent.filter((m) => m.name === g.name);
  const latest = [...meals].sort((a, b) => b.at - a.at).slice(0, 4);
  const [, label] = split(g.name);
  return (
    <div className="ff-expand-inner">
      <div className="ff-dd">
        <div className="ff-dd-spot">
          <div className="ff-dd-stats">
            <span><span className="caption">Rise, median</span><b>+{g.medianRiseMgdl}</b><span className="caption"> mg/dL at {dur(g.medianPeakAfterMin)}</span></span>
            <span><span className="caption">Back near start</span><b>{g.medianObservedMin == null ? 'not back' : dur(g.medianObservedMin)}</b><span className="caption"> {dur(g.medianEnteredMin)} entered</span></span>
            <span><span className="caption">After {g.n} times</span><b className="ff-dd-out">{outcomeLine(g.outcomes)}</b></span>
          </div>
          <LowChip meals={meals} long />
          <Fit className="ff-dd-chart">{({ w, h }) => <Spotlight meals={meals} W={w} H={h} />}</Fit>
          <span className="caption">Median and middle half of glucose after each time, up to 6 hours</span>
        </div>
        <div className="ff-dd-ledger">
          <h3 className="label">Absorption · entered and observed</h3>
          <Durations entered={g.medianEnteredMin} observed={g.medianObservedMin} scale={scale} />
          <ul className="ff-dd-times">
            {latest.map((m) => (
              <li key={m.id}>
                <span className="ff-dd-when"><i className={`ff-mark ${m.outcome}`} aria-hidden="true" /><span className="small">{m.when.replace(/, \d.*$/, '')}</span></span>
                <Durations entered={m.enteredMin} observed={m.observedMin} scale={scale} compact />
              </li>
            ))}
          </ul>
          <div className="row wrap ff-dd-actions">
            <TrackButton g={g} />
            <button type="button" className="text-btn" onClick={() => go({ tile: 'meals' })} aria-label={`Every time you had ${label}`}>Every time <IChevron /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The widget at full width shows 8 foods four across; narrower, 4 in a 2×2. Show more lists the rest. Pure, for testing. */
export function glanceLayout(tileW: number, total: number, more: boolean) {
  const full = tileW >= 12;
  const limit = full ? 8 : 4;
  return { cols: full ? 4 : 2, shown: more ? total : Math.min(total, limit), hidden: Math.max(0, total - limit) };
}

export function FavoriteFoodsGlance({ go, w }: FaceProps) {
  const { groups, scale } = useLedger();
  const [more, setMore] = useState(false);
  if (!groups.length) return <div className="face"><p className="small">No named meals with enough CGM readings after them in the last {MEALS.days} days. Favorites and food types you use in Loop show up here.</p></div>;
  const { cols, shown, hidden } = glanceLayout(w, groups.length, more);
  return (
    <div className="face ff-glance">
      <div className="row between wrap ff-head">
        <span className="caption">{groups.length} {groups.length === 1 ? 'food' : 'foods'} · last {MEALS.days} days · pick one for more</span>
        <OutcomeKey />
      </div>
      <CardGrid groups={groups.slice(0, shown)} cols={cols} idPrefix="ffg" label="Favorite foods" panel={(g) => <Dropdown g={g} scale={scale} go={go} />} />
      {hidden > 0 && (
        <button type="button" className="text-btn ff-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? 'Show less' : `Show ${hidden} more`} <span className="ff-more-chev" aria-hidden="true"><IChevron /></span>
        </button>
      )}
    </div>
  );
}

function OutcomeKey() {
  return (
    <div className="ff-key caption" aria-hidden="true">
      <span><i className="ff-sw in" />stayed 70–180</span><span><i className="ff-sw high" />above 180</span><span><i className="ff-sw low" />below 70</span>
    </div>
  );
}

// ------------------------------------------------------------ detail: a grid of favorites, one open at a time

function summary(g: MealGroup): string {
  const o = g.outcomes;
  const parts = [`Glucose was back within 20 mg/dL of where it started a median ${dur(g.medianObservedMin)} after; Loop was given ${dur(g.medianEnteredMin)}.`];
  if (g.observedN < g.n) parts.push(`It didn't come back before 6 hours or the next meal ${g.n - g.observedN} ${g.n - g.observedN === 1 ? 'time' : 'times'}.`);
  parts.push(`It stayed 70–180 after ${o.in} of ${g.n}, went above 180 after ${o.high} and below 70 after ${o.low}.`);
  return parts.join(' ');
}

/** A food's confidence as tracking reads it: the engine's grade when it has a suggestion, else how many times it's been eaten. */
const gradeFor = (n: number): Confidence => (n >= 8 ? 'good' : n >= 5 ? 'limited' : 'unusable');

/** Whether a food is tracked, and its suggestion if Suggestions has one. Same id either way, so both places agree. */
function useFoodTracking(g: MealGroup) {
  const t = useTracked();
  const id = foodId(g.name);
  const sugg = SUGGESTIONS.find((s) => s.id === id) ?? null;
  const tracked = t.all[id] && t.all[id].state !== 'dismissed' ? t.all[id] : null;
  return { t, id, sugg, tracked };
}

/** Track (white glass, green +) or Tracking: the food goes to Suggestions to watch its readings build. */
function TrackButton({ g }: { g: MealGroup }) {
  const { t, id, sugg, tracked } = useFoodTracking(g);
  const announce = useAnnounce();
  const label = split(g.name)[1];
  const today = DATA.today;
  if (tracked) return <button type="button" className="track-btn glass on" aria-pressed="true" aria-label={`Tracking ${label}. Press to stop`} onClick={() => { t.forget(id); announce(`Stopped tracking ${label}.`); }}>Tracking</button>;
  return (
    <button type="button" className="track-btn glass" onClick={() => {
      t.track(id, today, { date: today, confidence: sugg?.confidence ?? gradeFor(g.n), reading: sugg?.reading ?? null });
      announce(`Tracking ${label}. It shows in Suggestions as its readings build.`);
    }}><IPlus />Track</button>
  );
}

/** Time below 70 after a food: yellow under 10% of the time, red at 10% or more; the words carry it too (COL-5). */
function LowChip({ meals, long = false }: { meals: readonly MealResponse[]; long?: boolean }) {
  const l = lowShare(meals);
  if (l.level === 'none') return <span className="ff-low none caption">{long ? 'Never below 70 in the hours after' : 'No time below 70'}</span>;
  const pct = Math.max(1, Math.round(l.share * 100));
  return (
    <span className={`ff-low ${l.level}`} title={`${l.lowMin} of ${l.totalMin} minutes below 70 mg/dL, across every time`}>
      <i aria-hidden="true" />{`Below 70 ${pct}% of the time`}{long ? ` · ${dur(l.lowMin)} of ${dur(l.totalMin)}` : ''}
    </span>
  );
}

/** The share of times each outcome happened, as one bar: stayed, above, below. */
function OutcomeBar({ o, n }: { o: Record<MealOutcome, number>; n: number }) {
  return (
    <span className="ff-bar" aria-hidden="true">
      {(['in', 'high', 'low'] as const).map((k) => (o[k] ? <i key={k} className={k} style={{ flexGrow: o[k] / Math.max(1, n) }} /> : null))}
    </span>
  );
}

/** One favorite as a card: what it is, how often, how it went, and whether it's tracked. */
function FoodCard({ g, open, onToggle, id }: { g: MealGroup; open: boolean; onToggle: () => void; id: string }) {
  const [emoji, label] = split(g.name);
  const { tracked } = useFoodTracking(g);
  const o = g.outcomes;
  const out = o.in === g.n ? `All ${g.n} stayed in range` : o.in ? `${o.in} of ${g.n} stayed in range` : outcomeLine(o);
  return (
    <li className="ff-cell">
      <button type="button" className={`ff-card${tracked ? ' tracked' : ''}`} aria-expanded={open} id={id} onClick={onToggle}
        aria-label={`${label}: ${g.n} times, ${outcomeLine(o)}, rise ${g.medianRiseMgdl} mg/dL.${tracked ? ' Tracking.' : ''} ${open ? 'Hide' : 'Show'} details`}>
        <span className="ff-card-top">
          <span className="ff-card-name strong">{emoji && <span aria-hidden="true">{emoji} </span>}{label}</span>
          {tracked && <span className="ff-tracked caption">Tracking</span>}
          <span className="ff-card-chev" aria-hidden="true"><IChevron /></span>
        </span>
        <span className="caption">{g.n} times · {g.medianCarbsG} g · back in {g.medianObservedMin == null ? '—' : dur(g.medianObservedMin)}</span>
        <OutcomeBar o={o} n={g.n} />
        <LowChip meals={MEALS.recent.filter((m) => m.name === g.name)} />
        <span className="ff-card-foot"><span className="small strong">{out}</span><span className="caption">+{g.medianRiseMgdl} mg/dL</span></span>
      </button>
    </li>
  );
}

/** Columns that fit the width: cards at least `minCard` px wide, never more than `max`. */
const GAP = 12;
function useColumns(max: number, minCard: number) {
  const ref = useRef<HTMLUListElement>(null);
  const [cols, setCols] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setCols(Math.max(1, Math.min(max, Math.floor((el.clientWidth + GAP) / (minCard + GAP)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, minCard]);
  return [ref, cols] as const;
}

/**
 * Food cards in rows, one open at a time. The open card's panel sits after the
 * last card of its row, full width, so everything below moves down; it opens
 * and folds with an animation, and Escape closes it.
 */
function CardGrid({ groups, max = 6, minCard = 168, cols: fixed, idPrefix, label, panel }: { groups: MealGroup[]; max?: number; minCard?: number; cols?: number; idPrefix: string; label: string; panel: (g: MealGroup, close: () => void) => ReactNode }) {
  // A fixed column count (the widget) or as many as fit (the full page).
  const [ref, fit] = useColumns(fixed ?? max, fixed ? 1 : minCard);
  const cols = fixed ?? fit;
  const [open, setOpen] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ name: string; row: number } | null>(null);
  const panelRef = useRef<HTMLLIElement>(null);
  const cardId = (name: string) => `${idPrefix}-${foodId(name)}`;
  const idx = groups.findIndex((g) => g.name === open);
  const row = idx < 0 ? -1 : Math.floor(idx / cols);

  const close = (focus = true) => {
    if (open == null) return;
    const name = open;
    setClosing({ name, row });
    setOpen(null);
    if (focus) requestAnimationFrame(() => document.getElementById(cardId(name))?.focus());
  };
  const toggle = (name: string) => {
    if (open === name) return close(false);
    const nextRow = Math.floor(groups.findIndex((g) => g.name === name) / cols);
    // Another row: the old panel folds shut while the new one opens. Same row: the panel stays and its content changes.
    if (open != null && nextRow !== row) setClosing({ name: open, row });
    setOpen(name);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => panelRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 340);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  const openGroup = groups[idx] ?? null;
  const closingGroup = closing ? groups.find((g) => g.name === closing.name) ?? null : null;
  const notch = (name: string) => ({ '--notch': `${(((groups.findIndex((g) => g.name === name) % cols) + 0.5) / cols) * 100}%` }) as CSSProperties;
  const items: ReactNode[] = [];
  groups.forEach((g, i) => {
    items.push(<FoodCard key={g.name} id={cardId(g.name)} g={g} open={g.name === open} onToggle={() => toggle(g.name)} />);
    if (!(i % cols === cols - 1 || i === groups.length - 1)) return;
    const r = Math.floor(i / cols);
    if (openGroup && r === row) {
      items.push(
        <li key={`panel-${r}`} ref={panelRef} className="ff-expand" style={notch(openGroup.name)} role="region" aria-label={`${split(openGroup.name)[1]}, details`}>
          <div key={openGroup.name} className="ff-swap">{panel(openGroup, () => close())}</div>
        </li>,
      );
    } else if (closingGroup && closing && r === closing.row) {
      items.push(
        <li key={`panel-${r}`} className="ff-expand closing" style={notch(closingGroup.name)} aria-hidden="true" onAnimationEnd={(e) => { if (e.target === e.currentTarget) setClosing(null); }}>
          <div className="ff-swap">{panel(closingGroup, () => undefined)}</div>
        </li>,
      );
    }
  });
  return <ul ref={ref} className="ff-cards" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-label={label}>{items}</ul>;
}

/** The open food's breakdown: how it affected glucose, every time, and the two actions. */
function Breakdown({ g, scale, onClose }: { g: MealGroup; scale: number; onClose: () => void }) {
  const [rec, setRec] = useState<string | null>(null);
  const [filter, setFilter] = useState<MealOutcome | 'all'>('all');
  const meals = MEALS.recent.filter((m) => m.name === g.name);
  const listed = filter === 'all' ? meals : meals.filter((m) => m.outcome === filter);
  const [emoji, label] = split(g.name);
  const { tracked, sugg } = useFoodTracking(g);
  return (
    <div className="ff-expand-inner">
      <div className="ff-bd">
        <div className="ff-bd-head">
          <div className="stack-4">
            <h2 id="ff-h" className="title ff-title"><span aria-hidden="true">{emoji}</span>{label}</h2>
            <span className="caption">{g.medianCarbsG} g median · {g.n} times in {MEALS.days} days · peak a median {dur(g.medianPeakAfterMin)} after</span>
          </div>
          <div className="row wrap ff-bd-actions">
            <TrackButton g={g} />
            <button type="button" className="quiet-btn" onClick={onClose} aria-label={`Close ${label}`}>Close</button>
          </div>
        </div>
        <div className="ff-bd-grid">
          <div className="stack-12">
            <p className="ff-summary">{summary(g)}</p>
            <Durations entered={g.medianEnteredMin} observed={g.medianObservedMin} scale={scale} />
            <span className="ff-out"><OutcomeStrip meals={meals} /><span className="small">{outcomeLine(g.outcomes)}</span></span>
            <LowChip meals={meals} long />
            {sugg
              ? <p className="caption">Suggestions has a reading for this food: {sugg.evidence}.{tracked ? '' : ' Track it to watch its confidence build.'}</p>
              : <p className="caption">{tracked ? 'Tracked: it shows in Suggestions once its readings point somewhere.' : 'Track it to watch it in Suggestions as more meals come in.'}</p>}
          </div>
          <div className="stack-8">
            <h3 className="label">Glucose after each time · up to 6 hours</h3>
            <Fit className="chart-md ff-bd-chart">{({ w, h }) => <Curves meals={meals} picked={rec} W={w} H={h} />}</Fit>
            <p className="caption">One line per time you had it, 70–180 shaded. Pick a row below to bring its line forward; lines that went below 70 are red.</p>
          </div>
        </div>

        <div className="stack-12">
          <div className="row between wrap">
            <h3 className="h3">Every time you had it</h3>
            <div className="ff-filter" role="group" aria-label="Show">
              {(['all', 'in', 'high', 'low'] as const).map((f) => {
                const n = f === 'all' ? meals.length : g.outcomes[f];
                return <button key={f} type="button" aria-pressed={filter === f} disabled={f !== 'all' && !n} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : OUTCOME_WORD[f]} <span className="caption">{n}</span></button>;
              })}
            </div>
          </div>
          <div className="ff-records-wrap">
          <table className="ff-records">
            <caption className="sr-only">{g.name}: every time, newest first, with the outcome and absorption entered against observed</caption>
            <thead>
              <tr><th scope="col">When</th><th scope="col">Carbs · bolus</th><th scope="col">Start → peak</th><th scope="col">Outcome</th><th scope="col">Absorption, entered · observed</th></tr>
            </thead>
            <tbody>
              {listed.map((m) => (
                <tr key={m.id} aria-selected={m.id === rec || undefined}>
                  <th scope="row"><button type="button" className="text-btn" aria-pressed={m.id === rec} onClick={() => setRec(m.id === rec ? null : m.id)}>{m.when}</button></th>
                  <td>{m.carbsG} g · {m.bolusU} U</td>
                  <td>{m.startMgdl} → {m.peakMgdl} <span className="caption">at {dur(m.peakAfterMin)}</span></td>
                  <td><OutcomeChip m={m} /></td>
                  <td><Durations entered={m.enteredMin} observed={m.observedMin} scale={scale} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="caption">Entered is the absorption time given to Loop with the carbs. Observed is how long glucose took to come back within 20 mg/dL of where it started, before the next meal. What happened, not a setting.</p>
        </div>

        {favoritesBridge() && <div className="ff-bd-loop"><LoopFavorites group={g} /></div>}
      </div>
    </div>
  );
}

export function FavoriteFoodsDetail() {
  const { groups, unnamed, scale } = useLedger();
  if (!groups.length) return <p className="small">No named meals with enough CGM readings after them in the last {MEALS.days} days.</p>;
  return (
    <div className="ff">
      <div className="row between wrap ff-head">
        <p className="caption">Last {MEALS.days} days · named meals only{unnamed ? ` (${unnamed} unnamed carb ${unnamed === 1 ? 'entry' : 'entries'} not shown)` : ''} · each meal read from entry to 6 hours or the next meal. Pick a food to see how it affected glucose.</p>
        <OutcomeKey />
      </div>
      <CardGrid groups={groups} max={6} minCard={168} idPrefix="ff-card" label="Favorite foods" panel={(g, close) => <Breakdown g={g} scale={scale} onClose={close} />} />
    </div>
  );
}
