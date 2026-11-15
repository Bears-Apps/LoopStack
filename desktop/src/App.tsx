// LoopStack desktop: one app, two views. The left sidebar switches between
// the person's own dashboard and the care-team review of what they shared.
// The top bar is the glass control layer: data range, Edit layout, Share. Saved layouts and appearance open from the Edit layout panel.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PATIENT, PATIENTS, PERIOD, SUGGESTIONS } from './data/current';
import { eligibleForBuild } from './data/suggestions';
import { useSuggestionsBadge } from './data/tracked';
import { USABLE_N } from './data/derive';
import { loadPreset, PRESETS, type KV, type Layout, type PresetId } from './layout/model';
import { loadWorkspace, persistWorkspace, resetView, resolvedAppearance, type Workspace } from './layout/saved';
import { LayoutControls } from './layout/LayoutControls';
import { parse, toSearch, type Go, type Route, type View } from './nav';
import { packetParts, useStore, type PacketPart } from './state';
import { Announcer, GlassCta, IChanges, ILibrary, ISpark, ISuggest, IDashboard, IEdit, IReview, IShare, Mark, useAnnounce } from './ui/kit';
import { Dashboard } from './views/Dashboard';
import { Changes, Settings } from './views/Other';
import { Review } from './views/Review';
import { Library } from './views/Library';
import { Suggestions } from './views/Suggestions';
import { Assistant } from './views/Assistant';
import { ProfileBar } from './ui/ProfileBar';

const storage = (): KV | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const TITLES: Record<View, string> = {
  dashboard: 'My dashboard',
  review: 'Care-team review',
  changes: 'Changes',
  suggestions: 'Suggestions',
  library: 'Feature library',
  assistant: 'Ask & build',
  settings: 'Settings',
};

/** Read the URL once at start: reset, then a preset, then whatever was saved. */
function boot() {
  const b = parse(window.location.search);
  const store = storage();
  let workspace = loadWorkspace(store);
  if (b.reset) workspace = resetView(workspace);
  if (b.preset) workspace = { ...workspace, activeId: null, current: { ...workspace.current, layout: loadPreset(b.preset) } };
  if (b.preset || b.reset) persistWorkspace(store, workspace);
  const explicitHour = new URLSearchParams(window.location.search).has('sel') || new URLSearchParams(window.location.search).has('mode');
  if (!explicitHour) b.route = { ...b.route, ...workspace.current.settings };
  // Drop one-shot params so a reload doesn't re-apply them.
  if (b.preset || b.reset) window.history.replaceState(null, '', `${window.location.pathname}${toSearch(b.route)}`);
  return { route: b.route, workspace };
}

export function App() {
  return (
    <Announcer>
      <Shell />
    </Announcer>
  );
}

