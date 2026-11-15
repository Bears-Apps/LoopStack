// "What Loop did", as patterns: the times of day when Loop's delivery kept
// differing from the scheduled basal (temp basals below it, temp basals and
// automatic boluses above it, or 0 U/hr temp basals). Each pattern carries
// its days, so the tile can expand into a per-day breakdown, and the daily
// balance sums the differences. Observations only (SAFE-1).
//
// Rules (from the data-presentation pass):
// - A day "shows" a pattern when its net delivery over the stretch is beyond
//   max(15% of scheduled, 0.05 U/hr) in the same direction; for 0 U/hr, when
//   delivery is near zero for at least half the stretch.
// - A day counts for a stretch when it has data in every hour of it, so a day
//   that lost the night still counts for the evening.
// - A daily pattern needs at least 5 days; one that falls on a single weekday
//   needs 3 occurrences. Below that it is listed as "not enough yet".
// - Rates are medians over the days that showed the pattern, with the range.
import type { Day, HourState } from './dataset';

export type PatternKind = 'below' | 'above' | 'zero';
export type Trend = 'falling' | 'steady' | 'rising';

export interface PatternHour { hour: number; scheduled: number; delivered: number }
export interface PatternDay {
  day: Day;
  /** 'seen': showed the pattern · 'not': counted, didn't · 'nodata': missing data in the stretch (VIS-4). */
  status: 'seen' | 'not' | 'nodata';
  hours: PatternHour[];
  /** Net units over the stretch, delivered minus scheduled. */
  netU: number;
  glucoseStart: number | null;
  trend: Trend | null;
  low: number | null;
  high: number | null;
  workout: boolean;
}
export interface Pattern {
  kind: PatternKind;
  start: number;
  end: number;
  /** 0 = Sunday, when every day that showed it fell on one weekday. */
  weekday: number | null;
  seen: number;
  /** Days that counted for this stretch (that weekday's, for a weekday pattern). */
  of: number;
  /** Enough days to call it a pattern. */
  established: boolean;
  /** Median and range of net U/hr over the stretch, on days that showed it. */
  netUph: number;
  netRange: [number, number];
  /** Median net units over the whole stretch. */
  unitsEach: number;
  /** Median units of Loop's automatic boluses over the stretch, on days that showed it. */
  autoBolusEach: number;
  glucoseMedian: number | null;
  /** How many days that showed it had glucose falling / steady / rising into the stretch. */
  trends: Record<Trend, number>;
  /** Days that showed it with a workout logged before or during the stretch. */
  workouts: number;
  /** The override running for most of the stretch on the days that showed it, and on how many. */
  override: { name: string; days: number } | null;
  days: PatternDay[];
  /** For the expanded chart: per hour from start−2 to end+2, the median across days that showed it. */
  window: { hour: number; scheduled: number; delivered: number | null; glucose: number | null; g25: number | null; g75: number | null }[];
}
export interface Balance {
  /** Mean per counted day, U. */
  scheduled: number;
  delivered: number;
  net: number;
  /** Units below and above schedule in hours beyond tolerance (mean per day). */
  below: number;
  above: number;
  /** Loop's automatic boluses, mean U per day (not part of basal). */
  autoBolus: number;
  days: number;
}
export interface HourRow {
  hour: number;
  scheduled: number;
  delivered: number | null;
  net: number | null;
  above: number;
  below: number;
  about: number;
  zero: number;
  nodata: number;
}

export interface PatternInputs {
  days: readonly Day[];
  sched: readonly number[];
  state: Readonly<Record<Day, readonly HourState[]>>;
  /** Temp basal delivered, U/hr. */
  rate: (day: Day, hour: number) => number;
  /** Loop's automatic boluses in that hour, U. */
  autoBolus?: (day: Day, hour: number) => number;
  /** The schedule Loop worked to that hour (scheduled × an override's insulin needs); defaults to sched. */
  schedOf?: (day: Day, hour: number) => number;
  /** The override running for most of that hour, if any. */
  overrideAt?: (day: Day, hour: number) => string | null;
  hourlyGlucose: Readonly<Record<Day, readonly (number | null)[]>>;
  weekdayOf: (day: Day) => number;
  workoutDays?: readonly Day[];
  workoutHour?: number | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
export function median(v: readonly number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const q = (v: readonly number[], p: number) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * p))];
};
const hasData = (inp: PatternInputs, d: Day, h: number) => inp.state[d]?.[h] !== 'x';
const sch = (inp: PatternInputs, d: Day, h: number) => inp.schedOf?.(d, h) ?? inp.sched[h];
const tol = (sched: number) => Math.max(0.15 * sched, 0.05);
const trendOf = (before: number | null, at: number | null): Trend | null => {
  if (before == null || at == null) return null;
  const d = at - before;
  return d <= -6 ? 'falling' : d >= 6 ? 'rising' : 'steady';
};

