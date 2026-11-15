import type { CarbEntry, GlucoseReading, InsulinEvent } from '@/data/sources/types';
import type { LoopTherapy } from '@/data/loopTherapy';
import type { TargetRange } from '@/lib/metrics/computeMetrics';
import { computeHypoReports } from '@/lib/metrics/hypoEvents';
import { computeAgpProfiles } from '@/lib/metrics/agp';
import { computeMealPanels } from '@/lib/metrics/mealPanels';
import { computeCorrectionOutcomes } from '@/lib/metrics/correctionOutcomes';
import { computeTempBasalUse } from '@/lib/metrics/tempBasalUse';

// The clinic report's raw-history metrics, computed together from one
// source's long reads so every source runs them the same way. Each source
// passes its own streams and the window its carbs and insulin actually span;
// the glucose views are computed for every report period from the 180-day
// glucose read.

export function computeClinicianMetrics(input: {
  glucose: GlucoseReading[];
  carbs: CarbEntry[];
  /** Boluses, plus temp basals where the source has them. */
  insulin: InsulinEvent[];
  therapy: LoopTherapy;
  /** The user's own bands — the home screen's thresholds. */
  target: TargetRange;
  now: Date;
  /** How far back the source's carb and insulin reads go. */
  treatmentWindowDays: number;
}) {
  const { glucose, carbs, insulin, therapy, target, now, treatmentWindowDays: windowDays } = input;
  return {
    hypoEvents: computeHypoReports({ glucose, target, now }),
    agp: computeAgpProfiles({ glucose, now }),
    mealPanels: computeMealPanels({ glucose, carbs, insulin, now, windowDays }),
    correctionOutcomes: computeCorrectionOutcomes({ glucose, carbs, insulin, therapy, lowMgdl: target.lowMgdl, now, windowDays }),
    tempBasalUse: computeTempBasalUse({ insulin, maxBasalRate: therapy.maxBasalRate, now, windowDays }),
  };
}