function Shell() {
  const [init] = useState(boot);
  const [route, setRoute] = useState<Route>(init.route);
  const [workspace, setWorkspace] = useState<Workspace>(init.workspace);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const layout = workspace.current.layout;
  // Saved layouts sit behind Edit layout: leaving edit mode closes them.
  useEffect(() => { if (!route.edit) setLayoutsOpen(false); }, [route.edit]);
  const announce = useAnnounce();
  const routeRef = useRef(route);
  routeRef.current = route;

  const setLayout = useCallback((l: Layout) => {
    setWorkspace(current => ({ ...current, current: { ...current.current, layout: l } }));
  }, []);

  useEffect(() => { setStorageError(!persistWorkspace(storage(), workspace)); }, [workspace]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = resolvedAppearance(workspace.current.appearance, media.matches);
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [workspace.current.appearance]);
  useEffect(() => {
    setWorkspace(current => current.current.settings.mode === route.mode && current.current.settings.sel === route.sel ? current :
      { ...current, current: { ...current.current, settings: { mode: route.mode, sel: route.sel } } });
  }, [route.mode, route.sel]);

  const go: Go = useCallback((patch, opts) => {
    const next = { ...routeRef.current, ...patch };
    if (next.view !== 'dashboard') { next.edit = false; next.tile = null; }
    if (patch.edit) next.tile = null;
    routeRef.current = next;
    const url = `${window.location.pathname}${toSearch(next)}`;
    if (opts?.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setRoute(next);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.search).route);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = `${TITLES[route.view]} · LoopStack`;
  }, [route.view]);

  const onPreset = (p: PresetId) => {
    setWorkspace(current => ({ ...current, activeId: null, current: { ...current.current, layout: loadPreset(p) } }));
    announce(`${PRESETS[p].name} layout loaded.`);
  };
  const onReset = () => {
    const next = resetView(workspace);
    setWorkspace(next);
    go(next.current.settings, { replace: true });
    announce('Dashboard reset to the default layout.');
  };

  const nav: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'dashboard', label: 'My dashboard', icon: <IDashboard /> },
    { id: 'review', label: 'Care-team review', icon: <IReview /> },
    { id: 'changes', label: 'Changes', icon: <IChanges /> },
    { id: 'suggestions', label: 'Suggestions', icon: <ISuggest /> },
    { id: 'library', label: 'Feature library', icon: <ILibrary /> },
    { id: 'assistant', label: 'Ask & build', icon: <ISpark /> },
  ];
  const clinician = route.view === 'review';
  // Suggestions badge: new suggestions plus tracked readings that reached confidence.
  const badge = useSuggestionsBadge(SUGGESTIONS.map((s) => ({ id: s.id, ready: eligibleForBuild(s).ok })));

  return (
    <div className={`app${window.loopstack?.desktop ? ' in-electron' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="LoopStack">
        <div className="brand">
          <Mark />
          <span className="wordmark">LoopStack</span>
        </div>
        <nav aria-label="Main">
          <ul>
            {nav.map((n) => (
              <li key={n.id}>
                <button type="button" className="nav-item" title={n.label} aria-current={route.view === n.id ? 'page' : undefined} onClick={() => go({ view: n.id })}>
                  {n.icon}
                  <span className="nav-label">{n.label}</span>
                  {n.id === 'suggestions' && badge.total > 0 && <><span className="nav-badge" aria-hidden="true">{badge.total > 99 ? '99+' : badge.total}</span><span className="sr-only">, {badge.total} new</span></>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <ProfileBar clinician={clinician} go={go} />
      </aside>

      <div className="main-col">
        <header className="topbar glass">
          <h1 className="top-title">{TITLES[route.view]}</h1>
          <span className="range" aria-label={`Data range ${PERIOD.label}, ${PERIOD.days} days, ${USABLE_N} usable`}>
            <span className="strong">{PERIOD.label}</span> · {PERIOD.days} days, {USABLE_N} usable
          </span>
          <span className="spacer" />
          {route.view === 'dashboard' && (
            <button
              type="button"
              className="toggle-btn"
              aria-pressed={route.edit}
              onClick={() => { go({ edit: !route.edit }, { replace: true }); announce(route.edit ? 'Finished editing the layout.' : 'Editing the layout. The tile library is open.'); }}
            >
              <IEdit /> {route.edit ? 'Done' : 'Edit layout'}
            </button>
          )}
          {/* A view's own top-bar actions land here (the care-team review's Save as PDF and Email). */}
          <span id="topbar-actions" className="topbar-actions" />
          {!clinician && <Share go={go} />}
        </header>
        {layoutsOpen && route.view === 'dashboard' && route.edit && <LayoutControls state={workspace} onChange={next => {
          setWorkspace(next);
          go({ ...next.current.settings, tile: null }, { replace: true });
        }} onReset={onReset} onClose={() => setLayoutsOpen(false)} />}
        {storageError && <p className="layout-storage-error" role="alert">Layout storage is unavailable. Changes work now but will not survive a restart. Free browser storage and try again.</p>}
        <main id="main" className="content" tabIndex={-1}>
          {route.view === 'dashboard' && <Dashboard route={route} go={go} layout={layout} setLayout={setLayout} onPreset={onPreset} onReset={onReset} layouts={{ active: workspace.saved.find(v => v.id === workspace.activeId)?.name ?? null, count: workspace.saved.length, open: layoutsOpen, onToggle: () => setLayoutsOpen(v => !v) }} />}
          {route.view === 'review' && <Review route={route} go={go} />}
          {route.view === 'changes' && <Changes />}
          {route.view === 'suggestions' && <Suggestions go={go} />}
          {route.view === 'library' && <Library />}
          {route.view === 'assistant' && <Assistant />}
          {route.view === 'settings' && <Settings layout={layout} onReset={onReset} />}
        </main>
      </div>
    </div>
  );
}

/** "Share with care team" builds a review packet: a snapshot the person picks, never a live feed. */
function Share({ go }: { go: Go }) {
  const { sharePacket, packet } = useStore();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PacketPart[]>(() => packetParts().map((p) => p.id));
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const toggle = (p: PacketPart) => setParts((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  useEffect(() => {
    if (!open) return undefined;
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    panel.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); anchor.current?.querySelector('button')?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open, done]);

  const build = () => {
    sharePacket(parts);
    setDone(true);
    announce(`Packet shared with ${PATIENT.clinician}.`);
  };

  return (
    <div className="menu-wrap" ref={anchor}>
      <GlassCta onClick={() => { setOpen((o) => !o); setDone(false); }} icon={<IShare />} expanded={open} controls="share-panel">Share with care team</GlassCta>
      {/* Portalled out of the glass top bar: glass inside glass can't blur what's behind it (GLASS-1b). */}
      {open && createPortal(
        <div ref={panel} id="share-panel" role="dialog" aria-modal="false" aria-labelledby="share-h" className="popover glass share" style={{ top: pos.top, right: pos.right }}>
          {done ? (
            <>
              <h2 id="share-h" className="h3">Packet shared</h2>
              <p className="small ink">{PATIENT.clinician} can read it now, shared {packet.shared}. It’s a snapshot of {PERIOD.label}; nothing updates on its own.</p>
              <div className="row">
                <button type="button" className="solid-btn" onClick={() => { setOpen(false); go({ view: 'review', patient: PATIENTS[0].id, section: 'glucose' }); }}>See it as your care team does</button>
                <button type="button" className="quiet-btn" onClick={() => setOpen(false)}>Close</button>
              </div>
            </>
          ) : (
            <>
              <h2 id="share-h" className="h3">Build a review packet</h2>
              <p className="small">For {PATIENT.clinician}, before your visit on {PATIENT.nextVisit}. You choose what goes in.</p>
              <ul className="parts">
                <li className="part fixed"><span className="check on" aria-hidden="true" /><span className="stack"><span className="strong">The glucose page</span><span className="caption">Always included: sensor wear, lows, time in range, the curve</span></span></li>
                {packetParts().map((p) => (
                  <li key={p.id}>
                    <label className="part">
                      <input type="checkbox" checked={parts.includes(p.id)} onChange={() => toggle(p.id)} />
                      <span className="stack"><span className="strong">{p.label}</span><span className="caption">{p.note}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button type="button" className="solid-btn" onClick={build}>Share packet</button>
                <button type="button" className="quiet-btn" onClick={() => setOpen(false)}>Cancel</button>
              </div>
              <p className="caption">A packet is a snapshot to read. LoopStack never changes your pump.</p>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

declare global {
  interface Window {
    loopstack?: { desktop: boolean; platform: string; nightscout?: import('./data/source').NightscoutBridge; github?: import('./data/loopBuild').GithubBridge; library?: import('./data/library').LibraryBridge; favorites?: import('./data/favorites').FavoritesBridge; ai?: import('./data/ai').AiBridge };
  }
}