/** What one day did over [h, e): its net U/hr and which way it differed. */
function dayAt(inp: PatternInputs, d: Day, h: number, e: number) {
  const span = Array.from({ length: e - h }, (_, i) => h + i);
  if (!span.every((x) => hasData(inp, d, x))) return { kind: null as PatternKind | null, net: 0, nodata: true, span };
  const net = span.reduce((t, x) => t + inp.rate(d, x) - sch(inp, d, x), 0) / span.length;
  const schedMean = span.reduce((t, x) => t + sch(inp, d, x), 0) / span.length;
  const zeroHours = span.filter((x) => inp.rate(d, x) <= 0.05).length;
  const kind: PatternKind | null = zeroHours * 2 >= span.length ? 'zero' : net < -tol(schedMean) ? 'below' : net > tol(schedMean) ? 'above' : null;
  return { kind, net, nodata: false, span };
}

export function balance(inp: PatternInputs): Balance {
  const per = inp.days.filter((d) => inp.state[d]?.some((s) => s !== 'x')).map((d) => {
    let below = 0;
    let above = 0;
    let delivered = 0;
    let scheduled = 0;
    let auto = 0;
    for (let h = 0; h < 24; h += 1) {
      if (!hasData(inp, d, h)) continue;
      auto += inp.autoBolus?.(d, h) ?? 0;
      const r = inp.rate(d, h);
      const s = sch(inp, d, h);
      delivered += r;
      scheduled += s;
      if (r < s - tol(s)) below += s - r;
      else if (r > s + tol(s)) above += r - s;
    }
    return { below, above, delivered, scheduled, auto };
  });
  const n = Math.max(1, per.length);
  const mean = (f: (x: (typeof per)[number]) => number) => per.reduce((t, x) => t + f(x), 0) / n;
  const scheduled = mean((x) => x.scheduled);
  const delivered = mean((x) => x.delivered);
  return { scheduled: r1(scheduled), delivered: r1(delivered), net: r1(delivered - scheduled), below: r1(mean((x) => x.below)), above: r1(mean((x) => x.above)), autoBolus: r1(mean((x) => x.auto)), days: per.length };
}

export function findPatterns(inp: PatternInputs): Pattern[] {
  // 1. Each hour's leading kind, if it shows on enough days; neighbours of the same kind join.
  const kindAt = (h: number): PatternKind | null => {
    const counted = inp.days.filter((d) => hasData(inp, d, h));
    const tally: Record<PatternKind, number> = { below: 0, above: 0, zero: 0 };
    for (const d of counted) { const k = dayAt(inp, d, h, h + 1).kind; if (k) tally[k] += 1; }
    if (tally.zero >= 2) return 'zero';
    if (tally.below >= Math.max(3, Math.ceil(counted.length * 0.4))) return 'below';
    if (tally.above >= Math.max(3, Math.ceil(counted.length * 0.4))) return 'above';
    return null;
  };
  const out: Pattern[] = [];
  let h = 0;
  while (h < 24) {
    const k = kindAt(h);
    if (!k) { h += 1; continue; }
    let e = h + 1;
    while (e < 24 && kindAt(e) === k) e += 1;
    out.push(build(inp, k, h, e));
    h = e;
  }
  const ok = (p: Pattern) => (p.established ? 1 : 0);
  return out.sort((a, b) => ok(b) - ok(a) || b.seen / Math.max(1, b.of) - a.seen / Math.max(1, a.of) || Math.abs(b.netUph) - Math.abs(a.netUph));
}

