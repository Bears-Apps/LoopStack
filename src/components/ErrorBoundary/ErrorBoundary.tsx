import { Component, type ErrorInfo, type ReactNode } from 'react';
import { setActiveDataSourceKind } from '@/data/sources/sourcePreference';
import styles from './ErrorBoundary.module.css';

// Last line of defence. A render error anywhere below this shows a readable
// screen with a way out, instead of React's raw minified stack — which on a
// production iOS build is a wall of `gn@capacitor://localhost/assets/...` that
// tells the user nothing and offers no recovery.
//
// The escape hatches matter more than the message. A bad data source can put
// the app in a state where every render throws, and without a way to switch
// source or clear settings the only remedy left is deleting the app.

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept for the device console; never shown raw to the user.
    // eslint-disable-next-line no-console
    console.error('LoopStack render error:', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  /** Back to sample data — the one source that cannot fail to load. Goes
   *  through the real setter so this escape hatch can never drift out of sync
   *  with the key the app actually reads. */
  private resetToMock = () => {
    setActiveDataSourceKind('mock');
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.screen} role="alert">
        <div className={styles.card}>
          <span className={styles.kicker}>Something went wrong</span>
          <h1 className={styles.title}>LoopStack hit an error and stopped</h1>
          <p className={styles.body}>
            No data was changed. Your Loop settings, Fix Log and Commit Log are
            stored on this device and are untouched — this is a display problem,
            not a data one.
          </p>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={this.reload}>
              Reload
            </button>
            <button type="button" className={styles.secondary} onClick={this.resetToMock}>
              Reload with sample data
            </button>
          </div>

          <p className={styles.hint}>
            If reloading lands here again, the second button switches the data
            source back to sample data, which always loads. You can then change
            source under Profile → Sources.
          </p>

          <details className={styles.details}>
            <summary className={styles.summary}>Technical detail</summary>
            <pre className={styles.pre}>{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
