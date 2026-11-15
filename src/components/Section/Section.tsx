import styles from './Section.module.css';

type Props = {
  label?: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
  accent?: boolean;
  /** Optional control pinned to the top-right, level with the title — e.g. an
   *  edit toggle for a section that is read-only by default. */
  action?: React.ReactNode;
};

export function Section({
  label,
  title,
  description,
  children,
  accent = false,
  action,
}: Props) {
  return (
    <section className={`${styles.section} ${accent ? styles.accent : ''}`}>
      {label ? <span className={styles.label}>{label}</span> : null}
      {title || action ? (
        <div className={styles.titleRow}>
          {title ? <h2 className={styles.title}>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {description ? <p className={styles.description}>{description}</p> : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}

type RowProps = {
  label: string;
  value?: React.ReactNode;
  hint?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  trailing?: React.ReactNode;
};

export function Row({ label, value, hint, children, onClick, trailing }: RowProps) {
  const isInteractive = Boolean(onClick);
  const Root = isInteractive ? 'button' : 'div';
  return (
    <Root
      className={`${styles.row} ${isInteractive ? styles.rowInteractive : ''}`}
      onClick={onClick}
      type={isInteractive ? 'button' : undefined}
    >
      <div className={styles.rowLeft}>
        <span className={styles.rowLabel}>{label}</span>
        {hint ? <span className={styles.rowHint}>{hint}</span> : null}
      </div>
      <div className={styles.rowRight}>
        {value != null ? <span className={styles.rowValue}>{value}</span> : null}
        {children}
        {trailing}
      </div>
    </Root>
  );
}
