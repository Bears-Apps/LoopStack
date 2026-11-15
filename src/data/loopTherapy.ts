// Sample Loop therapy settings: a made-up, typical adult schedule, used as
// LoopStack's defaults when your own data doesn't say (for example, the
// glucose safety limit, which Nightscout doesn't carry). They are NOT a
// recommendation: everyone's settings are different, and yours come from your
// own Loop and your care team.
//
// Schedules change by time of day, so a value only applies from its start
// until the next entry. Nothing here is written back to Loop.
//
// Times are minutes from local midnight. Each entry applies from its start
// until the next entry; the schedule is cyclic over 24h.

export type ScheduleEntry = { startMinutes: number; value: number };
export type RangeEntry = { startMinutes: number; low: number; high: number };

export type LoopTherapy = {
  /** Loop delivers insulin only if glucose is predicted above this. */
  glucoseSafetyLimitMgdl: number;
  /** The range Loop aims for (distinct from the dashboard's in-range target). */
  correctionRange: RangeEntry[];
  preMealRange: { low: number; high: number };
  /** g of carb per 1U. */
  carbRatioSchedule: ScheduleEntry[];
  /** U per hour of background insulin. */
  basalSchedule: ScheduleEntry[];
  /** mg/dL drop expected per 1U. */
  insulinSensitivitySchedule: ScheduleEntry[];
  maxBasalRate: number;
  maxBolus: number;
  insulinDurationHours: number;
  /** When these values were transcribed. */
  capturedIso: string;
};

const H = (h: number, m = 0) => h * 60 + m;

export const realLoopTherapy: LoopTherapy = {
  glucoseSafetyLimitMgdl: 80,

  correctionRange: [
    { startMinutes: H(0), low: 100, high: 110 },
    { startMinutes: H(7), low: 100, high: 115 },
    { startMinutes: H(22), low: 105, high: 115 },
  ],

  preMealRange: { low: 85, high: 95 },

  carbRatioSchedule: [
    { startMinutes: H(0), value: 12 },
    { startMinutes: H(11), value: 13 },
    { startMinutes: H(17), value: 12 },
  ],

  basalSchedule: [
    { startMinutes: H(0), value: 0.85 },
    { startMinutes: H(3), value: 0.95 },
    { startMinutes: H(7), value: 0.8 },
    { startMinutes: H(12), value: 0.7 },
    { startMinutes: H(17), value: 0.8 },
    { startMinutes: H(21), value: 0.9 },
  ],

  insulinSensitivitySchedule: [
    { startMinutes: H(0), value: 50 },
    { startMinutes: H(6), value: 45 },
    { startMinutes: H(12), value: 55 },
    { startMinutes: H(18), value: 50 },
  ],

  maxBasalRate: 3,
  maxBolus: 8,
  insulinDurationHours: 6,
  capturedIso: '2026-01-01T12:00:00Z',
};

/** Minutes from local midnight for a Date. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Value that applies at `minutes`. Entries are cyclic: a time before the first
 * entry falls under the last entry of the day (standard pump behaviour). Loop's
 * schedules always start at 00:00, so in practice the wrap never fires, but it
 * keeps the resolver correct for any schedule.
 */
export function valueAt(schedule: ScheduleEntry[], minutes: number): number {
  if (schedule.length === 0) return 0;
  let current = schedule[schedule.length - 1].value; // wrap default
  for (const entry of schedule) {
    if (minutes >= entry.startMinutes) current = entry.value;
    else break;
  }
  return current;
}

/** Correction range that applies at `minutes`. */
export function rangeAt(schedule: RangeEntry[], minutes: number): { low: number; high: number } {
  if (schedule.length === 0) return { low: 0, high: 0 };
  let current = schedule[schedule.length - 1];
  for (const entry of schedule) {
    if (minutes >= entry.startMinutes) current = entry;
    else break;
  }
  return { low: current.low, high: current.high };
}

/** Carb ratio (g/U) at a given time — what a dose calculated then should use. */
export function carbRatioAt(therapy: LoopTherapy, date: Date): number {
  return valueAt(therapy.carbRatioSchedule, minutesOfDay(date));
}

/** Insulin sensitivity (mg/dL per U) at a given time. */
export function isfAt(therapy: LoopTherapy, date: Date): number {
  return valueAt(therapy.insulinSensitivitySchedule, minutesOfDay(date));
}

/** Scheduled basal rate (U/hr) at a given time — the rate a temp basal sits on
 *  top of. A temp basal suggestion is stated as an absolute rate, so it is
 *  meaningless without the scheduled value underneath it. */
export function basalRateAt(therapy: LoopTherapy, date: Date): number {
  return valueAt(therapy.basalSchedule, minutesOfDay(date));
}

/** Total daily basal, integrating the schedule over 24h. */
export function dailyBasalTotal(therapy: LoopTherapy): number {
  const s = therapy.basalSchedule;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const start = s[i].startMinutes;
    const end = i + 1 < s.length ? s[i + 1].startMinutes : 24 * 60;
    total += (s[i].value * (end - start)) / 60;
  }
  return +total.toFixed(2);
}

/** Format minutes-from-midnight as a 12-hour clock label ("3:30 PM"). */
export function formatScheduleTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}
