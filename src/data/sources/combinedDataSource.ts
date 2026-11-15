import { createHealthKitDataSource } from './healthKitDataSource';
import { createNightscoutDataSource } from './nightscoutDataSource';
import { loadInsulinOwner, type InsulinOwner } from './combinedConfig';
import type { DataSnapshot, DataSource, DataSubscriber } from './types';
import type { GlucoseMetrics, MetricsRange } from '@/data/types';

// Apple Health + Nightscout together.
//
// Neither source alone covers the picture: Nightscout carries Loop's own
// telemetry — overrides, closed-loop status, the treatment stream — while
// Apple Health is the only place sleep, workouts, steps and heart rate live.
// This source runs both and assigns each field a single owner.
//
// The rule that matters: ONE OWNER PER STREAM, NEVER A UNION. Loop writes the
// same bolus to both back ends, so concatenating them would double every unit
// of insulin and gram of carb. Where both could answer, one is picked (insulin
// by the user, in Settings) and the other is ignored for that field rather
// than merged.
//
// Failure is independent. Each upstream is refreshed with allSettled, so
// Nightscout being unreachable costs you activity-free glucose rather than a
// blank dashboard, and a denied HealthKit permission costs you sleep and steps
// rather than everything.

const ACTIVITY_FIELDS = [
  'recentWorkouts',
  'recentHeartRate',
  'restingHeartRate',
  'activitySummary',
  'weekdayExercise',
] as const;

/** Merge the lifestyle columns HealthKit owns into Nightscout's metrics. */
function mergeMetrics(
  base: Record<MetricsRange, GlucoseMetrics> | null,
  health: Record<MetricsRange, GlucoseMetrics> | null,
  insulinFromHealth: boolean,
): Record<MetricsRange, GlucoseMetrics> | null {
  if (!base) return health;
  if (!health) return base;
  const out = {} as Record<MetricsRange, GlucoseMetrics>;
  for (const range of Object.keys(base) as MetricsRange[]) {
    const b = base[range];
    const h = health[range];
    out[range] = {
      ...b,
      // Sleep, steps and exercise exist only on the HealthKit side.
      steps: h?.steps ?? b.steps,
      exerciseMinutes: h?.exerciseMinutes ?? b.exerciseMinutes,
      sleepHours: h?.sleepHours ?? b.sleepHours,
      // Insulin follows the chosen owner, whole — mixing a HealthKit basal
      // with a Nightscout bolus would be a union by another name.
      //
      // Every read off `h` is optional-chained: a source that returns a partial
      // record for one range must degrade to the other side's figure, not throw
      // on the way to the dashboard and take the whole screen down with it.
      // basalIsScheduled travels WITH the figures it describes. Omitting it
      // left the Nightscout side's flag in place over HealthKit's numbers, so
      // measured delivered basal could be labelled "basal from schedule" — the
      // provenance caveat pointing at the wrong data.
      ...(insulinFromHealth && h
        ? {
            basalInsulin: h.basalInsulin ?? b.basalInsulin,
            bolusInsulin: h.bolusInsulin ?? b.bolusInsulin,
            totalInsulin: h.totalInsulin ?? b.totalInsulin,
            basalIsScheduled: h.basalIsScheduled ?? b.basalIsScheduled,
            deltas: {
              ...b.deltas,
              totalInsulin: h.deltas?.totalInsulin ?? b.deltas.totalInsulin,
            },
          }
        : {}),
    };
  }
  return out;
}

/**
 * Assign every snapshot field to exactly one source.
 *
 * Exported so the one-owner-per-field rule can be tested rather than trusted.
 * The failure this prevents is quiet: Loop writes the same bolus to both back
 * ends, and a field that took `[...ns, ...hk]` would double every unit of
 * insulin and gram of carb without anything looking broken.
 */
