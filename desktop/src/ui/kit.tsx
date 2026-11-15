// The control layer (glass) and the small shared pieces. GLASS-1: glass for
// the toolbar, the library panel, popovers and the one primary CTA; charts,
// tiles and numbers sit on solid ground.
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode,
} from 'react';
import type { HourState } from '../data/current';

// ------------------------------------------------------------ icons

const icon = (d: ReactNode, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
export const IDashboard = () => icon(<><rect x="3" y="3" width="6" height="7" rx="1.5" /><rect x="11" y="3" width="6" height="4" rx="1.5" /><rect x="11" y="9" width="6" height="8" rx="1.5" /><rect x="3" y="12" width="6" height="5" rx="1.5" /></>);
export const IReview = () => icon(<><path d="M5 3h7l3 3v11H5z" /><path d="M8 10h4M8 13h4" /></>);
export const IChanges = () => icon(<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="15" r="2" /><path d="M6 7v6M8 5h4a3 3 0 0 1 3 3v5" /></>);
export const ISettings = () => icon(<><path d="M3 6h8M15 6h2M3 14h2M9 14h8" /><circle cx="13" cy="6" r="2" /><circle cx="7" cy="14" r="2" /></>);
export const ILibrary = () => icon(<><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><path d="M14 11v6M11 14h6" /></>);
export const ISpark = () => icon(<><path d="M10 3v4M10 13v4M3 10h4M13 10h4" /><path d="M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2" /></>);
export const IShare = () => icon(<path d="M10 3v10M6 7l4-4 4 4M4 12v4h12v-4" />);
export const ISuggest = () => icon(<><path d="M7.5 14.5h5M8 17h4" /><path d="M10 3a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" /></>);
export const IPdf = () => icon(<><path d="M5 3h7l3 3v11H5z" /><path d="M10 8v6M7.5 11.5L10 14l2.5-2.5" /></>);
export const IMail = () => icon(<><rect x="3" y="5" width="14" height="10" rx="1.5" /><path d="M3.5 6l6.5 5 6.5-5" /></>);
export const IEdit = () => icon(<><path d="M4 16h3l8.5-8.5-3-3L4 13z" /><path d="M11 6l3 3" /></>);
export const IChevron = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const IBack = () => icon(<path d="M12.5 4l-6 6 6 6" />);
export const IClose = () => icon(<path d="M5 5l10 10M15 5L5 15" />);
export const IMore = () => <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1.6" fill="currentColor" /><circle cx="10" cy="10" r="1.6" fill="currentColor" /><circle cx="15" cy="10" r="1.6" fill="currentColor" /></svg>;
export const IGrip = () => <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">{[6, 10, 14].flatMap((y) => [7, 13].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.5" fill="currentColor" />))}</svg>;
export const IResize = () => icon(<path d="M16 9v7H9M16 16l-6-6" />, 18);
export const IPlus = () => icon(<path d="M10 4v12M4 10h12" />);
export const IBell = () => icon(<><path d="M10 4a4 4 0 0 0-4 4v3l-1.5 2.5h11L14 11V8a4 4 0 0 0-4-4z" /><path d="M8.5 16a1.6 1.6 0 0 0 3 0" /></>);
export const IPin = () => icon(<><path d="M10 17v-5" /><path d="M6.5 3h7l-1 4 2.5 3h-10l2.5-3z" /></>, 16);
export const ICheck = () => icon(<path d="M4.5 10.5l3.5 3.5 7.5-8" />, 16);

/** DM-3: Loop's status ring. Green under 5 minutes, yellow 5–15, red after. */
export const Ring = ({ minutes, size = 16 }: { minutes: number; size?: number }) => {
  const [stroke, word] = minutes < 5 ? ['var(--brand-primary)', 'green'] : minutes <= 15 ? ['var(--range-high)', 'yellow'] : ['var(--range-low)', 'red'];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={`Loop status: ${word}, looped ${minutes} minutes ago`}>
      <circle cx="8" cy="8" r="5.75" fill="none" style={{ stroke }} strokeWidth="3" />
    </svg>
  );
};

/** The LoopStack mark (Concept 07c, the chosen icon): the ring with a speech tail;
 *  the stack is a thread, the care team's reply in ink coming in from outside the ring.
 *  Brand art, decorative. Same geometry as desktop/build/icon.svg. */
export const Mark = ({ size = 28 }: { size?: number }) => {
  const gid = `mark${useId().replace(/:/g, '')}`;
  const g = `url(#${gid})`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="14" x2="0" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--mark-gradient-start)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-gradient-end)' }} />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="99" height="99" rx="22.5" vectorEffect="non-scaling-stroke" style={{ fill: 'var(--surface-0)', stroke: 'var(--ink-200)' }} />
      <g transform="translate(-1.2 1.8)">
        <path d="M66.1 28.6A28 28 0 1 0 66.1 67.4" fill="none" stroke={g} strokeWidth="11" />
        <polygon points="33.3,75.2 18.8,60.7 13,81" fill={g} stroke={g} strokeWidth="2" strokeLinejoin="round" />
        <rect x="50" y="35.25" width="30" height="6.5" rx="3.25" fill={g} />
        <rect x="60" y="44.75" width="30" height="6.5" rx="3.25" style={{ fill: 'var(--ink-900)' }} />
        <rect x="50" y="54.25" width="21" height="6.5" rx="3.25" fill={g} />
      </g>
    </svg>
  );
};

