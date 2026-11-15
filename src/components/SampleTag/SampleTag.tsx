import styles from './SampleTag.module.css';

// Sample-data disclosure. Rendered on any surface whose numbers are mock or
// hand-authored, so example content is never mistaken for observed evidence.
// Per docs/information-architecture.md: preview content must be badged.
//
// Two forms:
//   <SampleTag />          — compact pill, sits where a confidence ring would.
//   <SampleNote>…</SampleNote> — one-line banner above a mock-fed section.

export function SampleTag({ label = 'Sample' }: { label?: string }) {
  return (
    <span
      className={styles.tag}
      title="Example data — not computed from your history yet"
    >
      {label}
    </span>
  );
}

export function SampleNote({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.note}>
      <SampleTag />
      <span>{children}</span>
    </p>
  );
}
