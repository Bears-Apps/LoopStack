import { useState } from 'react';
import {
  SURFACE_BLURBS,
  SURFACE_LABELS,
  surfaceFor,
  type ClaudeHandoff,
} from '@/lib/loop/changeSurface';
import type { FixLogChangeKind } from '@/data/types';
import styles from './ChangeHandoff.module.css';

// The two views of a change: one to read, one to paste.
//
// They are deliberately separate. The read-more view is for deciding — plain
// language, the evidence, and where the change actually happens. The Claude
// prompt is for doing, and it carries the constraints an assistant needs when
// the repo it is editing compiles to something worn on a body.
//
// Neither is shown by default. A settings change does not need either, and a
// panel that unfurls on every card turns the Fix Log into a wall.

type Props = {
  kind: FixLogChangeKind;
  handoff: ClaudeHandoff;
};

export function ChangeHandoff({ kind, handoff }: Props) {
  const [view, setView] = useState<'none' | 'read' | 'prompt'>('none');
  const [copied, setCopied] = useState(false);
  const surface = surfaceFor(kind);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(handoff.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this prompt:', handoff.prompt);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={`${styles.surface} ${styles[`surface_${surface}`]}`}>
          {SURFACE_LABELS[surface]}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.link}
            onClick={() => setView(view === 'read' ? 'none' : 'read')}
            aria-expanded={view === 'read'}
          >
            {view === 'read' ? 'Hide' : 'Read more'}
          </button>
          {surface === 'code' ? (
            <button
              type="button"
              className={styles.link}
              onClick={() => setView(view === 'prompt' ? 'none' : 'prompt')}
              aria-expanded={view === 'prompt'}
            >
              {view === 'prompt' ? 'Hide prompt' : 'For Claude'}
            </button>
          ) : null}
        </div>
      </div>

      <p className={styles.blurb}>{SURFACE_BLURBS[surface]}</p>

      {view === 'read' ? (
        <div className={styles.readPane}>
          {handoff.readMore.split('\n').map((line, i) =>
            line === '' ? (
              <span key={i} className={styles.spacer} />
            ) : (
              <p key={i} className={styles.readLine}>
                {line}
              </p>
            ),
          )}
        </div>
      ) : null}

      {view === 'prompt' ? (
        <div className={styles.promptPane}>
          <div className={styles.promptHead}>
            <span className={styles.promptLabel}>
              Paste into Claude with your Loop checkout open
            </span>
            <button type="button" className={styles.copyBtn} onClick={copyPrompt}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <pre className={styles.pre}>{handoff.prompt}</pre>
        </div>
      ) : null}
    </div>
  );
}
