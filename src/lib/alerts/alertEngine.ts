import type { RiskWindow } from './riskWindows';
import type { DayHourGrid } from '@/lib/metrics/dayHourGrid';
import { buildDayReport, reportNotificationBody } from './dayReport';
import { formatHour } from './riskWindows';
import { buildHeadsUps, HEADS_UP_MIN_PCT } from './trendHeadsUp';
import { PATTERN_SAMPLE_WEEKS } from '@/lib/metrics/dayHourGrid';
import { weekdayPatternPath } from '@/lib/metrics/weekdayHourly';
import type { SettingsReview } from '@/lib/metabolism/settingsReview';
import type { AbsorptionInsights } from '@/lib/metabolism/absorptionProfile';
import type { BasalInsights } from '@/lib/metabolism/basalInsights';
import type { Autosens } from '@/lib/metabolism/autosens';
import type { AutotuneResult } from '@/lib/metabolism/autotune';

// The alert catalog.
//
// Every alert here is a heads-up about a PATTERN, never an instruction. The
// distinction matters more in a notification than anywhere else in the app: a
// push arrives with no context, often on a lock screen, and a person acts on
// it faster than they would on a screen they chose to open. So the copy states
// what has repeated, how often, and how far ahead the notice is — and leaves
// the decision, and the dose, where they belong.
//
// Each category is toggleable independently:
//
//   risk_window      Recurring low/high stretches, 2 h and 1 h ahead of the window.
//   trend_heads_up   2 h before a weekday hour that runs low or high 10%+ of the time.
//   day_report       The morning read of what this weekday usually does.
//   trend_confidence A reading that could not be trusted before is now readable.
//   overnight_drift  Fasting glucose that keeps drifting, flagged before bed.
//   sensitivity_shift A run of days where insulin is behaving differently.
//   data_health      The data feeding all of the above went quiet or incomplete.
//
// data_health earns its place: every other alert is only as good as the stream
// behind it, and a scheduler that keeps firing confident predictions off a
// three-day-old snapshot is worse than one that says nothing.

export type AlertCategory =
  | 'risk_window'
  | 'trend_confidence'
  | 'overnight_drift'
  | 'sensitivity_shift'
  | 'data_health'
  | 'day_report'
  | 'trend_heads_up';

export const ALERT_CATEGORIES: {
  id: AlertCategory;
  label: string;
  description: string;
}[] = [
  {
    id: 'risk_window',
    label: 'Recurring low & high windows',
    description:
      'When a stretch that has repeatedly run low or high is coming up — 2 hours and 1 hour ahead.',
  },
  {
    id: 'trend_heads_up',
    label: 'Heads-up before a usual low or high',
    description: `Two hours before an hour of the week that has run low or high at least ${HEADS_UP_MIN_PCT}% of the time over the last ${PATTERN_SAMPLE_WEEKS} weeks, once three weeks of that weekday are on record. Up to three a day; arrives whether or not the app is open.`,
  },
  {
    id: 'day_report',
    label: 'Morning report for the day ahead',
    description:
      'Each morning, the stretches this weekday usually runs high, runs low, or swings — with whatever the app knows was happening at the time. Only the hours worth knowing about; a day with no pattern sends nothing.',
  },
  {
    id: 'trend_confidence',
    label: 'New trend confidence reached',
    description:
      'When enough history accumulates that a reading crosses from "not enough data" into something worth looking at.',
  },
  {
    id: 'overnight_drift',
    label: 'Overnight drift',
    description:
      'An evening heads-up when fasting glucose has been drifting the same direction most nights.',
  },
  {
    id: 'sensitivity_shift',
    label: 'Sensitivity shift',
    description:
      'When insulin has been behaving differently than your settings expect for a sustained stretch.',
  },
  {
    id: 'data_health',
    label: 'Data health',
    description:
      'When the glucose or insulin stream goes quiet, or arrives incomplete — because every other alert depends on it.',
  },
];

