// Every tracker has two faces (VIS-9): a glance face that fits its tile, and a
// detail face one click in. Patient-side copy uses community words (DM-9) and
// says what Loop or glucose did, never what to do (SAFE-1).
import { useState, type ReactNode } from 'react';
import { bands, TirBar } from '../charts/Agp';
import { DayTrackerChart } from '../charts/DayTracker';
import { GlucoseChart } from '../charts/GlucoseChart';
import { gridGeom, HourGrid } from '../charts/HourGrid';
import { MorningsChart } from '../charts/MorningsChart';
import {
  blocks, count, diff, hourName, morningGlucose, partOfDay, peak, pct, rangeLabel, select, stretchOf, USABLE_N, type Mode,
} from '../data/derive';
import {
  CGM_NOW, CHANGES, DATA, DAY, DAY_BY_WEEKDAY, HEADS_UP, LUNCH, NOT_COUNTED, NOT_COUNTED_CAUSE, PATIENT, PERIOD, READ, TEXT,
} from '../data/current';
import { daysLeft, useLoopBuild } from '../data/loopBuild';
import { FavoriteFoodsDetail, FavoriteFoodsGlance } from './FavoriteFoods';
import { DailyGlucoseDetail, DailyGlucoseGlance } from './DailyGlucose';
import { CareThreadDetail, CareThreadGlance } from './CareTeam';
import { WhatLoopDidDetail as WhatLoopDidPatternsDetail, WhatLoopDidGlance as WhatLoopDidPatternsGlance } from './WhatLoopDid';
import type { Go, Route } from '../nav';
import { TILES, type TileKind } from '../layout/model';
import { useStore, who, type Msg } from '../state';
import { Chip, Fit, IBell, Ring, Segmented, useAnnounce } from '../ui/kit';

export interface FaceProps {
  route: Route;
  go: Go;
  /** Tile size in grid units, for glance faces that change with size. */
  w: number;
  h: number;
}

// ------------------------------------------------------------ glucose now

const SYN_CGM_LABEL = 'Glucose since 6am: rose to 150 mg/dL around 7:30am and came back down to 112 mg/dL now, falling slowly. Loop’s prediction, dashed, stays near 107 to 109 mg/dL over the next 90 minutes, inside the 70 to 180 mg/dL range.';

/** Hours shown on the glucose-now chart: the synthetic 6–11am, or the last readings plus the prediction. */
function cgmGeom() {
  if (DATA.source === 'synthetic') return { x0: 6, x1: 11, ymax: 240 };
  const all = [...CGM_NOW.points, ...CGM_NOW.prediction];
  if (!all.length) return { x0: 0, x1: 3, ymax: 240 };
  const x0 = Math.floor(Math.min(...all.map((p) => p[0])));
  const x1 = Math.ceil(Math.max(...all.map((p) => p[0])));
  return { x0, x1: Math.max(x1, x0 + 2), ymax: Math.max(240, Math.ceil(Math.max(...all.map((p) => p[1])) / 20) * 20 + 20) };
}

function cgmLabel(): string {
  if (DATA.source === 'synthetic') return SYN_CGM_LABEL;
  const pts = CGM_NOW.points;
  if (!pts.length || CGM_NOW.mgdl == null) return 'No recent CGM readings in Nightscout.';
  const hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const pr = CGM_NOW.prediction;
  const prText = pr.length ? ` Loop’s prediction, dashed, runs from ${Math.round(Math.min(...pr.map((p) => p[1])))} to ${Math.round(Math.max(...pr.map((p) => p[1])))} mg/dL over the next ${Math.round((pr[pr.length - 1][0] - pr[0][0]) * 60)} minutes.` : '';
  return `Glucose over the last ${Math.round((pts[pts.length - 1][0] - pts[0][0]) * 60 / 30) / 2} hours: between ${lo[1]} and ${hi[1]} mg/dL, now ${CGM_NOW.mgdl} mg/dL, ${CGM_NOW.trendLabel}.${prText}`;
}


function CgmNumber({ big = false }: { big?: boolean }) {
  const c = CGM_NOW;
  return (
    <div className={`cgm-value${big ? ' big' : ''}`}>
      <span className="num">{c.mgdl ?? '—'}</span>
      <span className="unit">mg/dL</span>
      <span className="arrow" role="img" aria-label={c.trendLabel}>{c.trend}</span>
      <span className="caption age">{c.ageMin} min ago</span>
    </div>
  );
}

