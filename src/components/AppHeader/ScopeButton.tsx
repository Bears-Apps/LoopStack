import { scopeLabel, type SampleScope } from '@/data/sampleScope';
import styles from './ScopeButton.module.css';

/**
 * The header pill naming what the screen is showing, and the way to change it.
 *
 * It replaced a chevron stepper. Chevrons could only walk one day per tap,
 * which is the wrong gesture for the question the data can actually answer —
 * "what do my Tuesdays do" is not eleven taps backwards, it is a different
 * shape of sample. The pencil says the sample is editable; the label says what
 * it currently is, so the screen never shows a figure whose window is a guess.
 */
export function ScopeButton({
  scope,
  onOpen,
}: {
  scope: SampleScope;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.pill}
      onClick={onOpen}
      aria-label={`Showing ${scopeLabel(scope)}. Change what this screen is showing`}
    >
      <span className={styles.label}>{scopeLabel(scope)}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}