export type PendingAlert = {
  /** Stable across refreshes so re-scheduling replaces rather than duplicates. */
  id: string;
  /**
   * The FINDING this alert is about, when several alerts describe one finding.
   *
   * A recurring window produces one alert per lead time — two notifications is
   * the intent, two inbox rows is not. Without this the inbox filed "Fridays
   * around 4pm–6pm has been running low" twice, byte-identical apart from "2h
   * ahead" / "1h ahead" three lines into the body. Defaults to `id`, so every
   * other alert behaves exactly as before.
   */
  findingId?: string;
  category: AlertCategory;
  title: string;
  body: string;
  /** When it should fire. */
  fireAtIso: string;
  /** Weekly-repeating (a recurring window) vs one-off. */
  repeatsWeekly: boolean;
  /**
   * A fixed weekly slot, for things that belong to a weekday rather than to a
   * moment — the morning report being the case this exists for.
   *
   * `weekday` is 0-6 with Sunday = 0, matching Date.getDay(). The notification
   * plugin's Weekday enum is 1-7 with Sunday = 1, and the +1 is applied at the
   * scheduling boundary rather than here, so every weekday number inside this
   * codebase means the same thing.
   */
  weeklyOn?: { weekday: number; hour: number; minute: number };
  /** In-app path a tap on the notification (or its inbox row) opens. */
  route?: string;
};

/** When the morning report lands, unless the user moves it. */
export const DEFAULT_REPORT_TIME = { hour: 7, minute: 0 };

/** Lead times ahead of a risk window, in hours. */
export const RISK_LEAD_HOURS = [2, 1];

/** Hour of the evening the overnight-drift heads-up lands. */
const OVERNIGHT_ALERT_HOUR = 21;

/** Hours without fresh glucose before the stream counts as quiet. */
const DATA_QUIET_HOURS = 6;

/**
 * Next time `weekday`/`hour` comes around, minus `leadHours`.
 *
 * Computed from the WINDOW, then shifted back — computing the lead time first
 * and searching forward would drift across a DST boundary.
 */
export function nextOccurrence(
  weekday: number | null,
  hour: number,
  leadHours: number,
  now: Date,
): Date {
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setHours(hour, 0, 0, 0);
    if (weekday != null && candidate.getDay() !== weekday) continue;
    const fireAt = new Date(candidate.getTime() - leadHours * 3600_000);
    if (fireAt.getTime() > now.getTime()) return fireAt;
  }
  // Everything this week is behind us: fall through to next week's slot.
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(hour, 0, 0, 0);
  return new Date(fallback.getTime() - leadHours * 3600_000);
}

/** A signal whose confidence is tracked between refreshes. */
export type ConfidenceSignal = {
  id: string;
  label: string;
  /** True once the signal carries a reading worth showing. */
  readable: boolean;
  /** One line describing what became readable. */
  detail: string;
};

/**
 * Everything currently worth tracking for a confidence transition.
 *
 * Kept as one list so "a new trend reached confidence" means the same thing
 * whichever engine produced it.
 */
export function collectConfidenceSignals(input: {
  settings: SettingsReview | null;
  absorption: AbsorptionInsights | null;
  riskWindows: RiskWindow[];
}): ConfidenceSignal[] {
  const out: ConfidenceSignal[] = [];

  for (const item of input.settings?.items ?? []) {
    out.push({
      id: `setting:${item.id}`,
      label: item.label,
      readable: item.confidence !== 'unusable' && item.reading != null,
      detail: item.reading
        ? `${item.label} now reads ${item.reading} against the ${item.current} on file.`
        : `${item.label} has enough history behind it to read.`,
    });
  }

  for (const preset of input.absorption?.presets ?? []) {
    // Marked-curve groups (🥜/🍲) are individual cases: their id carries the
    // kind so a 12h dessert group never collides with a plain 12h preset.
    // Plain presets keep the old id so existing seen-state is not re-fired —
    // and a snapshot written before modelKind existed reads as plain.
    const marked = preset.modelKind != null && preset.modelKind !== 'piecewise';
    const name = marked
      ? `${preset.presetHours}h ${preset.modelLabel}`
      : `${preset.presetHours}h absorption preset`;
    out.push({
      id: marked
        ? `preset:${preset.presetHours}:${preset.modelKind}`
        : `preset:${preset.presetHours}`,
      label: name,
      readable: preset.verdict !== 'building',
      detail:
        preset.verdict === 'matches'
          ? `Your ${name} now has enough meals behind it, and it fits how those plates absorb.`
          : `Your ${name} now has enough meals behind it — and they ${
              preset.verdict === 'outlasts' ? 'run longer' : 'finish sooner'
            } than it models.`,
    });
  }

  for (const w of input.riskWindows) {
    out.push({
      id: `risk:${w.id}`,
      label: w.label,
      readable: w.confidence === 'good',
      detail: `${w.label} has now repeated in ${w.occurrences} of ${w.weeksObserved} weeks — enough to call it a pattern.`,
    });
  }

  return out;
}

