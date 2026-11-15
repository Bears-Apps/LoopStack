import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import { dailyBasalTotal, valueAt } from '@/data/loopTherapy';

// Basal insight: the one therapy lever with no analysis behind it until now.
//
// The question a basal schedule answers is "what happens to glucose when
// nothing else is happening" — no food, no correction, no exercise. So the only
// honest way to read it from history is to find those quiet stretches and see
// which way glucose drifted. A rise while fasting says the hour is under-
// covered; a fall says over-covered. Everything else in the day is noise for
// this purpose, which is why the windows below are so aggressively filtered.
//
// Output is pattern-support, never a rate change: LoopStack states the drift it
// measured and how consistent it was, and leaves the schedule to Loop and the
// care team.

/** Hours after a carb entry during which glucose is still meal-driven. */
const MEAL_SHADOW_HOURS = 4;
/** Hours after a bolus during which insulin activity is still meal-driven. */
const BOLUS_SHADOW_HOURS = 4;
/** A window must be at least this long to say anything about drift. */
const MIN_WINDOW_MINUTES = 120;
/** Readings needed inside a window before its slope means anything. */
const MIN_READINGS = 12;
/** Nights needed before an hour-block's drift is called a pattern. */
export const MIN_NIGHTS_FOR_PATTERN = 4;
/** mg/dL of drift across a window below which the window counts as flat. */
export const FLAT_DRIFT_MGDL = 15;

export type FastingWindow = {
  startIso: string;
  endIso: string;
  minutes: number;
  startMgdl: number;
  endMgdl: number;
  /** Signed change across the window. Positive = drifted up. */
  driftMgdl: number;
  /** Drift normalised to mg/dL per hour, the comparable figure. */
  driftPerHour: number;
  /** Local hour the window started in. */
  startHour: number;
};

export type BasalHourBlock = {
  label: string;
  startHour: number;
  endHour: number;
  windowCount: number;
  avgDriftPerHour: number;
  /** Share of windows that drifted the same way as the average (0–100). */
  consistencyPct: number;
  verdict: 'flat' | 'drifts_up' | 'drifts_down' | 'building';
  scheduledRate: number;
  note: string;
};

export type BasalInsights = {
  windowDays: number;
  /** U/day the schedule adds up to. */
  scheduledDailyU: number;
  /** U/day actually delivered as basal, when the source measures it. */
  deliveredDailyU: number | null;
  /** delivered − scheduled, or null when basal isn't measured. */
  deliveryDeltaU: number | null;
  fastingWindows: FastingWindow[];
  blocks: BasalHourBlock[];
  /** Evidence-phrased review lines. Empty until the gates are cleared. */
  suggestions: string[];
};

const ms = (iso: string) => new Date(iso).getTime();

/** Overnight first: the longest reliably-fasting stretch most people have. */
const BLOCKS: { label: string; startHour: number; endHour: number }[] = [
  { label: 'Overnight', startHour: 0, endHour: 6 },
  { label: 'Morning', startHour: 6, endHour: 11 },
  { label: 'Afternoon', startHour: 11, endHour: 17 },
  { label: 'Evening', startHour: 17, endHour: 24 },
];

/**
 * Stretches with no carbs and no bolus in effect, and enough readings to read a
 * slope. These are the only windows where glucose movement can be attributed to
 * background insulin rather than to a meal.
 */
export function findFastingWindows(
  glucose: GlucoseReading[],
  carbs: CarbEntry[],
  insulin: InsulinEvent[],
): FastingWindow[] {
  if (glucose.length === 0) return [];

  const sorted = [...glucose].sort((a, b) => ms(a.iso) - ms(b.iso));

  // Every interval where food or a bolus is still acting.
  const busy: { start: number; end: number }[] = [];
  for (const c of carbs) {
    const t = ms(c.iso);
    const hours = Math.max(c.absorptionHours ?? 3, MEAL_SHADOW_HOURS);
    busy.push({ start: t, end: t + hours * 3600_000 });
  }
  for (const i of insulin) {
    if (i.kind !== 'bolus') continue;
    const t = ms(i.iso);
    busy.push({ start: t, end: t + BOLUS_SHADOW_HOURS * 3600_000 });
  }
  busy.sort((a, b) => a.start - b.start);

  const isBusy = (t: number) => busy.some((b) => t >= b.start && t <= b.end);

  const windows: FastingWindow[] = [];
  let run: GlucoseReading[] = [];

  const flush = () => {
    if (run.length >= MIN_READINGS) {
      const first = run[0];
      const last = run[run.length - 1];
      const minutes = (ms(last.iso) - ms(first.iso)) / 60_000;
      if (minutes >= MIN_WINDOW_MINUTES) {
        const drift = last.mgdl - first.mgdl;
        windows.push({
          startIso: first.iso,
          endIso: last.iso,
          minutes: Math.round(minutes),
          startMgdl: first.mgdl,
          endMgdl: last.mgdl,
          driftMgdl: drift,
          driftPerHour: +(drift / (minutes / 60)).toFixed(1),
          startHour: new Date(first.iso).getHours(),
        });
      }
    }
    run = [];
  };

  for (const g of sorted) {
    const t = ms(g.iso);
    // A gap in CGM data breaks the window: we cannot claim a drift across
    // hours we did not observe.
    const prev = run[run.length - 1];
    if (prev && t - ms(prev.iso) > 30 * 60_000) flush();
    if (isBusy(t)) flush();
    else run.push(g);
  }
  flush();

  return windows;
}

