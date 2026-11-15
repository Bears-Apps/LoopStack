import type { ClinicalSettings } from './types';

// Your Loop therapy settings, editable in-app and persisted on device.
//
// These used to be read-only, on the reasoning that Loop owns them and the
// screenshot-upload pipeline would eventually read them for you. That pipeline
// is not built, so the values were stuck at whatever the sample profile said
// and every suggestion computed against a target range that was not yours.
//
// LoopStack still never writes to Loop. What is stored here is LoopStack's
// record of what Loop is running — the reference its own suggestions are
// measured against. Editing it changes what LoopStack expects, not what your
// pump does; the Fix Log remains the only path to an actual therapy change.

const STORAGE_KEY = 'loopstack.loopTherapy.v1';

/** The fields you can set by hand. Observed values stay derived from data. */
export type EditableTherapy = Pick<
  ClinicalSettings,
  | 'urgentLowMgdl'
  | 'targetLowMgdl'
  | 'targetHighMgdl'
  | 'baseIsf'
  | 'carbRatio'
  | 'insulinDurationHours'
>;

export type TherapyField = keyof EditableTherapy;

/** Accepted ranges. Wide enough to fit real Loop configurations, tight enough
 *  to catch a fat-fingered entry before it reaches the suggestion engine. */
export const therapyLimits: Record<
  TherapyField,
  { min: number; max: number; step: number; unit: string; label: string }
> = {
  urgentLowMgdl: { min: 40, max: 80, step: 1, unit: 'mg/dL', label: 'Urgent low below' },
  targetLowMgdl: { min: 55, max: 180, step: 1, unit: 'mg/dL', label: 'Target low' },
  targetHighMgdl: { min: 80, max: 300, step: 1, unit: 'mg/dL', label: 'Target high' },
  baseIsf: { min: 5, max: 300, step: 1, unit: 'mg/dL per 1U', label: 'Base ISF' },
  carbRatio: { min: 1, max: 60, step: 0.5, unit: 'g per 1U', label: 'Carb ratio' },
  insulinDurationHours: { min: 2, max: 12, step: 0.5, unit: 'h', label: 'Insulin duration' },
};

/** Minimum width of the target range, in mg/dL. */
const MIN_TARGET_SPREAD = 10;

export type ValidationResult = { ok: true } | { ok: false; message: string };

/** Check one edited field against its limits and against the other values. */
export function validateTherapy(
  next: EditableTherapy,
  field: TherapyField,
): ValidationResult {
  const limit = therapyLimits[field];
  const value = next[field];

  if (!Number.isFinite(value)) {
    return { ok: false, message: `${limit.label} needs a number.` };
  }
  if (value < limit.min || value > limit.max) {
    return {
      ok: false,
      message: `${limit.label} must be between ${limit.min} and ${limit.max} ${limit.unit}.`,
    };
  }
  // The range is the one place two fields constrain each other, and an inverted
  // or hairline range would quietly break every in-range calculation.
  if (field === 'targetLowMgdl' || field === 'targetHighMgdl') {
    if (next.targetHighMgdl - next.targetLowMgdl < MIN_TARGET_SPREAD) {
      return {
        ok: false,
        message: `Target range needs at least ${MIN_TARGET_SPREAD} mg/dL between low and high.`,
      };
    }
  }
  // Urgent-low must sit below target-low, or the "low" band has no width and
  // every reading below target would be counted as urgent.
  if (field === 'urgentLowMgdl' || field === 'targetLowMgdl') {
    if (next.urgentLowMgdl >= next.targetLowMgdl) {
      return {
        ok: false,
        message: 'Urgent low must sit below target low — otherwise there is no "low" band between them.',
      };
    }
  }
  return { ok: true };
}

function isTherapyShape(v: unknown): v is EditableTherapy {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (Object.keys(therapyLimits) as TherapyField[]).every(
    (k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number),
  );
}

/**
 * Fill in fields added after a save was written.
 *
 * `urgentLowMgdl` did not exist when earlier builds stored therapy, so a device
 * carrying one of those saves would fail the shape check and lose every edit —
 * ISF, carb ratio, duration — over one missing key. Backfilling from the
 * defaults keeps those edits and adopts the new band.
 */
function migrateTherapy(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.urgentLowMgdl === 'number') return o;
  return { ...o, urgentLowMgdl: DEFAULT_TARGET_RANGE.urgentLowMgdl };
}

/** Stored overrides, or null when nothing has been entered yet. */
export function loadTherapyOverrides(): EditableTherapy | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = migrateTherapy(JSON.parse(raw));
    return isTherapyShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTherapyOverrides(next: EditableTherapy): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the edit still applies for this session.
  }
}

export function clearTherapyOverrides(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Merge stored overrides over the profile defaults. */
export function applyTherapyOverrides(
  clinical: ClinicalSettings,
  overrides: EditableTherapy | null = loadTherapyOverrides(),
): ClinicalSettings {
  return overrides ? { ...clinical, ...overrides } : clinical;
}

/** The in-range boundaries the Trends dashboard scores against. */
export type TargetRange = {
  lowMgdl: number;
  highMgdl: number;
  /** Below this counts as urgent low rather than low. */
  urgentLowMgdl?: number;
};

/** The bands every reading is scored against until the user sets their own
 *  under Profile → Targets. Set to Ryan's own
 *  bands — urgent under 60, low 60–65, in range 65–180 — rather than the
 *  consensus 70–180, because these are the numbers he reacts to. */
export const DEFAULT_TARGET_RANGE: TargetRange = {
  lowMgdl: 65,
  highMgdl: 180,
  urgentLowMgdl: 60,
};

/**
 * The target range as the data sources should read it.
 *
 * Sources run outside React, so they read the stored override directly rather
 * than through the Profile screen's state. Profile calls `refresh()` after a
 * save so the dashboard recomputes against the new boundaries.
 */
export function loadTargetRange(): TargetRange {
  const stored = loadTherapyOverrides();
  if (!stored) return DEFAULT_TARGET_RANGE;
  return {
    lowMgdl: stored.targetLowMgdl,
    highMgdl: stored.targetHighMgdl,
    urgentLowMgdl: stored.urgentLowMgdl ?? DEFAULT_TARGET_RANGE.urgentLowMgdl,
  };
}

export function toEditable(clinical: ClinicalSettings): EditableTherapy {
  return {
    urgentLowMgdl: clinical.urgentLowMgdl,
    targetLowMgdl: clinical.targetLowMgdl,
    targetHighMgdl: clinical.targetHighMgdl,
    baseIsf: clinical.baseIsf,
    carbRatio: clinical.carbRatio,
    insulinDurationHours: clinical.insulinDurationHours,
  };
}
