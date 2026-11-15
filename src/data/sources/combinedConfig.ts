// Which upstream owns insulin when both Apple Health and Nightscout are on.
//
// Loop writes the same bolus to BOTH: to Apple Health via HealthKit, and to
// Nightscout via its uploader. Summing the two streams would double every unit
// of insulin — and the existing dedupe helper cannot save us, because it
// matches on amount within 60 seconds while HealthKit stamps the pump-event
// time and Nightscout often stamps the upload time. The copies drift apart and
// slip straight through.
//
// So insulin has exactly one owner, chosen here. The trade-off:
//   • Apple Health carries delivered temp basals, so it can answer
//     "scheduled vs delivered" and the observed-carb-ratio figures.
//   • Nightscout is bolus-only in this build, but does not depend on Loop's
//     HealthKit sharing being switched on.

export type InsulinOwner = 'healthkit' | 'nightscout';

const KEY = 'loopstack:combined:insulinOwner:v1';

export const DEFAULT_INSULIN_OWNER: InsulinOwner = 'healthkit';

export function loadInsulinOwner(): InsulinOwner {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'nightscout' || raw === 'healthkit' ? raw : DEFAULT_INSULIN_OWNER;
  } catch {
    return DEFAULT_INSULIN_OWNER;
  }
}

export function saveInsulinOwner(owner: InsulinOwner): void {
  try {
    localStorage.setItem(KEY, owner);
  } catch {
    // storage unavailable — session-only
  }
}
