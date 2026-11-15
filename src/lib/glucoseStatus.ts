import { loadTargetRange } from '@/data/loopTherapyStore';

// Glucose status + trend classification.
//
// Thresholds are personal-tool defaults (see screen-1 annotations) and tuned
// for a Type 1 user on Loop, not generalized clinical guidance. Adjust the
// constants below if you want different alerting envelopes.

export type GlucoseStatus =
  | 'urgent_high'      // above the configured high bound, not falling fast → red
  | 'high_falling'     // above the high bound but already coming down → amber
  | 'elevated_rising'  // inside the band, climbing fast → yellow
  | 'in_range'         // green / neutral
  | 'low';             // below the configured low bound → red-low

export type GlucoseTrendKind =
  | 'rising_aggressively'
  | 'rising_semi_aggressively'
  | 'rising_slowly'
  | 'steady'
  | 'falling_slowly'
  | 'falling_semi_aggressively'
  | 'falling_aggressively';

export type CurrentGlucose = {
  mgdl: number;
  ratePer5min: number;   // mg/dL per 5 minutes (signed)
  ratePer20min: number;  // mg/dL per 20 minutes (signed)
  lastUpdatedIso: string;
};

// Thresholds come from the user's own configured band, not from constants.
//
// These were hardcoded at 120/100/70, which had two consequences. A reading of
// 121 — a value Loop is actively targeting on Ryan's 110–130 correction range —
// classified as `urgent_high` and painted the hero red. And 70 disagreed with
// the 65 the same user set as their in-range floor, so a 67 turned the hero
// red-low while the time-in-range bar counted it as in range: two surfaces on
// one screen disagreeing about what a low is.
//
// Reading the band means the hero and every percentage on the screen are
// scored against the same numbers.
function bounds() {
  const t = loadTargetRange();
  return {
    high: t.highMgdl,
    low: t.lowMgdl,
    // "Elevated" is the upper third of the band — climbing here is worth
    // noticing before it leaves the band, without being a high in itself.
    elevated: t.lowMgdl + (t.highMgdl - t.lowMgdl) * 0.66,
  };
}

// Threshold for the "falling fast enough to not flag" carve-out on highs.
const RAPID_FALL_PER_20MIN = -8;

// Trend rate classification (mg/dL per 5 min).
const RATE_AGGRESSIVE = 6;
const RATE_SEMI_AGGRESSIVE = 3;
const RATE_SLOW = 1;

export function classifyGlucose(g: CurrentGlucose): GlucoseStatus {
  const b = bounds();
  if (g.mgdl < b.low) return 'low';
  if (g.mgdl > b.high) {
    // Don't pin red while a correction is visibly landing — but don't call it
    // "in range" either. This branch used to return 'in_range', so 300 mg/dL
    // drifting down 9 points per 20 min rendered with the green treatment and
    // the advisory "In range and trending steady. Standard meal strategy is
    // fine." A carve-out about URGENCY was implemented as a claim about the
    // NUMBER, and 300 is not in range under any definition this app uses.
    if (g.ratePer20min < RAPID_FALL_PER_20MIN) return 'high_falling';
    return 'urgent_high';
  }
  if (g.mgdl > b.elevated && g.ratePer5min > 4) return 'elevated_rising';
  return 'in_range';
}

export function classifyTrend(ratePer5min: number): GlucoseTrendKind {
  if (ratePer5min >= RATE_AGGRESSIVE) return 'rising_aggressively';
  if (ratePer5min >= RATE_SEMI_AGGRESSIVE) return 'rising_semi_aggressively';
  if (ratePer5min >= RATE_SLOW) return 'rising_slowly';
  if (ratePer5min <= -RATE_AGGRESSIVE) return 'falling_aggressively';
  if (ratePer5min <= -RATE_SEMI_AGGRESSIVE) return 'falling_semi_aggressively';
  if (ratePer5min <= -RATE_SLOW) return 'falling_slowly';
  return 'steady';
}

export const trendLabel: Record<GlucoseTrendKind, string> = {
  rising_aggressively: 'Rising aggressively',
  rising_semi_aggressively: 'Rising semi-aggressively',
  rising_slowly: 'Rising slowly',
  steady: 'Steady',
  falling_slowly: 'Falling slowly',
  falling_semi_aggressively: 'Falling semi-aggressively',
  falling_aggressively: 'Falling aggressively',
};

export const trendArrow: Record<GlucoseTrendKind, string> = {
  rising_aggressively: '↑',
  rising_semi_aggressively: '↗',
  rising_slowly: '↗',
  steady: '→',
  falling_slowly: '↘',
  falling_semi_aggressively: '↘',
  falling_aggressively: '↓',
};

// Short, mobile-friendly advisory copy keyed off status × trend. Personal-tool
// framing — phrased as a suggestion, not medical instruction.
export function glucoseAdvisory(g: CurrentGlucose): string {
  const status = classifyGlucose(g);
  const trend = classifyTrend(g.ratePer5min);

  if (status === 'low') {
    // No carb amount and no insulin instruction: naming a gram count is a
    // dosing command, and the person treating a low already knows their plan.
    // State the condition and its bearing on new insulin; leave treatment to
    // them and their care team.
    return 'Glucose is low. Treat it the way you normally do — and note that any insulin decided on now stacks on top of what is already working.';
  }

  // Everything below states what the glucose is doing and what that tends to
  // mean for a meal. None of it tells the reader what to do with insulin.
  //
  // The previous copy did both of the things this app exists not to do. It
  // issued timing instructions off a live reading — "a small pre-bolus 15–20
  // min ahead", "Hold any pre-bolus" — which is an insulin-administration
  // instruction with a dose-magnitude qualifier, banned by principles #5. And
  // it justified them with "have matched better outcomes in patterns like
  // this", an empirical claim this function cannot possibly support: its only
  // argument is the current reading. No history, no outcomes, no patterns.
  // Fabricating evidence to justify dosing advice is the worst combination
  // available, and it shipped on the home screen above everything else.
  //
  // The low branch above was always right. These now match it.
  if (status === 'urgent_high') {
    const risingHard =
      trend === 'rising_aggressively' || trend === 'rising_semi_aggressively';
    if (risingHard) {
      return 'Glucose is above your range and still climbing. Meals started from a rising line tend to peak higher and later than the same meal from flat.';
    }
    return 'Glucose is above your range. Whatever is already active is still working — the Insulin timing card shows what has gone in today.';
  }

  if (status === 'high_falling') {
    return 'Above your range but coming down. The fall is steep enough that insulin already delivered is still acting.';
  }

  if (status === 'elevated_rising') {
    return 'Near the top of your range and rising. This is the shape that usually precedes leaving the range.';
  }

  if (trend === 'rising_semi_aggressively' || trend === 'rising_aggressively') {
    return 'Rising faster than usual. A meal landing on a climb absorbs onto a moving line, which is what makes those meals read differently afterwards.';
  }

  if (trend === 'falling_semi_aggressively' || trend === 'falling_aggressively') {
    return 'Falling quickly. Insulin already delivered is still acting, so the line has further to travel than the current number suggests.';
  }

  return 'In range and steady. Nothing in the recent readings stands out.';
}