function LoopLine() {
  const c = CGM_NOW;
  return (
    <div className="row wrap small" style={{ gap: 14 }}>
      <span className="status-line"><Ring minutes={PATIENT.loopedMinAgo} /> Looped {PATIENT.loopedMinAgo} min ago</span>
      <span><b className="strong">{c.activeInsulinU == null ? '—' : c.activeInsulinU.toFixed(2)} U</b> active insulin</span>
      <span><b className="strong">{c.activeCarbsG ?? '—'} g</b> active carbs</span>
    </div>
  );
}

const cgmSeries = () => [
  { pts: CGM_NOW.points, stroke: 'var(--ink-900)', width: 2.2 },
  { pts: CGM_NOW.prediction, stroke: 'var(--ink-900)', width: 1.6, dash: '3 3', opacity: 0.6 },
];

function GlucoseNowGlance() {
  return (
    <div className="face">
      <CgmNumber />
      <LoopLine />
      <Fit className="grow" minH={60}>
        {({ w, h }) => <GlucoseChart geom={{ W: w, H: h, ...cgmGeom() }} series={cgmSeries()} label={cgmLabel()} />}
      </Fit>
      <span className="caption">Dashed: Loop’s prediction · 70–180 shaded</span>
    </div>
  );
}

function GlucoseNowDetail() {
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Glucose now">
        <CgmNumber big />
        <LoopLine />
        <Fit className="chart-lg">
          {({ w, h }) => <GlucoseChart geom={{ W: w, H: h, ...cgmGeom() }} series={cgmSeries()} label={cgmLabel()} />}
        </Fit>
        <span className="caption">{rangeLabel(((cgmGeom().x0 % 24) + 24) % 24, ((cgmGeom().x1 % 24) + 24) % 24 || 24)} · solid is your CGM, dashed is Loop’s prediction · 70–180 mg/dL shaded</span>
      </section>
      <aside className="panel stack-12" aria-label="About this reading">
        <h3 className="h3">Where this comes from</h3>
        <p className="small">{DATA.source === 'nightscout' ? `Your CGM reading, from your Nightscout at ${DATA.sourceLabel}.` : 'Your Dexcom G7 reading, through Loop.'} A reading older than 15 minutes greys out and says so.</p>
        <dl className="facts">
          <div><dt>Trend</dt><dd>{CGM_NOW.trend} {CGM_NOW.trendLabel}</dd></div>
          <div><dt>Active insulin</dt><dd>{CGM_NOW.activeInsulinU == null ? '—' : `${CGM_NOW.activeInsulinU.toFixed(2)} U`}</dd></div>
          <div><dt>Active carbs</dt><dd>{CGM_NOW.activeCarbsG == null ? '—' : `${CGM_NOW.activeCarbsG} g`}</dd></div>
          <div><dt>Loop</dt><dd>looped {PATIENT.loopedMinAgo} min ago</dd></div>
        </dl>
        <p className="caption">LoopStack reads what Loop did. It never changes your pump.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ heads-ups (PROD-2)

function HeadsUpCard() {
  if (!HEADS_UP) {
    return (
      <div className="headsup">
        <span className="badge"><IBell /></span>
        <div className="stack">
          <span className="caption">Heads-up · today</span>
          <span className="lead-sm">No heads-up today</span>
          <span className="small">No stretch of this weekday ran low or high in 10% of readings over the last 12 weeks.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="headsup">
      <span className="badge"><IBell /></span>
      <div className="stack">
        <span className="caption">Heads-up · {HEADS_UP.when}</span>
        <span className="lead-sm">{HEADS_UP.title}</span>
        <span className="small">{HEADS_UP.detail}</span>
      </div>
    </div>
  );
}

function HeadsUpsGlance({ go, h }: FaceProps) {
  return (
    <div className="face">
      <HeadsUpCard />
      {h > 1 && HEADS_UP && <p className="small">No other stretch today passed the 10% bar.</p>}
      <button type="button" className="text-btn" onClick={() => go({ tile: 'day-tracker' })}>See the average {DAY.name}</button>
    </div>
  );
}

function HeadsUpsDetail({ go }: FaceProps) {
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Today’s heads-ups">
        <HeadsUpCard />
        <Fit className="chart-lg">{({ w, h }) => <DayTrackerChart W={w} H={h} />}</Fit>
        <div className="row between">
          <span className="caption">The average {DAY.name}, last {DAY.weeks} weeks{DAY.stretch ? ` · ${rangeLabel(DAY.stretch[0], DAY.stretch[1])} shaded` : ''}</span>
          <button type="button" className="text-btn" onClick={() => go({ tile: 'day-tracker' })}>Open the day tracker</button>
        </div>
      </section>
      <aside className="panel stack-12" aria-label="How heads-ups work">
        <h3 className="h3">How a heads-up is picked</h3>
        <p className="small">A weekday stretch gets a heads-up two hours before it starts when at least 10% of its readings ran low or high over the last 12 weeks, with at least 3 weeks behind each hour. At most 3 a day.</p>
        {TEXT.headsUpBody && <p className="small">{TEXT.headsUpBody}</p>}
        <p className="caption">An observation, not a cause. Always on your dashboard.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ day tracker (PROD-2)

const WEEKDAYS = [
  { value: 'sun', label: 'S', title: 'Sunday' }, { value: 'mon', label: 'M', title: 'Monday' }, { value: 'tue', label: 'T', title: 'Tuesday' },
  { value: 'wed', label: 'W', title: 'Wednesday' }, { value: 'thu', label: 'T', title: 'Thursday' }, { value: 'fri', label: 'F', title: 'Friday' },
  { value: 'sat', label: 'S', title: 'Saturday' },
  { value: 'all', label: 'All', title: 'Every day' },
] as const;
type Weekday = (typeof WEEKDAYS)[number]['value'];

function DayLegend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li><svg width="16" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" style={{ fill: 'var(--range-in)' }} /><circle cx="12" cy="4" r="3.5" style={{ fill: 'var(--range-low)' }} /></svg>Glucose, low is the larger dot</li>
      <li><span className="sw" style={{ background: 'var(--graph-insulin)' }} />Active insulin</li>
      <li><span className="sw" style={{ background: 'var(--graph-carb)' }} />Active carbs</li>
      <li><span className="sw" style={{ background: 'var(--graph-activity)' }} />Exercise, minutes</li>
    </ul>
  );
}

const nowHours = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

function DayTrackerBody({ big, day: shared, onDay }: { big: boolean; day?: Weekday; onDay?: (d: Weekday) => void }) {
  const [own, setOwn] = useState<Weekday>(WEEKDAYS[DAY.weekday].value);
  const day = shared ?? own;
  const setDay = onDay ?? setOwn;
  const idx = WEEKDAYS.findIndex((d) => d.value === day);
  const every = day === 'all';
  const name = WEEKDAYS[idx].title;
  const tracked = DAY_BY_WEEKDAY[idx] ?? null;
  return (
    <>
      <div className="row between wrap">
        <Segmented size="sm" label="Weekday" items={WEEKDAYS.map((d) => ({ ...d, label: d.label }))} value={day} onChange={setDay} />
        <span className="caption">{every ? 'The average day, every day' : `The average ${name}`}, last {(tracked ?? DAY).weeks} weeks · median by hour</span>
      </div>
      {tracked ? (
        <Fit className={big ? 'chart-lg' : 'grow'} minH={120}>{({ w, h }) => <DayTrackerChart day={tracked} W={w} H={h} compact={!big} now={every ? nowHours() : tracked.weekday === new Date().getDay() || DATA.source === 'synthetic' ? undefined : null} />}</Fit>
      ) : DATA.source === 'synthetic' ? (
        <div className="empty-inline grow">
          <p className="lead-sm">Only Fridays are in this sample.</p>
          <p className="small">This synthetic fortnight carries one weekday in full. {name} shows nothing rather than a guess.</p>
        </div>
      ) : (
        <div className="empty-inline grow">
          <p className="lead-sm">{every ? 'Not enough days yet.' : `Not enough ${name}s yet.`}</p>
          <p className="small">An hour needs at least 3 weeks of readings before it says anything. {name} shows nothing rather than a guess.</p>
        </div>
      )}
    </>
  );
}

function DayTrackerGlance() {
  return <div className="face"><DayTrackerBody big={false} /></div>;
}

/** What the selected day shows, said plainly; the dataset's own sentence for the default day. */
function dayFindingFor(d: (typeof DAY_BY_WEEKDAY)[number]): string {
  if (!d) return 'Not enough data for this day yet.';
  if (d.weekday === DAY.weekday) return TEXT.dayTrackerFinding;
  const lo = d.glucose.reduce((b, g, h) => (g < d.glucose[b] ? h : b), 0);
  const hi = d.glucose.reduce((b, g, h) => (g > d.glucose[b] ? h : b), 0);
  const ip = d.iob.reduce((b, g, h) => (g > d.iob[b] ? h : b), 0);
  const what = d.weekday === 7 ? 'On the average day' : `On the average ${d.name}`;
  return `${what}, glucose is lowest at ${hourName(lo)}, ${d.glucose[lo]} mg/dL, and highest at ${hourName(hi)}, ${d.glucose[hi]} mg/dL. Active insulin peaks at about ${d.iob[ip].toFixed(1)} U around ${hourName(ip)}.`;
}

function DayTrackerDetail() {
  const [day, setDay] = useState<Weekday>(WEEKDAYS[DAY.weekday].value);
  const selected = DAY_BY_WEEKDAY[WEEKDAYS.findIndex((w) => w.value === day)] ?? null;
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Day tracker">
        <DayTrackerBody big day={day} onDay={setDay} />
        <DayLegend />
      </section>
      <aside className="panel stack-12" aria-label="Seen alongside">
        <h3 className="h3">Seen alongside</h3>
        <p className="small">{dayFindingFor(selected)}</p>
        {TEXT.dayTrackerLoop && selected?.weekday === DAY.weekday && <p className="small">{TEXT.dayTrackerLoop}</p>}
        <p className="caption">What happened, not why. Always on your dashboard.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ what Loop did

const SHORT = { a: 'about', l: 'less', m: 'more', s: 'suspended' } as const;
export const colLabel = (mode: Mode, col: number) => (mode === 'hours' ? hourName(col) : rangeLabel(col * 3, col * 3 + 3));
export const readout = (mode: Mode, col: number) => {
  const s = select(mode, col);
  return `${colLabel(mode, col)} · ${SHORT[s.verdict]} on ${s.n} of ${USABLE_N} · ${s.loop.toFixed(2)} of ${s.sched.toFixed(2)} U/h`;
};

export function gridFinding(mode: Mode, clinician = false): string {
  if (DATA.source !== 'synthetic') return genericGridFinding(mode, clinician);
  const insulin = clinician ? 'algorithm-modulated basal ran below the scheduled rate' : 'Loop delivered less than scheduled';
  if (mode === 'blocks') {
    const b = blocks();
    return `What Loop did in 3-hour blocks over 14 days. 6 to 9am: ${insulin} on ${b[2].counts.l} of ${USABLE_N} usable days, about ${Math.abs(Math.round(diff(b[2].loop, b[2].sched) * 100))}% under. 6 to 9pm is above scheduled on ${b[6].counts.m} of ${USABLE_N}. Both Fridays are suspended 3 to 6pm after a lunchtime run. Sun Nov 8 lost its pod connection 12 to 6am and is not counted.`;
  }
  return `What Loop did, hour by hour: 14 days by 24 hours. At 6am ${insulin} on ${count(6, 'l')} of ${USABLE_N} usable days, at 7am on ${count(7, 'l')}, and by 8am on only ${count(8, 'l')}. 7 to 9pm is above scheduled on ${count(19, 'm')} and ${count(20, 'm')} of ${USABLE_N}. Both Fridays are suspended 3 to 6pm after a lunchtime run. Sun Nov 8 lost its pod connection 12 to 6am and is not counted.`;
}

/** The grid's spoken summary for any dataset: the hour (or block) where Loop most often ran less, and more. */
function genericGridFinding(mode: Mode, clinician: boolean): string {
  const cols = mode === 'blocks' ? 8 : 24;
  const best = (v: 'l' | 'm') => {
    let top: { col: number; n: number } | null = null;
    for (let c = 0; c < cols; c += 1) {
      const sel = select(mode, c);
      if (sel.verdict === v && (!top || sel.n > top.n)) top = { col: c, n: sel.n };
    }
    return top;
  };
  const less = best('l');
  const more = best('m');
  const lessWord = clinician ? 'algorithm-modulated basal ran below the scheduled rate' : 'Loop delivered less than scheduled';
  const moreWord = clinician ? 'ran above the scheduled rate' : 'Loop delivered more than scheduled';
  const parts = [`What Loop did, ${mode === 'blocks' ? 'in 3-hour blocks' : 'hour by hour'}: ${PERIOD.days} days by 24 hours, ${USABLE_N} usable.`];
  parts.push(less ? `At ${colLabel(mode, less.col)} ${lessWord} on ${less.n} of ${USABLE_N} days.` : 'No hour ran less than scheduled on most days.');
  if (more) parts.push(`At ${colLabel(mode, more.col)} ${moreWord} on ${more.n} of ${USABLE_N} days.`);
  if (TEXT.excludedNote) parts.push(`${TEXT.excludedNote}.`);
  return parts.join(' ');
}

export function GridLegend() {
  return (
    <ul className="chips" aria-label="Legend">
      <Chip kind="l">Less</Chip>
      <Chip kind="m">More</Chip>
      <Chip kind="s">Suspended</Chip>
      <Chip kind="x">No data</Chip>
      <Chip kind="run">{DATA.source === 'synthetic' ? 'Lunchtime run' : 'Exercise'}</Chip>
    </ul>
  );
}



export function HourDetail({ mode, sel, clinician = false }: { mode: Mode; sel: number; clinician?: boolean }) {
  const s = select(mode, sel);
  const daysWord = mode === 'hours' && s.verdict !== 'a' ? partOfDay(s.start).many : 'days';
  const others = s.others.length && s.others.length <= 4 ? ` The other ${s.others.length === 1 ? 'one' : s.others.length}: ${s.others.join(', ')}.` : '';
  const loopWord = clinician ? 'algorithm-modulated basal ran' : 'Loop delivered';
  const sentence = s.verdict === 'a'
    ? `At ${colLabel(mode, sel)} ${loopWord} about as scheduled on ${s.n} of ${USABLE_N} days.${others}`
    : s.verdict === 's'
      ? `At ${colLabel(mode, sel)} Loop suspended on ${s.n} of ${USABLE_N} days${TEXT.suspendNote ? `, ${TEXT.suspendNote}` : ''}.`
      : `At ${colLabel(mode, sel)} ${loopWord} ${s.verdict === 'l' ? 'less' : 'more'} than scheduled on ${s.n} of ${USABLE_N} days.${others}`;
  return (
    <div className="stack-12">
      <div className="row between baseline">
        <h3 className="title">{rangeLabel(s.start, s.end)}</h3>
        <span className="caption">{USABLE_N} usable days</span>
      </div>
      <div className="tiles3">
        <div className="stat"><b>{s.sched.toFixed(2)} U/h</b><span>scheduled</span></div>
        <div className="stat"><b>{s.loop.toFixed(2)} U/h</b><span>{clinician ? 'delivered, median' : 'Loop, median'}</span></div>
        <div className="stat"><b>{s.n} of {USABLE_N}</b><span>{daysWord} {SHORT[s.verdict]}</span></div>
      </div>
      <p className="small ink">{sentence}</p>
    </div>
  );
}

export function WhatLoopDidExplorer({ route, go, clinician = false }: { route: Route; go: Go; clinician?: boolean }) {
  const { mode, sel } = route;
  const [a, b] = stretchOf(mode, sel);
  const [drill, setDrill] = useState(false);
  const part = partOfDay(a);
  const g = a === 6 ? morningGlucose(6) : null;
  const announce = useAnnounce();
  const pick = (col: number) => {
    go({ sel: col }, { replace: true });
    setDrill(false);
  };
  const morningLabel = `${rangeLabel(a, b)}, ${part.one} by ${part.one}. Bars are delivered basal for each hour; the dotted line is the scheduled rate.${g ? ` On the right, glucose at 6am. Mornings where Loop delivered less sat lower at 6am, median ${g.lessMedian} mg/dL, than the two that ran as scheduled, ${g.about.join(' and ')} mg/dL.` : ''}${TEXT.excludedNote ? ` ${TEXT.excludedNote}.` : ''}`;
  return (
    <div className={`explorer${clinician ? " stacked" : ""}`}>
      <section className="panel stack-12" aria-label="Hour grid">
        <div className="row between wrap">
          <div className="row wrap">
            <span className="sample">{PERIOD.days} days · {USABLE_N} usable</span>
            <span className="caption">{PERIOD.label} · ±15% counts as scheduled</span>
          </div>
          <Segmented
            label="Detail"
            items={[{ value: 'blocks', label: '3-hour blocks' }, { value: 'hours', label: 'Hours' }]}
            value={mode}
            onChange={(m) => {
              if (m === mode) return;
              go({ mode: m, sel: m === 'blocks' ? Math.floor(sel / 3) : sel * 3 + 1 }, { replace: true });
              announce(m === 'blocks' ? 'Showing 3-hour blocks' : 'Showing hours');
            }}
          />
        </div>
        <GridLegend />
        <Fit className="grid-fit">
          {({ w }) => {
            const RH = 20;
            const geo = gridGeom(mode, w, RH);
            const center = geo.x(sel) + geo.cw / 2;
            return (
              <div style={{ position: 'relative', paddingTop: 40 }}>
                <div role="status" aria-live="polite" className="readout glass" style={{ left: Math.min(Math.max(center - 130, 0), w - 260) }}>
                  {readout(mode, sel)}
                </div>
                <HourGrid mode={mode} sel={sel} onSelect={pick} label={gridFinding(mode, clinician)} valueText={readout(mode, sel)} W={w} RH={RH} />
              </div>
            );
          }}
        </Fit>
        <p className="caption"><span className="screen-only">Click a column, or focus the grid and use the arrow keys.</span>{NOT_COUNTED ? ` ${TEXT.excludedNote}: ${NOT_COUNTED_CAUSE.toLowerCase()}.` : ''}</p>
      </section>
      <aside className="panel stack-16 side" aria-label="Selected hour">
        <HourDetail mode={mode} sel={sel} clinician={clinician} />
        <button type="button" className="quiet-btn" aria-expanded={drill} aria-controls="drill" onClick={() => setDrill((d) => !d)}>
          {drill ? `Hide the ${part.many}` : `See ${rangeLabel(a, b)}, ${part.one} by ${part.one}`}
        </button>
        {drill && (
          <div id="drill" className="stack-12">
            <Fit className="drill-fit">{({ w }) => <MorningsChart from={a} to={b} W={w} label={morningLabel} />}</Fit>
            {g ? (
              <p className="small ink">On the mornings Loop delivered less, 6am glucose sat lower: median {g.lessMedian} mg/dL, against {g.about.join(' and ')} on the two that ran as scheduled. An observation, not a cause.</p>
            ) : (
              <p className="small">Glucose for each {part.one} at {hourName(a)} isn’t in this sample, so there’s nothing to set alongside.</p>
            )}
          </div>
        )}
        {!clinician && DATA.source === 'synthetic' && (
          <div className="stack-4 evenings">
            <span className="label">Evenings</span>
            <span className="small ink">7–9pm, Loop delivered about 25% more than scheduled on {count(19, 'm')}–{count(20, 'm')} of {USABLE_N} evenings.</span>
          </div>
        )}
        {!clinician && DATA.source !== 'synthetic' && TEXT.eveningNote && (
          <div className="stack-4 evenings">
            <span className="label">Evenings</span>
            <span className="small ink">{TEXT.eveningNote}</span>
          </div>
        )}
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ before and after

const BA_GEOM = { x0: 6, x1: 22 };
const time = (h: number) => `${Math.floor(h) % 12 || 12}${h % 1 ? `:${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
const baSeries = () => [
  { pts: LUNCH.before, stroke: 'var(--ink-500)', width: 2, dash: '4 3', opacity: 0.9 },
  { pts: LUNCH.after, stroke: 'var(--ink-900)', width: 2.4 },
];
export function baLabel() {
  const pb = peak(LUNCH.before);
  const pa = peak(LUNCH.after);
  if (DATA.source !== 'synthetic') {
    return `Lunch, ${LUNCH.beforeLabel.toLowerCase()} against ${LUNCH.afterLabel.toLowerCase()}, median glucose. The median peak was ${pb[1]} mg/dL at ${time(pb[0])} before and ${pa[1]} mg/dL at ${time(pa[0])} after.`;
  }
  return `Lunch, ${LUNCH.usable.days} days before and after the carb ratio change, median glucose. The median peak at ${time(pb[0])} was ${pb[1]} mg/dL before and ${pa[1]} mg/dL after, about ${pb[1] - pa[1]} mg/dL lower. Outside 12 to 4pm the two lines sit within a few mg/dL of each other.`;
}

/** "lunch peaks were about 20 mg/dL lower", either direction. */
export function lunchPeakText(): string {
  const d = peak(LUNCH.before)[1] - peak(LUNCH.after)[1];
  const lead = CHANGES.some((c) => c.status === 'applied' || c.status === 'reviewed') ? 'After the change' : `In the last ${LUNCH.usable.days} days`;
  return Math.abs(d) < 5
    ? `${lead}, lunch peaks were within ${Math.max(1, Math.abs(d))} mg/dL of before.`
    : `${lead}, lunch peaks were about ${Math.abs(d)} mg/dL ${d > 0 ? 'lower' : 'higher'}.`;
}

export function BaLegend() {
  return (
    <div className="row wrap caption" style={{ gap: 14 }}>
      <span className="row" style={{ gap: 6 }}><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: 'var(--ink-500)' }} strokeWidth="2" strokeDasharray="4 3" /></svg>Before</span>
      <span className="row" style={{ gap: 6 }}><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: 'var(--ink-900)' }} strokeWidth="2.4" /></svg>After</span>
      <span>{rangeLabel(LUNCH.scope[0], LUNCH.scope[1])} shaded · median, mg/dL</span>
    </div>
  );
}

export function BaChart({ className = 'grow', minH = 100 }: { className?: string; minH?: number }) {
  return (
    <Fit className={className} minH={minH}>
      {({ w, h }) => <GlucoseChart geom={{ W: w, H: h, ...BA_GEOM }} scope={LUNCH.scope} series={baSeries()} label={baLabel()} />}
    </Fit>
  );
}

function BeforeAfterGlance() {
  return (
    <div className="face">
      <p className="lead-sm">{lunchPeakText()}</p>
      <span className="caption">{LUNCH.change} · {LUNCH.usable.days} days each side, {LUNCH.usable.before} usable</span>
      <BaChart />
      <BaLegend />
    </div>
  );
}

function BeforeAfterDetail() {
  const pb = peak(LUNCH.before);
  const pa = peak(LUNCH.after);
  const change = CHANGES.find((c) => c.status === 'applied' || c.status === 'reviewed');
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Before and after chart">
        <div className="row wrap">
          <span className="sample">{LUNCH.usable.days} days before · {LUNCH.usable.before} usable</span>
          <span className="sample">{LUNCH.usable.days} days after · {LUNCH.usable.after} usable</span>
        </div>
        <BaChart className="chart-lg" />
        <BaLegend />
        <p className="lead-sm">{lunchPeakText().replace(/\.$/, '')}: {pb[1]} → {pa[1]} mg/dL at {time(pb[0])}, {pct((pa[1] - pb[1]) / pb[1])}.</p>
      </section>
      <aside className="panel stack-12" aria-label="The change">
        <h3 className="h3">{change ? 'The change' : 'The two sides'}</h3>
        {change ? (
          <dl className="facts">
            <div><dt>Setting</dt><dd>{change.setting}, {change.from} → {change.to}</dd></div>
            <div><dt>Date</dt><dd>{change.date}, left out of both sides</dd></div>
            <div><dt>Proposed</dt><dd>{change.proposedBy === PATIENT.first ? 'You' : change.proposedBy}</dd></div>
            <div><dt>Agreed</dt><dd>{change.agreedBy ?? 'Not recorded'}</dd></div>
            <div><dt>Review</dt><dd>{change.reviewDate ?? 'Not set'}</dd></div>
          </dl>
        ) : (
          <p className="small">{LUNCH.change}.</p>
        )}
        <p className="small">{TEXT.lunchContext}</p>
        <p className="caption">What happened after the change, not proof the change did it.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ time in range

function TirLegend() {
  return (
    <ul className="tir-legend">
      {bands().map((b) => (
        <li key={b.key} className={b.key === 'in' ? 'in' : ''}>
          <span className="sw" style={{ background: b.fill }} />
          <span>{b.label}</span>
          <span className="num">{b.pct}%</span>
        </li>
      ))}
    </ul>
  );
}

function TimeInRangeGlance({ h }: FaceProps) {
  return (
    <div className="face">
      <div className="row baseline" style={{ gap: 8 }}>
        <span className="big-num">{READ.inRangePct}%</span>
        <span className="small">in range · 14 days</span>
      </div>
      {h > 1 ? (
        <div className="row grow" style={{ alignItems: 'stretch', gap: 16 }}>
          <Fit className="tir-fit">{({ w, h: hh }) => <TirBar W={w} H={hh} labels={false} />}</Fit>
          <TirLegend />
        </div>
      ) : (
        <span className="small">Low {READ.lowPct}% · very low {READ.veryLowPct}%</span>
      )}
    </div>
  );
}

function TimeInRangeDetail() {
  const goals: Record<string, string> = { 'very-high': 'under 5%', high: 'under 25% with very high', in: 'over 70%', low: 'under 4% with very low', 'very-low': 'under 1%' };
  return (
    <div className="detail-grid">
      <section className="panel stack-12" aria-label="Time in range">
        <div className="row baseline" style={{ gap: 8 }}>
          <span className="big-num">{READ.inRangePct}%</span>
          <span className="small">in range, {PERIOD.label} · ↑{READ.inRangeSinceLastVisit} since your last visit</span>
        </div>
        <div className="row" style={{ alignItems: 'stretch', gap: 24, height: 280 }}>
          <Fit className="tir-fit">{({ w, h }) => <TirBar W={w} H={h} labels={false} />}</Fit>
          <table className="table">
            <caption className="sr-only">Time in each glucose band</caption>
            <thead><tr><th scope="col">Band</th><th scope="col">mg/dL</th><th scope="col" className="num">You</th><th scope="col">Common goal</th></tr></thead>
            <tbody>
              {bands().map((b) => (
                <tr key={b.key}>
                  <th scope="row"><span className="sw" style={{ background: b.fill }} /> {b.label}</th>
                  <td>{b.range}</td>
                  <td className="num strong">{b.pct}%</td>
                  <td>{goals[b.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="panel stack-12" aria-label="About the bands">
        <h3 className="h3">About the bands</h3>
        <p className="small">The five bands from the standard glucose report, the one most clinics print. Sensor worn {READ.sensorWornPct}% of the time, so the 14 days have enough data to read.</p>
        <p className="small">GMI {READ.gmiPct}% · variability (CV) {READ.cvPct}%.</p>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ device life

function DeviceRows() {
  const build = useLoopBuild();
  // The real build, when GitHub is connected; else the dataset's (the synthetic patient's).
  const buildDays = build ? daysLeft(build) : PATIENT.buildExpiresDays;
  return (
    <ul className="device">
      {DATA.source === 'synthetic' ? (
        <>
          <li><span className="label">Pod</span><b>2d 14h</b><span className="caption">of 3 days</span></li>
          <li><span className="label">Sensor</span><b>Day 7</b><span className="caption">of 10</span></li>
        </>
      ) : (
        <>
          <li><span className="label">Site</span><b>{PATIENT.podAge.replace(/^Site /, '')}</b><span className="caption">since the last site change</span></li>
          <li><span className="label">Sensor</span><b>{PATIENT.sensorDay.replace(/^Sensor /, '')}</b><span className="caption">since the last sensor start</span></li>
        </>
      )}
      {buildDays != null && <li><span className="label">Build</span><b>{buildDays < 0 ? 'Expired' : `${buildDays} days`}</b><span className="caption">{buildDays < 0 ? 'build again' : 'until TestFlight expires'}</span></li>}
    </ul>
  );
}

function DeviceLifeGlance() {
  return <div className="face"><DeviceRows /></div>;
}

function DeviceLifeDetail() {
  return (
    <div className="detail-grid">
      <section className="panel stack-16" aria-label="Device life">
        <DeviceRows />
        <p className="small">Quiet until it matters: a pod change, a sensor warm-up or a rebuild shows here a day ahead.</p>
      </section>
      <aside className="panel stack-12" aria-label="Your system">
        <h3 className="h3">Your system</h3>
        <dl className="facts">
          <div><dt>App</dt><dd>Loop 3.6</dd></div>
          <div><dt>Pump</dt><dd>Omnipod DASH</dd></div>
          <div><dt>CGM</dt><dd>Dexcom G7</dd></div>
          <div><dt>Looping</dt><dd>{READ.automationPct}% of the time</dd></div>
          <div><dt>Gaps</dt><dd>{READ.automationGaps}</dd></div>
        </dl>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------ care-team thread

export function Thread({ side, limit }: { side: 'patient' | 'clinician'; limit?: number }) {
  const { thread } = useStore();
  const items = limit ? thread.slice(-limit) : thread;
  return (
    <ol className="thread" aria-label={side === 'patient' ? `Thread with ${PATIENT.clinician}` : `Thread with ${PATIENT.first}`}>
      {items.map((m: Msg, i) => (
        <li key={`${m.date}${i}`} className={`msg ${(m.from === 'sam') === (side === 'patient') ? 'mine' : ''}`}>
          <span className="caption">{who(m, side)} · {m.date}</span>
          {m.attach && <div className="attach">{m.attach}</div>}
          <div className="bubble">{m.text}</div>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------ registry

export const FACES: Record<TileKind, { Glance: (p: FaceProps) => ReactNode; Detail: (p: FaceProps) => ReactNode }> = {
  'glucose-now': { Glance: GlucoseNowGlance, Detail: GlucoseNowDetail },
  'heads-ups': { Glance: HeadsUpsGlance, Detail: HeadsUpsDetail },
  'day-tracker': { Glance: DayTrackerGlance, Detail: DayTrackerDetail },
  'what-loop-did': { Glance: WhatLoopDidPatternsGlance, Detail: WhatLoopDidPatternsDetail },
  'before-after': { Glance: BeforeAfterGlance, Detail: BeforeAfterDetail },
  'time-in-range': { Glance: TimeInRangeGlance, Detail: TimeInRangeDetail },
  'device-life': { Glance: DeviceLifeGlance, Detail: DeviceLifeDetail },
  'care-thread': { Glance: CareThreadGlance, Detail: CareThreadDetail },
  meals: { Glance: FavoriteFoodsGlance, Detail: FavoriteFoodsDetail },
  'daily-glucose': { Glance: DailyGlucoseGlance, Detail: DailyGlucoseDetail },
};

export const tileTitle = (k: TileKind) => TILES[k].title;
