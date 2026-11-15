import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildDataSource } from './registry';
import {
  getActiveDataSourceKind,
  setActiveDataSourceKind,
} from './sourcePreference';
import type { DataSource, DataSourceKind } from './types';

type Ctx = {
  source: DataSource;
  activeKind: DataSourceKind;
  /** Switch the active source. Persists the choice and rebuilds the instance. */
  setActiveKind: (kind: DataSourceKind) => void;
  /** Trigger a manual refresh of the current source. */
  refresh: () => Promise<void>;
};

const DataSourceContext = createContext<Ctx | null>(null);

/**
 * A foreground event this soon after the last refresh started is skipped.
 * Glucose arrives every five minutes; re-reading six months of history because
 * the app was switched away for ten seconds buys nothing.
 */
const FOREGROUND_MIN_GAP_MS = 60_000;

type Props = {
  children: React.ReactNode;
  /** Override the persisted preference (useful for tests / Storybook). */
  initialKind?: DataSourceKind;
};

export function DataSourceProvider({ children, initialKind }: Props) {
  const [activeKind, setActiveKindState] = useState<DataSourceKind>(
    () => initialKind ?? getActiveDataSourceKind(),
  );

  // Keep the source instance stable across renders and tear it down when the
  // kind changes. Sources may hold timers / WebSocket subscriptions.
  const sourceRef = useRef<DataSource | null>(null);
  if (sourceRef.current?.kind !== activeKind) {
    sourceRef.current?.dispose?.();
    sourceRef.current = buildDataSource(activeKind);
  }
  const source = sourceRef.current;

  // One refresh at a time. A refresh reads months of history and recomputes
  // every view, and coming back to the app fires BOTH visibilitychange and
  // focus — so without this, every return to the foreground ran two full
  // refreshes side by side, each as slow as the other. A call that arrives
  // while one is running gets that one's promise instead of starting another.
  const gate = useMemo(() => ({ inFlight: null as Promise<void> | null, lastStart: 0 }), [source]);
  const run = useCallback(
    (fromForeground: boolean): Promise<void> => {
      if (gate.inFlight) return gate.inFlight;
      if (fromForeground && Date.now() - gate.lastStart < FOREGROUND_MIN_GAP_MS) return Promise.resolve();
      gate.lastStart = Date.now();
      gate.inFlight = source.refresh().finally(() => {
        gate.inFlight = null;
      });
      return gate.inFlight;
    },
    [source, gate],
  );

  // Trigger an initial refresh on mount + whenever the source changes. Real
  // sources will pull live data here; mock source rebuilds its snapshot
  // (no-op visible state change).
  useEffect(() => {
    void run(false);
    return () => {
      // dispose handled at the next swap or on full unmount via the ref guard
    };
  }, [run]);

  // Refresh whenever the app comes back to the foreground.
  //
  // The effect above is the only thing that ever pulled data, and it runs once
  // per source instance — i.e. once per page load. In a Capacitor webview the
  // page is NOT reloaded when the app is reopened from the background, so
  // returning to LoopStack after an hour in a pocket re-displayed the snapshot
  // from the last time it was open: a glucose hero showing a stale number, a
  // relative timestamp frozen at whatever it read on the way out, and no
  // gesture anywhere in the app that could ask for anything newer short of
  // force-quitting. For a screen whose entire job is "what is happening now",
  // becoming visible is the clearest possible signal to go and look.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [run]);

  const setActiveKind = useCallback((kind: DataSourceKind) => {
    setActiveDataSourceKind(kind);
    setActiveKindState(kind);
  }, []);

  // A manual refresh always runs, unless one is already under way.
  const refresh = useCallback(() => run(false), [run]);

  const value = useMemo<Ctx>(
    () => ({ source, activeKind, setActiveKind, refresh }),
    [source, activeKind, setActiveKind, refresh],
  );

  return (
    <DataSourceContext.Provider value={value}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSourceContext(): Ctx {
  const ctx = useContext(DataSourceContext);
  if (!ctx) {
    throw new Error(
      'useDataSourceContext must be used within a <DataSourceProvider>',
    );
  }
  return ctx;
}
