import { createHealthKitDataSource } from './healthKitDataSource';
import { createNightscoutDataSource } from './nightscoutDataSource';
import { createCombinedDataSource } from './combinedDataSource';
import { createMockDataSource } from './mockDataSource';
import type { DataSource, DataSourceKind } from './types';

// Source registry. Each kind maps to a factory; the active source is built
// once per app session and held by the DataSourceProvider. Adding a new
// source = drop in a factory + extend the switch.

export type DataSourceFactory = () => DataSource;

const factories: Record<DataSourceKind, DataSourceFactory | null> = {
  mock: createMockDataSource,
  healthkit: createHealthKitDataSource,
  nightscout: createNightscoutDataSource,
  combined: createCombinedDataSource,
};

/** Build a data source for the requested kind, falling back to mock. */
export function buildDataSource(kind: DataSourceKind): DataSource {
  const factory = factories[kind];
  if (!factory) {
    // Real source not yet implemented — fall back to mock so the UI still
    // renders. The picker will note "coming soon" so the user knows why.
    return createMockDataSource();
  }
  return factory();
}

/** Which kinds have a real implementation right now? */
export function isImplemented(kind: DataSourceKind): boolean {
  return factories[kind] != null;
}
