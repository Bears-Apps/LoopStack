import type { DataSourceKind } from './types';

// Persisted preference for which data source the app uses. Stored separately
// from the source itself so swapping doesn't lose the user's choice.

const STORAGE_KEY = 'loopstack:dataSource:v1';
const DEFAULT_SOURCE: DataSourceKind = 'mock';

const VALID_KINDS: DataSourceKind[] = ['mock', 'healthkit', 'nightscout', 'combined'];

export function getActiveDataSourceKind(): DataSourceKind {
  if (typeof window === 'undefined') return DEFAULT_SOURCE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_KINDS as string[]).includes(raw)) {
      return raw as DataSourceKind;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_SOURCE;
}

export function setActiveDataSourceKind(kind: DataSourceKind): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, kind);
  } catch {
    /* storage unavailable — caller can still mount the source for the
       remainder of this session */
  }
}