function build(inp: PatternInputs, kind: PatternKind, h: number, e: number): Pattern {
  const days: PatternDay[] = inp.days.map((d) => {
    const at = dayAt(inp, d, h, e);
    const g = inp.hourlyGlucose[d] ?? [];
    const inStretch = at.span.map((x) => g[x]).filter((v): v is number => v != null);
    return {
      day: d,
      status: at.nodata ? 'nodata' : at.kind === kind ? 'seen' : 'not',
      hours: at.span.map((x) => ({ hour: x, scheduled: r2(sch(inp, d, x)), delivered: r2(inp.rate(d, x)) })),
      netU: r2(at.net * (e - h)),
      glucoseStart: g[h] ?? null,
      trend: trendOf(h > 0 ? g[h - 1] ?? null : null, g[h] ?? null),
      low: inStretch.length ? Math.min(...inStretch) : null,
      high: inStretch.length ? Math.max(...inStretch) : null,
      workout: (inp.workoutDays ?? []).includes(d) && inp.workoutHour != null && inp.workoutHour <= e,
    };
  });
  const seenDays = days.filter((d) => d.status === 'seen');
  const wds = seenDays.map((d) => inp.weekdayOf(d.day));
  const weekday = seenDays.length >= 2 && wds.every((w) => w === wds[0]) ? wds[0] : null;
  const countedDays = days.filter((d) => d.status !== 'nodata' && (weekday == null || inp.weekdayOf(d.day) === weekday));
  const nets = seenDays.map((d) => d.netU / (e - h));
  const trends: Record<Trend, number> = { falling: 0, steady: 0, rising: 0 };
  for (const d of seenDays) if (d.trend) trends[d.trend] += 1;
  const window = [];
  for (let x = Math.max(0, h - 2); x < Math.min(24, e + 2); x += 1) {
    const gs = seenDays.map((d) => inp.hourlyGlucose[d.day]?.[x]).filter((v): v is number => v != null);
    const rs = seenDays.filter((d) => hasData(inp, d.day, x)).map((d) => inp.rate(d.day, x));
    const ss = seenDays.map((d) => sch(inp, d.day, x));
    window.push({ hour: x, scheduled: r2(median(ss) ?? inp.sched[x]), delivered: rs.length ? r2(median(rs)!) : null, glucose: median(gs), g25: q(gs, 0.25), g75: q(gs, 0.75) });
  }
  return {
    kind,
    start: h,
    end: e,
    weekday,
    seen: seenDays.length,
    of: countedDays.length,
    established: weekday == null ? seenDays.length >= 5 : seenDays.length >= 3,
    netUph: r2(median(nets) ?? 0),
    netRange: nets.length ? [r2(Math.min(...nets)), r2(Math.max(...nets))] : [0, 0],
    unitsEach: r1(median(seenDays.map((d) => d.netU)) ?? 0),
    autoBolusEach: r1(median(seenDays.map((d) => Array.from({ length: e - h }, (_, i) => inp.autoBolus?.(d.day, h + i) ?? 0).reduce((a, b) => a + b, 0))) ?? 0),
    glucoseMedian: median(seenDays.map((d) => d.glucoseStart).filter((v): v is number => v != null)),
    trends,
    workouts: seenDays.filter((d) => d.workout).length,
    override: (() => {
      const c = new Map<string, number>();
      for (const d of seenDays) {
        const names = Array.from({ length: e - h }, (_, i) => inp.overrideAt?.(d.day, h + i) ?? null).filter((v): v is string => v != null);
        const top = [...new Set(names)].map((n) => [n, names.filter((x) => x === n).length] as const).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] * 2 >= e - h) c.set(top[0], (c.get(top[0]) ?? 0) + 1);
      }
      const best = [...c].sort((a, b) => b[1] - a[1])[0];
      return best ? { name: best[0], days: best[1] } : null;
    })(),
    days,
    window,
  };
}

/** Every hour, for the "See every hour" table (VIS-8). */
export function hourRows(inp: PatternInputs): HourRow[] {
  return Array.from({ length: 24 }, (_, h) => {
    const row: HourRow = { hour: h, scheduled: inp.sched[h], delivered: null, net: null, above: 0, below: 0, about: 0, zero: 0, nodata: 0 };
    const rs: number[] = [];
    for (const d of inp.days) {
      const at = dayAt(inp, d, h, h + 1);
      if (at.nodata) { row.nodata += 1; continue; }
      rs.push(inp.rate(d, h));
      if (at.kind === 'zero') row.zero += 1;
      else if (at.kind === 'below') row.below += 1;
      else if (at.kind === 'above') row.above += 1;
      else row.about += 1;
    }
    const m = median(rs);
    row.delivered = m == null ? null : r2(m);
    const effs = inp.days.filter((d) => hasData(inp, d, h)).map((d) => sch(inp, d, h));
    row.net = m == null ? null : r2(m - (median(effs) ?? inp.sched[h]));
    return row;
  });
}