function blockOf(hour: number) {
  return BLOCKS.find((b) => hour >= b.startHour && hour < b.endHour) ?? BLOCKS[0];
}

export function computeBasalInsights(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  windowDays: number;
  /** U/day of basal actually delivered, when the source measures it. */
  deliveredDailyU?: number | null;
  now: Date;
}): BasalInsights {
  const { therapy, windowDays, now } = input;
  const windowStartMs = now.getTime() - windowDays * 24 * 3600_000;

  const inWindow = <T extends { iso: string }>(xs: T[]) =>
    xs.filter((x) => ms(x.iso) >= windowStartMs);

  const glucose = inWindow(input.glucose);
  const carbs = inWindow(input.carbs);
  const insulin = inWindow(input.insulin);

  const fastingWindows = findFastingWindows(glucose, carbs, insulin);
  const scheduledDailyU = dailyBasalTotal(therapy);
  const deliveredDailyU = input.deliveredDailyU ?? null;

  const blocks: BasalHourBlock[] = BLOCKS.map((b) => {
    const mine = fastingWindows.filter((w) => {
      const blk = blockOf(w.startHour);
      return blk.startHour === b.startHour;
    });
    // Rate at the middle of the block — representative of what was running.
    const midMinutes = ((b.startHour + b.endHour) / 2) * 60;
    const scheduledRate = valueAt(therapy.basalSchedule, midMinutes);

    if (mine.length < MIN_NIGHTS_FOR_PATTERN) {
      return {
        label: b.label,
        startHour: b.startHour,
        endHour: b.endHour,
        windowCount: mine.length,
        avgDriftPerHour: 0,
        consistencyPct: 0,
        verdict: 'building',
        scheduledRate,
        note: `${mine.length} of ${MIN_NIGHTS_FOR_PATTERN} quiet stretches needed before this block can be read.`,
      };
    }

    const avg =
      mine.reduce((a, w) => a + w.driftPerHour, 0) / mine.length;
    const avgTotal = mine.reduce((a, w) => a + w.driftMgdl, 0) / mine.length;
    const sameWay = mine.filter((w) =>
      avg >= 0 ? w.driftPerHour > 0 : w.driftPerHour < 0,
    ).length;
    const consistencyPct = Math.round((sameWay / mine.length) * 100);

    let verdict: BasalHourBlock['verdict'] = 'flat';
    let note = `Glucose held steady across ${mine.length} quiet stretches — nothing here points at the schedule.`;
    if (Math.abs(avgTotal) >= FLAT_DRIFT_MGDL) {
      verdict = avgTotal > 0 ? 'drifts_up' : 'drifts_down';
      const dir = avgTotal > 0 ? 'rose' : 'fell';
      note = `Glucose ${dir} about ${Math.abs(Math.round(avgTotal))} mg/dL across ${mine.length} quiet stretches (${consistencyPct}% drifted the same way). Worth reviewing this block with your care team.`;
    }

    return {
      label: b.label,
      startHour: b.startHour,
      endHour: b.endHour,
      windowCount: mine.length,
      avgDriftPerHour: +avg.toFixed(1),
      consistencyPct,
      verdict,
      scheduledRate,
      note,
    };
  });

  // ── suggestions ──
  const suggestions: string[] = [];
  for (const b of blocks) {
    if (b.verdict === 'drifts_up' && b.consistencyPct >= 60) {
      suggestions.push(
        `${b.label} (${b.startHour}:00–${b.endHour}:00) drifts up while fasting — ${b.note}`,
      );
    } else if (b.verdict === 'drifts_down' && b.consistencyPct >= 60) {
      suggestions.push(
        `${b.label} (${b.startHour}:00–${b.endHour}:00) drifts down while fasting — ${b.note}`,
      );
    }
  }
  if (deliveredDailyU != null) {
    const delta = deliveredDailyU - scheduledDailyU;
    // 15% is roughly where Loop's routine ±adjustments stop explaining it.
    if (Math.abs(delta) / Math.max(scheduledDailyU, 0.1) >= 0.15) {
      const dir = delta > 0 ? 'more' : 'less';
      suggestions.push(
        `Loop delivered about ${Math.abs(delta).toFixed(1)} U/day ${dir} basal than the schedule calls for (${deliveredDailyU.toFixed(1)} vs ${scheduledDailyU.toFixed(1)}). A consistent gap usually means the schedule and the need have drifted apart.`,
      );
    }
  }

  return {
    windowDays,
    scheduledDailyU,
    deliveredDailyU,
    deliveryDeltaU:
      deliveredDailyU != null
        ? +(deliveredDailyU - scheduledDailyU).toFixed(2)
        : null,
    fastingWindows,
    blocks,
    suggestions,
  };
}