export function buildAlerts(input: {
  riskWindows: RiskWindow[];
  /** Signals that crossed into readable since the last check. */
  newlyReadable: ConfidenceSignal[];
  basal: BasalInsights | null;
  autosens: Autosens | null;
  autotune: AutotuneResult | null;
  /** Newest glucose reading, for the quiet-stream check. */
  latestGlucoseIso: string | null;
  enabled: Record<AlertCategory, boolean>;
  now: Date;
  /** Weekday x hour picture, when the source has computed one. */
  dayHourGrid?: DayHourGrid | null;
  /** Local time the morning report should land. */
  reportAt?: { hour: number; minute: number };
}): PendingAlert[] {
  const alerts: PendingAlert[] = [];
  const { now } = input;
  // Top few only. A scheduler that fires eight times a day trains a person
  // to swipe alerts away, which costs more than the alerts are worth.
  const alertedWindows = input.enabled.risk_window
    ? input.riskWindows.filter((x) => x.confidence === 'good').slice(0, 4)
    : [];

  // ── recurring low / high windows ──
  if (input.enabled.risk_window) {
    for (const w of alertedWindows) {
      for (const lead of RISK_LEAD_HOURS) {
        const fireAt = nextOccurrence(w.weekday, w.startHour, lead, now);
        const span =
          w.endHour - w.startHour === 1
            ? formatHour(w.startHour)
            : `${formatHour(w.startHour)}–${formatHour(w.endHour)}`;
        alerts.push({
          id: `risk_${w.id}_${lead}h`,
          // Both lead times still schedule; only one reaches the inbox.
          findingId: `risk_${w.id}`,
          category: 'risk_window',
          title:
            w.kind === 'low'
              ? `${w.label} has been running low`
              : `${w.label} has been running high`,
          body:
            `${lead}h ahead of ${span}. This stretch has gone ${w.kind} in ${w.occurrences} of the last ${w.weeksObserved} weeks` +
            `${w.kind === 'low' ? `, down to ${w.extremeMgdl} mg/dL` : `, up to ${w.extremeMgdl} mg/dL`}. ` +
            `A heads-up, not a recommendation — what to do about it is yours and your care team's.`,
          fireAtIso: fireAt.toISOString(),
          repeatsWeekly: w.weekday != null,
          // An every-day window opens on whichever day it is about to happen.
          route: weekdayPatternPath({
            weekday: w.weekday ?? new Date(fireAt.getTime() + lead * 3600_000).getDay(),
            startHour: w.startHour,
            endHour: Math.max(w.startHour, w.endHour - 1),
          }),
        });
      }
    }
  }

  // ── heads-up before a usual low or high ──
  // Weekly slots like the morning report, from the same grid. A stretch the
  // recurring-window alerts already announce is left to them, so one low
  // never arrives as two notifications.
  if (input.enabled.trend_heads_up && input.dayHourGrid) {
    for (const h of buildHeadsUps({ grid: input.dayHourGrid, alreadyAlerted: alertedWindows })) {
      alerts.push({
        id: `heads_up:${h.kind}:${h.weekday}:${h.startHour}`,
        category: 'trend_heads_up',
        title: h.title,
        body: h.body,
        // Nominal only; weeklyOn is what actually schedules it.
        fireAtIso: now.toISOString(),
        repeatsWeekly: true,
        weeklyOn: h.fireOn,
        route: weekdayPatternPath({ weekday: h.weekday, startHour: h.startHour, endHour: h.endHour }),
      });
    }
  }

  // ── a reading became trustworthy ──
  if (input.enabled.trend_confidence) {
    for (const signal of input.newlyReadable) {
      alerts.push({
        id: `confidence_${signal.id}`,
        category: 'trend_confidence',
        title: 'New trend confidence reached',
        body: `${signal.detail} Worth a look in LoopStack when you have a moment.`,
        fireAtIso: new Date(now.getTime() + 60_000).toISOString(),
        repeatsWeekly: false,
      });
    }
  }

  // ── overnight drift ──
  if (input.enabled.overnight_drift && input.basal) {
    const overnight = input.basal.blocks.find((b) => b.label === 'Overnight');
    if (
      overnight &&
      (overnight.verdict === 'drifts_up' || overnight.verdict === 'drifts_down') &&
      overnight.consistencyPct >= 60
    ) {
      const dir = overnight.verdict === 'drifts_up' ? 'rose' : 'fell';
      alerts.push({
        id: `overnight_${overnight.verdict}`,
        category: 'overnight_drift',
        title: `Overnight has been drifting ${overnight.verdict === 'drifts_up' ? 'up' : 'down'}`,
        body:
          `Across ${overnight.windowCount} quiet nights, glucose ${dir} about ` +
          `${Math.abs(Math.round(overnight.avgDriftPerHour))} mg/dL an hour with no food or bolus in play ` +
          `(${overnight.consistencyPct}% drifted the same way). Worth reviewing with your care team.`,
        fireAtIso: nextOccurrence(null, OVERNIGHT_ALERT_HOUR, 0, now).toISOString(),
        repeatsWeekly: false,
      });
    }
  }

  // ── sensitivity shift ──
  if (input.enabled.sensitivity_shift && input.autosens) {
    const a = input.autosens;
    if ((a.verdict === 'sensitive' || a.verdict === 'resistant') && !a.clamped) {
      const pct = Math.abs(Math.round((a.ratio - 1) * 100));
      alerts.push({
        id: `autosens_${a.verdict}`,
        category: 'sensitivity_shift',
        title:
          a.verdict === 'sensitive'
            ? 'Running more sensitive than usual'
            : 'Running more resistant than usual',
        body:
          `Over the last ${Math.round(a.hoursAnalysed)}h, insulin has been doing about ${pct}% ` +
          `${a.verdict === 'sensitive' ? 'more' : 'less'} than your settings expect across food-free stretches. ` +
          `Loop already accounts for this on its own — flagging it as context for the day.`,
        fireAtIso: new Date(now.getTime() + 60_000).toISOString(),
        repeatsWeekly: false,
      });
    }
  }

  // ── data health ──
  if (input.enabled.data_health) {
    const latest = input.latestGlucoseIso ? new Date(input.latestGlucoseIso).getTime() : null;
    const hoursSince = latest != null ? (now.getTime() - latest) / 3600_000 : null;

    if (hoursSince == null || hoursSince >= DATA_QUIET_HOURS) {
      alerts.push({
        id: 'data_quiet',
        category: 'data_health',
        title: 'LoopStack has stopped receiving glucose',
        body:
          hoursSince == null
            ? 'No glucose readings have arrived at all. Every trend and window in the app is stale until the connection is working again.'
            : `No new readings for about ${Math.round(hoursSince)}h. Trends and upcoming-window alerts are stale until this reconnects.`,
        fireAtIso: new Date(now.getTime() + 60_000).toISOString(),
        repeatsWeekly: false,
      });
    }

    const agreement = input.autotune?.iobAgreement;
    if (agreement && !agreement.trustworthy && agreement.biasU < 0) {
      alerts.push({
        id: 'data_iob_gap',
        category: 'data_health',
        title: 'Insulin records look incomplete',
        body:
          `The insulin history reaching LoopStack runs about ${Math.abs(agreement.biasU).toFixed(1)}U below ` +
          `Loop's own figure across ${agreement.sampleCount} checks — usually temp basals not uploading. ` +
          `Readings built on it are marked accordingly.`,
        fireAtIso: new Date(now.getTime() + 60_000).toISOString(),
        repeatsWeekly: false,
      });
    }
  }

  // ── the morning report ────────────────────────────────────────────────────
  //
  // One weekly slot per weekday that actually has something to say. A day whose
  // shape is unremarkable schedules nothing at all: a report that arrives every
  // morning saying "nothing to report" is a notification the user learns to
  // swipe away, and it takes the useful ones with it.
  //
  // These carry weeklyOn rather than a fire time — the OS owns the recurrence,
  // which is what lets the report arrive on a Tuesday the app has not been
  // opened for.
  if (input.enabled.day_report && input.dayHourGrid) {
    const at = input.reportAt ?? DEFAULT_REPORT_TIME;
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const report = buildDayReport(input.dayHourGrid, weekday);
      if (report.building || report.signals.length === 0) continue;
      alerts.push({
        id: `day_report:${weekday}`,
        category: 'day_report',
        title: `${report.label}s usually`,
        body: reportNotificationBody(report),
        // Nominal only; weeklyOn is what actually schedules it.
        fireAtIso: now.toISOString(),
        repeatsWeekly: true,
        weeklyOn: { weekday, hour: at.hour, minute: at.minute },
        route: weekdayPatternPath({ weekday }),
      });
    }
  }

  return alerts;
}