export function mergeSnapshots(
  ns: DataSnapshot,
  hk: DataSnapshot,
  owner: InsulinOwner,
): DataSnapshot {
  const insulinFromHealth = owner === 'healthkit';

  return {
    // Nightscout owns the treatment stream and everything derived from it:
    // glucose, carbs, meals, favorites, patterns, trends, and the Loop-status
    // telemetry HealthKit has no equivalent for.
    ...ns,

    // Apple Health owns activity outright — Nightscout carries none of it.
    ...(Object.fromEntries(ACTIVITY_FIELDS.map((f) => [f, hk[f]])) as Pick<
      DataSnapshot,
      (typeof ACTIVITY_FIELDS)[number]
    >),

    // Insulin, by the owner chosen in Settings.
    recentInsulin: insulinFromHealth ? hk.recentInsulin : ns.recentInsulin,
    // Always Nightscout: this is Loop's own published IOB, and HealthKit has no
    // equivalent to fall back to. The insulin-source preference does not apply.
    currentLoopIob: ns.currentLoopIob,
    insulinLedger: insulinFromHealth ? hk.insulinLedger : ns.insulinLedger,
    // Basal insight only means something with delivered basal behind it, so
    // it follows the insulin owner too.
    basalInsights: insulinFromHealth ? hk.basalInsights : ns.basalInsights,
    // Both tuning reads are deviation maths over the insulin stream, so they
    // must come from whichever side owns insulin. Taking glucose from one and
    // insulin from the other would compare a fall against doses that were
    // never in the same ledger.
    autosens: insulinFromHealth ? hk.autosens : ns.autosens,
    autotune: insulinFromHealth ? hk.autotune : ns.autotune,
    absorptionInsights: insulinFromHealth ? hk.absorptionInsights : ns.absorptionInsights,
    settingsReview: insulinFromHealth ? hk.settingsReview : ns.settingsReview,
    // Clinician metrics. Hypo events, the AGP and meal panels are glucose and
    // carb reads, so they stay with Nightscout via the spread above. Correction
    // outcomes net glucose against boluses, so they follow the insulin owner.
    correctionOutcomes: insulinFromHealth ? hk.correctionOutcomes : ns.correctionOutcomes,
    // Temp basals exist only on the Nightscout side; Apple Health's long read
    // is boluses only, so this is Nightscout's whatever the insulin owner.
    tempBasalUse: ns.tempBasalUse,

    metrics: {
      ...ns.metrics,
      data: mergeMetrics(ns.metrics.data, hk.metrics.data, insulinFromHealth),
      // Loading until both have reported; error only when the glucose owner
      // failed, since that is what the dashboard cannot render without.
      loading: ns.metrics.loading || hk.metrics.loading,
      error: ns.metrics.error,
    },
  };
}

export function createCombinedDataSource(): DataSource {
  const nightscout = createNightscoutDataSource();
  // The Nightscout refresh in flight, so Apple Health can wait for its glucose.
  let nightscoutRead: Promise<void> = Promise.resolve();
  // Apple Health does only what the merge keeps from it. Every glucose-only
  // view is taken from Nightscout below, so computing it here was thrown away;
  // and the 180-day glucose read is the same CGM Nightscout already returned,
  // so Apple Health's insulin views are built on Nightscout's copy rather than
  // reading six months across the bridge a second time.
  const health = createHealthKitDataSource({
    glucoseHistory: async () => {
      await nightscoutRead;
      const g = nightscout.getSnapshot().recentGlucose.data;
      return g && g.length ? g : null;
    },
    glucoseViews: false,
    insulinViews: () => loadInsulinOwner() === 'healthkit',
  });
  const listeners = new Set<DataSubscriber>();

  const emit = () => {
    for (const cb of listeners) cb();
  };

  // getSnapshot MUST return a stable reference for unchanged inputs.
  // useSyncExternalStore compares what it gets by identity, so rebuilding the
  // merged object on every call makes React believe the store changed on every
  // render — an infinite loop that surfaces as React error #185 and a dead
  // white screen. So the merge is memoised on the two upstream snapshot
  // references plus the insulin-owner setting; those are exactly the inputs it
  // reads, and each upstream already replaces its snapshot object on change.
  let cached: DataSnapshot | null = null;
  let cachedNs: DataSnapshot | null = null;
  let cachedHk: DataSnapshot | null = null;
  let cachedOwner: InsulinOwner | null = null;

  const merged = (): DataSnapshot => {
    const ns = nightscout.getSnapshot();
    const hk = health.getSnapshot();
    const owner = loadInsulinOwner();
    if (cached && ns === cachedNs && hk === cachedHk && owner === cachedOwner) {
      return cached;
    }
    const out = mergeSnapshots(ns, hk, owner);
    cached = out;
    cachedNs = ns;
    cachedHk = hk;
    cachedOwner = owner;
    return out;
  };

  return {
    kind: 'combined',
    displayName: 'Apple Health + Nightscout',
    getSnapshot: merged,
    subscribe: (cb) => {
      listeners.add(cb);
      const offHealth = health.subscribe(cb);
      const offNs = nightscout.subscribe(cb);
      return () => {
        listeners.delete(cb);
        offHealth();
        offNs();
      };
    },
    refresh: async () => {
      // allSettled: one upstream failing must not prevent the other from
      // reaching the screen.
      nightscoutRead = nightscout.refresh();
      await Promise.allSettled([nightscoutRead, health.refresh()]);
      emit();
    },
    dispose: () => {
      health.dispose?.();
      nightscout.dispose?.();
    },
  };
}