// ------------------------------------------------------------ hour-state swatches (COL-5: glyph + colour)

export const STATE_FILL: Record<Exclude<HourState, 'x'>, string> = {
  a: 'var(--surface-2)',
  l: 'var(--hour-less)',
  m: 'var(--graph-insulin)',
  s: 'var(--ink-700)',
};

export function Hatch({ id, size = 4 }: { id: string; size?: number }) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={size} height={size} style={{ fill: 'var(--surface-0)' }} />
      <line x1="0" y1="0" x2="0" y2={size} style={{ stroke: 'var(--ink-400)' }} strokeWidth="1.5" />
    </pattern>
  );
}

export function Swatch({ kind, w = 14, h = 10 }: { kind: HourState | 'run'; w?: number; h?: number }) {
  const pid = useId().replace(/:/g, '');
  const ink = { fill: 'var(--ink-900)' };
  if (kind === 'run') {
    return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.9L8.6 8.2L1.4 8.2Z" style={{ fill: 'var(--graph-activity)' }} /></svg>;
  }
  return (
    <svg width={w} height={h} viewBox="0 0 14 10" aria-hidden="true">
      {kind === 'x' ? (
        <>
          <defs><Hatch id={pid} size={5} /></defs>
          <rect x="0.5" y="0.5" width="13" height="9" rx="2" fill={`url(#${pid})`} style={{ stroke: 'var(--ink-400)' }} />
        </>
      ) : (
        <rect width="14" height="10" rx="2" style={{ fill: STATE_FILL[kind], stroke: kind === 'a' ? 'var(--ink-300)' : 'none' }} />
      )}
      {kind === 'l' && <path d="M4 3L10 3L7 7Z" style={ink} />}
      {kind === 'm' && <path d="M4 7L10 7L7 3Z" style={ink} />}
      {kind === 's' && (
        <>
          <rect x="3.8" y="2" width="1.6" height="6" style={{ fill: 'var(--surface-0)' }} />
          <rect x="8.6" y="2" width="1.6" height="6" style={{ fill: 'var(--surface-0)' }} />
        </>
      )}
    </svg>
  );
}

export const Chip = ({ kind, children }: { kind: HourState | 'run'; children: ReactNode }) => (
  <li className="chip glass"><Swatch kind={kind} /><span>{children}</span></li>
);

// ------------------------------------------------------------ controls

export function Segmented<T extends string>({ label, items, value, onChange, size = 'md' }: {
  label: string;
  items: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="group" aria-label={label} className={`segmented glass ${size}`}>
      {items.map((it) => (
        <button key={it.value} type="button" aria-pressed={it.value === value} title={it.title} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** GLASS-5: the one glass CTA on a screen. */
export function GlassCta({ children, onClick, label, icon: ic, expanded, controls }: {
  children: ReactNode;
  onClick: () => void;
  label?: string;
  icon?: ReactNode;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button type="button" className="cta glass-green" aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      {ic}
      {children}
    </button>
  );
}

// ------------------------------------------------------------ announcements

const AnnounceCtx = createContext<(msg: string) => void>(() => {});
export const useAnnounce = () => useContext(AnnounceCtx);

/** One polite live region for the app: layout moves, sends, replies. */
export function Announcer({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const n = useRef(0);
  const announce = useCallback((m: string) => {
    // Re-announce the same text by toggling a zero-width suffix.
    n.current += 1;
    setMsg(`${m}${n.current % 2 ? '' : '​'}`);
  }, []);
  return (
    <AnnounceCtx.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">{msg}</div>
    </AnnounceCtx.Provider>
  );
}

// ------------------------------------------------------------ popover menu

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
  /** A choice in a set (menuitemradio) when defined. */
  checked?: boolean;
  /** Draw a divider above this item. */
  divide?: boolean;
}

/**
 * A glass popover menu (GLASS-1). Opens from a button, arrow keys move between
 * items, Escape closes and returns focus to the button.
 */
export function Menu({ label, items, note, buttonClass = 'icon-btn', children }: {
  label: string;
  items: MenuItem[];
  note?: string;
  buttonClass?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [flip, setFlip] = useState(false);

  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !menu.current || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setFlip(r.left + menu.current.offsetWidth > window.innerWidth - 8);
    menu.current.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  const onKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  };

  return (
    <div className="menu-wrap">
      <button
        ref={btn}
        type="button"
        className={buttonClass}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key.startsWith('Arrow')) e.stopPropagation(); }}
      >
        {children}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className={`menu glass${flip ? ' flip' : ''}`} onKeyDown={onKey}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={it.checked}
              className={it.divide ? 'divide' : undefined}
              disabled={it.disabled}
              onClick={() => { close(); it.onSelect(); }}
            >
              <span>{it.checked !== undefined && <span className="radio" aria-hidden="true">{it.checked ? '●' : '○'}</span>}{it.label}</span>
              {it.hint && <span className="hint">{it.hint}</span>}
            </button>
          ))}
          {note && <p className="menu-note"><IPin />{note}</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ measuring

/** The content box of an element, for charts that draw at their real pixel size. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Fills its box and hands the children its measured size. */
export function Fit({ children, className = '', minH }: { children: (s: { w: number; h: number }) => ReactNode; className?: string; minH?: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className={`fit ${className}`} style={minH ? { minHeight: minH } : undefined}>
      {size.w > 0 && size.h > 0 ? children(size) : null}
    </div>
  );
}
