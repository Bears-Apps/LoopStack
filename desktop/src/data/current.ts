// The active dataset. Every view imports its numbers from here; the values are
// ES module live bindings, so useDataset() swaps them all at once and the app
// remounts (main.tsx keys the tree on the dataset version). Starts on the
// synthetic patient; the desktop app switches to Nightscout once connected.
import type { Dataset } from './dataset';
import { SYNTHETIC } from './synthetic';

export type { Dataset, DailyGlucose, Day, HourState, ListedPatient, Pt, SettingsChange } from './dataset';

let D: Dataset = SYNTHETIC;
export let DATA: Dataset = D;
export let DAYS = D.DAYS;
export let PERIOD = D.PERIOD;
export let EXCLUDED = D.EXCLUDED;
export let NOT_COUNTED = D.NOT_COUNTED;
export let NOT_COUNTED_CAUSE = D.NOT_COUNTED_CAUSE;
export let RUN_DAYS = D.RUN_DAYS;
export let RUN_TIME = D.RUN_TIME;
export let SCHED = D.SCHED;
export let LOOP = D.LOOP;
export let STATE = D.STATE;
export let RATE = D.RATE;
export let AUTO_BOLUS = D.AUTO_BOLUS;
export let SCHED_EFF = D.SCHED_EFF;
export let OVERRIDE_HOURS = D.OVERRIDE_HOURS;
export let G6 = D.G6;
export let HOURLY_G = D.HOURLY_G;
export let PATIENT = D.PATIENT;
export let CGM_NOW = D.CGM_NOW;
export let HEADS_UP = D.HEADS_UP;
export let AVG_DAY = D.AVG_DAY;
export let CARE_NOTE = D.CARE_NOTE;
export let LUNCH = D.LUNCH;
export let READ = D.READ;
export let AGP = D.AGP;
export let INSULIN = D.INSULIN;
export let DAY = D.DAY;
export let CHANGES = D.CHANGES;
export let QUESTION = D.QUESTION;
export let PATIENTS = D.PATIENTS;
export let TEXT = D.TEXT;
export let DAY_BY_WEEKDAY = D.DAY_BY_WEEKDAY;
export let MEALS = D.MEALS;
export let DAILY = D.DAILY;
export let SUGGESTIONS = D.SUGGESTIONS;
/** Days that count: every day not excluded. */
export let USABLE: readonly string[] = DAYS.filter((d) => !EXCLUDED.includes(d));
export let USABLE_N = USABLE.length;

const listeners = new Set<() => void>();

export function useDataset(next: Dataset): void {
  D = next;
  DATA = D; DAYS = D.DAYS; PERIOD = D.PERIOD; EXCLUDED = D.EXCLUDED; NOT_COUNTED = D.NOT_COUNTED;
  NOT_COUNTED_CAUSE = D.NOT_COUNTED_CAUSE; RUN_DAYS = D.RUN_DAYS; RUN_TIME = D.RUN_TIME; SCHED = D.SCHED;
  LOOP = D.LOOP; STATE = D.STATE; RATE = D.RATE; AUTO_BOLUS = D.AUTO_BOLUS; SCHED_EFF = D.SCHED_EFF; OVERRIDE_HOURS = D.OVERRIDE_HOURS; G6 = D.G6; HOURLY_G = D.HOURLY_G; PATIENT = D.PATIENT; CGM_NOW = D.CGM_NOW;
  HEADS_UP = D.HEADS_UP; AVG_DAY = D.AVG_DAY; CARE_NOTE = D.CARE_NOTE; LUNCH = D.LUNCH; READ = D.READ;
  AGP = D.AGP; INSULIN = D.INSULIN; DAY = D.DAY; CHANGES = D.CHANGES; QUESTION = D.QUESTION;
  PATIENTS = D.PATIENTS; TEXT = D.TEXT; DAY_BY_WEEKDAY = D.DAY_BY_WEEKDAY; MEALS = D.MEALS; DAILY = D.DAILY; SUGGESTIONS = D.SUGGESTIONS;
  USABLE = DAYS.filter((d) => !EXCLUDED.includes(d));
  USABLE_N = USABLE.length;
  for (const l of listeners) l();
}

export function onDatasetChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
