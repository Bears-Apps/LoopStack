import type { DayHourGrid, HourCell } from '@/lib/metrics/dayHourGrid';
import { WEEKDAY_LABELS } from '@/lib/metrics/dayHourGrid';
import type { RiskWindow } from './riskWindows';
import { formatHour } from './riskWindows';

// A heads-up two hours before a stretch of the week that usually runs low or
// high.
//
// The morning report says what today usually does; this taps on the shoulder
// shortly before it does it. It reads the same weekday × hour grid, so the two
// can never disagree about which hours are the trend. The bar is a share of
// readings: an hour counts once at least HEADS_UP_MIN_PCT of its readings, on
// that weekday, sat below the low line (or above the high line). Lows and highs
// use the same bar here, by the user's choice: the point is to hear about any
// stretch that goes out of range often enough to plan around. The bar was 15%
// and in practice fired nothing; 10% (about six readings in an hour, on one
// Tuesday in two) is where a recurring dip starts showing.
//
// The evidence rules are the grid's: a cell only speaks once three separate
// weeks have voted on it, and the weekday needs three weeks of history. The
// grid covers the last twelve weeks (PATTERN_SAMPLE_WEEKS).
//
// Like the morning report, each heads-up is a weekly calendar slot owned by
// iOS, so it arrives on a Thursday whether or not the app has been opened.
// Pattern notices only: what it says is how often, never what to do.

export const HEADS_UP_LEAD_HOURS = 2;
export const HEADS_UP_MIN_PCT = 10;
/** Per weekday. More than this in a day and the notifications stop being read. */
export const MAX_HEADS_UPS_PER_DAY = 3;
const MIN_WEEKS = 3;

export type TrendStretch = {
  weekday: number;
  kind: 'low' | 'high';
  /** Inclusive start and end hours. */
  startHour: number;
  endHour: number;
  /** Mean share of readings out of range across the stretch's hours. */
  sharePct: number;
  /** Fewest weeks behind any hour in the stretch. */
  weeks: number;
};

const share = (c: HourCell, kind: 'low' | 'high') => (kind === 'low' ? c.lowPct : c.highPct) ?? 0;

/** Contiguous hours of one weekday at or over the bar, strongest first. */
export function findTrendStretches(grid: DayHourGrid, weekday: number, minPct = HEADS_UP_MIN_PCT): TrendStretch[] {
  const day = grid.days.find((d) => d.weekday === weekday);
  if (!day || day.weeksObserved < MIN_WEEKS) return [];
  const out: TrendStretch[] = [];
  for (const kind of ['low', 'high'] as const) {
    let run: HourCell[] = [];
    const flush = () => {
      if (run.length) {
        out.push({
          weekday,
          kind,
          startHour: run[0].hour,
          endHour: run[run.length - 1].hour,
          sharePct: Math.round(run.reduce((a, c) => a + share(c, kind), 0) / run.length),
          weeks: Math.min(...run.map((c) => c.weeksVoted)),
        });
      }
      run = [];
    };
    for (const cell of day.hours) {
      if (cell.reliable && share(cell, kind) >= minPct) run.push(cell);
      else flush();
    }
    flush();
  }
  // A low outranks a high; within a kind, the stretch that goes out of range
  // more often leads.
  return out.sort((a, b) => (a.kind === b.kind ? b.sharePct - a.sharePct : a.kind === 'low' ? -1 : 1));
}

/** True when a recurring-window alert already covers this stretch's start. */
function coveredBy(s: TrendStretch, windows: RiskWindow[]): boolean {
  return windows.some(
    (w) =>
      w.confidence === 'good' &&
      w.kind === s.kind &&
      (w.weekday == null || w.weekday === s.weekday) &&
      s.startHour >= w.startHour - 1 &&
      s.startHour < w.endHour,
  );
}

export type HeadsUp = TrendStretch & {
  /** Weekly slot the notification fires in (0 = Sunday), lead time applied. */
  fireOn: { weekday: number; hour: number; minute: number };
  title: string;
  body: string;
};

export function buildHeadsUps(input: {
  grid: DayHourGrid;
  /** Windows the risk-window alerts already announce; skipped here. */
  alreadyAlerted?: RiskWindow[];
  minPct?: number;
}): HeadsUp[] {
  const { grid } = input;
  const out: HeadsUp[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const stretches = findTrendStretches(grid, weekday, input.minPct)
      .filter((s) => !coveredBy(s, input.alreadyAlerted ?? []))
      .slice(0, MAX_HEADS_UPS_PER_DAY);
    for (const s of stretches) {
      // A 1am stretch is announced at 11pm the evening before.
      const lead = s.startHour - HEADS_UP_LEAD_HOURS;
      const fireOn = {
        weekday: lead < 0 ? (weekday + 6) % 7 : weekday,
        hour: (lead + 24) % 24,
        minute: 0,
      };
      const label = WEEKDAY_LABELS[weekday];
      const span = s.startHour === s.endHour ? formatHour(s.startHour) : `${formatHour(s.startHour)}–${formatHour(s.endHour + 1)}`;
      const line = s.kind === 'low' ? `under ${grid.targetLowMgdl}` : `over ${grid.targetHighMgdl}`;
      out.push({
        ...s,
        fireOn,
        title: `${label}s ${span} often runs ${s.kind}`,
        body:
          `In about ${HEADS_UP_LEAD_HOURS} hours. On ${label}s, about ${s.sharePct}% of readings ${span === formatHour(s.startHour) ? 'in that hour' : 'across that stretch'} ` +
          `have been ${line} mg/dL, over ${s.weeks} weeks. A heads-up, not a recommendation.`,
      });
    }
  }
  return out;
}
