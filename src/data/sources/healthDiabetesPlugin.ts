import { registerPlugin } from '@capacitor/core';

// TS wrapper around the in-app HealthDiabetesPlugin (ios/App/App/
// HealthDiabetesPlugin.{swift,m}). Mirrors the Capacitor plugin pattern.
//
// On iOS this resolves to the native bridge; on web it resolves to a no-op
// stub that throws — callers should branch on Capacitor.getPlatform() before
// invoking, the way HealthKitDataSource already does.

export type InsulinDeliveryReason = 'bolus' | 'basal' | 'unknown';

export type InsulinSample = {
  /** ISO start timestamp. */
  iso: string;
  /** ISO end timestamp (== iso for instantaneous bolus). */
  endIso: string;
  /** International units. */
  units: number;
  /** Loop tags boluses; basal-temp events come tagged "basal"; raw entries unknown. */
  reason: InsulinDeliveryReason;
  /** App that wrote the sample (e.g. "Loop"). */
  sourceName: string;
  /** HealthKit UUID. */
  uuid: string;
};

export type CarbSample = {
  iso: string;
  endIso: string;
  /** Grams of carbohydrate. */
  grams: number;
  sourceName: string;
  uuid: string;
  /** Optional human-readable food label (HKMetadataKeyFoodType). */
  label?: string;
  /** Loop's stored absorption time in hours, when present. */
  absorptionHours?: number;
};

export type ReadOptions = {
  /** ISO; defaults to now − 24h. */
  startDate?: string;
  /** ISO; defaults to now. */
  endDate?: string;
  /** Defaults to 500. */
  limit?: number;
};

/** Daily insulin totals, split by delivery reason, bucketed natively so only
 *  ~N day-rows cross the bridge instead of thousands of basal micro-samples. */
export type InsulinDayBucket = {
  dayIso: string;
  basal: number;
  bolus: number;
};

export interface HealthDiabetesPluginType {
  isAvailable(): Promise<{ available: boolean }>;
  /** Triggers iOS permission sheet on first call. iOS hides grant/deny state. */
  requestAuthorization(): Promise<{ requested: boolean }>;
  readInsulin(options?: ReadOptions): Promise<{ samples: InsulinSample[] }>;
  readCarbs(options?: ReadOptions): Promise<{ samples: CarbSample[] }>;
  /** Bolus-only read — filters on delivery-reason metadata natively, since
   *  Loop writes a temp-basal sample every few minutes. */
  readBoluses(options?: ReadOptions): Promise<{ samples: InsulinSample[] }>;
  aggregateInsulinByDay(options?: ReadOptions): Promise<{ days: InsulinDayBucket[] }>;
}

export const HealthDiabetes = registerPlugin<HealthDiabetesPluginType>(
  'HealthDiabetes',
);
