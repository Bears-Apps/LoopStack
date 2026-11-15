// "My dashboard": the person's own 12-column canvas of tracker tiles (PROD-1).
// Edit layout switches to the arrange view: the same grid scaled back to about
// half size, each tile a live miniature, so the whole dashboard fits on screen
// and a drag moves a small block rather than the full UI. The tile library sits
// beside it. Every pointer move has a keyboard twin, and every change is announced.
import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import {
  applyKey, available, canRemove, describe, indexOf, moveBy, moveTo, PRESET_IDS, PRESETS, remove, resize, stepHeight,
  TILES, WIDTH_NAME, WIDTHS, add, MAX_H, type Layout, type PresetId, type Tile, type TileKind,
} from '../layout/model';
import type { Go, Route } from '../nav';
import { FACES } from '../tiles/faces';
import './arrange.css';
import { IBack, IChevron, IClose, IGrip, IMore, IPin, IPlus, IResize, Menu, useAnnounce, type MenuItem } from '../ui/kit';

/** Width choices in the tile menu, in words: a quarter, half, two thirds or all of the row. */
const WIDTH_LABEL: Record<number, string> = { 4: 'Small · a third', 6: 'Medium · half', 8: 'Large · two thirds', 12: 'Full width' };

const ROW_H = 150;
const GAP = 16;
// The arrange view: about half size, so the whole layout is in view.
const ARRANGE_ROW_H = 84;
const ARRANGE_GAP = 10;

interface Props {
  route: Route;
  go: Go;
  layout: Layout;
  setLayout: (l: Layout) => void;
  onPreset: (p: PresetId) => void;
  onReset: () => void;
  /** Saved layouts and appearance live behind Edit layout, not in the top bar. */
  layouts: SavedLayouts;
}

export interface SavedLayouts { active: string | null; count: number; open: boolean; onToggle: () => void }

export function Dashboard(props: Props) {
  const { route, go } = props;
  if (route.tile) return <DetailPage route={route} go={go} kind={route.tile} />;
  return <Canvas {...props} />;
}

function DetailPage({ route, go, kind }: { route: Route; go: Go; kind: TileKind }) {
  const { Detail } = FACES[kind];
  return (
    <div className="detail-page">
      <div className="row detail-head">
        <button type="button" className="back-btn" onClick={() => go({ tile: null })}>
          <IBack /> My dashboard
        </button>
        <h2 className="title">{TILES[kind].title}</h2>
        {TILES[kind].pinned && <span className="pin-note"><IPin /> Always on your dashboard</span>}
      </div>
      <Detail route={route} go={go} w={12} h={4} />
    </div>
  );
}

function Canvas({ route, go, layout, setLayout, onPreset, onReset, layouts }: Props) {
  const announce = useAnnounce();
  const grid = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<TileKind | null>(null);
  const [resizing, setResizing] = useState<TileKind | null>(null);
  const edit = route.edit;
  const rowH = edit ? ARRANGE_ROW_H : ROW_H;
  const gap = edit ? ARRANGE_GAP : GAP;

  const commit = (next: Layout, msg: string | null) => {
    if (next === layout) return;
    setLayout(next);
    if (msg) announce(msg);
  };

  // ---------------------------------------------------------- drag to reorder (pointer)
  const drag = useRef<{ id: TileKind; pointer: number } | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const onHandleDown = (id: TileKind) => (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId };
    setDragging(id);
  };
  const onHandleMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const over = document.elementsFromPoint(e.clientX, e.clientY)
      .map((el) => (el as HTMLElement).closest<HTMLElement>('[data-tile]'))
      .find((el) => el && el.dataset.tile !== d.id);
    if (!over) return;
    const target = over.dataset.tile as TileKind;
    const l = layoutRef.current;
    const to = indexOf(l, target);
    if (to < 0) return;
    const next = moveTo(l, d.id, to);
    if (next !== l) {
      layoutRef.current = next;
      setLayout(next);
    }
  };
  const onHandleUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(null);
    announce(describe(layoutRef.current, d.id));
  };

  // ---------------------------------------------------------- drag to resize (pointer)
  const rs = useRef<{ id: TileKind; x: number; y: number; w: number; h: number; col: number; pointer: number } | null>(null);
  const onResizeDown = (t: Tile) => (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !grid.current) return;
    const el = e.currentTarget.closest<HTMLElement>('[data-tile]');
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const col = (grid.current.clientWidth - gap * 11) / 12;
    rs.current = { id: t.id, x: e.clientX, y: e.clientY, w: r.width, h: r.height, col, pointer: e.pointerId };
    setResizing(t.id);
  };
  const onResizeMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = rs.current;
    if (!s || s.pointer !== e.pointerId) return;
    const cols = Math.round((s.w + (e.clientX - s.x) + gap) / (s.col + gap));
    const rows = Math.round((s.h + (e.clientY - s.y) + gap) / (rowH + gap));
    const l = layoutRef.current;
    const next = resize(l, s.id, { w: cols, h: rows });
    if (next !== l) {
      layoutRef.current = next;
      setLayout(next);
    }
  };
  const onResizeUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = rs.current;
    if (!s || s.pointer !== e.pointerId) return;
    rs.current = null;
    setResizing(null);
    announce(describe(layoutRef.current, s.id));
  };

  // ---------------------------------------------------------- keyboard
  const onTileKey = (id: TileKind) => (e: KeyboardEvent<HTMLElement>) => {
    if (!edit || e.target !== e.currentTarget) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(e.key)) return;
    e.preventDefault();
    const { layout: next, message } = applyKey(layout, id, e.key, e.shiftKey);
    if (message) announce(message);
    if (next !== layout) setLayout(next);
    if (!next.tiles.some((t) => t.id === id)) {
      // The removed tile's neighbour takes focus once React has drawn the new layout.
      const i = Math.min(indexOf(layout, id), next.tiles.length - 1);
      requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-tile="${next.tiles[i].id}"]`)?.focus());
    }
  };

  const menuFor = (t: Tile, i: number) => {
    const last = layout.tiles.length - 1;
    const steps = WIDTHS.filter((w) => w >= TILES[t.id].minW);
    const items: MenuItem[] = [
      { label: 'Move earlier', hint: '←', disabled: i === 0, onSelect: () => commitAndDescribe(moveBy(layout, t.id, -1), t.id) },
      { label: 'Move later', hint: '→', disabled: i === last, onSelect: () => commitAndDescribe(moveBy(layout, t.id, 1), t.id) },
    ];
    const widths: MenuItem[] = steps.map((w, k) => ({
      label: WIDTH_LABEL[w],
      checked: t.w === w,
      divide: k === 0,
      onSelect: () => commitAndDescribe(resize(layout, t.id, { w }), t.id),
    }));
    const heights: MenuItem[] = [
      { label: 'Taller', hint: '⇧↓', divide: true, disabled: t.h >= MAX_H, onSelect: () => commitAndDescribe(stepHeight(layout, t.id, 1), t.id) },
      { label: 'Shorter', hint: '⇧↑', disabled: t.h <= TILES[t.id].minH, onSelect: () => commitAndDescribe(stepHeight(layout, t.id, -1), t.id) },
    ];
    const all: MenuItem[] = [...items, ...widths, ...heights];
    if (canRemove(t.id)) all.push({ label: 'Remove', hint: 'Del', divide: true, onSelect: () => commit(remove(layout, t.id), `${TILES[t.id].title} removed. Add it back from the library.`) });
    return all;
  };

  // Menu items announce the resulting position once they've applied.
  const commitAndDescribe = (next: Layout, id: TileKind) => commit(next, next.tiles.some((t) => t.id === id) ? describe(next, id) : null);

  if (!edit) {
    return (
      <div className="dash">
        <div className="canvas-wrap">
          <div ref={grid} className="canvas" style={{ ['--row-h' as string]: `${ROW_H}px`, ['--gap' as string]: `${GAP}px` }}>
            {layout.tiles.map((t) => {
              const spec = TILES[t.id];
              const { Glance } = FACES[t.id];
              const titleId = `tile-${t.id}-title`;
              return (
                <article key={t.id} data-tile={t.id} className="tile" style={{ gridColumn: `span ${t.w}`, gridRow: `span ${t.h}` }} aria-labelledby={titleId}>
                  <header className="tile-head">
                    <h2 id={titleId} className="tile-title">{spec.title}</h2>
                    <button type="button" className="text-btn detail-btn" aria-label={`Open ${spec.title} details`} onClick={() => go({ tile: t.id })}>
                      Details <IChevron />
                    </button>
                  </header>
                  <div className="tile-body"><Glance route={route} go={go} w={t.w} h={t.h} /></div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash editing">
      <div className="canvas-wrap">
        <div className="arrange-bar">
          <p className="edit-hint" id="edit-hint">
            Your dashboard at half size. Drag a tile by its handle to move it, or by its corner to resize it. A focused tile also moves with the arrow keys, and resizes with Shift and the arrows.
          </p>
        </div>
        <div ref={grid} className="canvas arrange-grid" style={{ ['--row-h' as string]: `${rowH}px`, ['--gap' as string]: `${gap}px` }}>
          {layout.tiles.map((t, i) => {
            const spec = TILES[t.id];
            const { Glance } = FACES[t.id];
            const titleId = `tile-${t.id}-title`;
            return (
              <article
                key={t.id}
                data-tile={t.id}
                className={`tile arrange${dragging === t.id ? ' dragging' : ''}${resizing === t.id ? ' resizing' : ''}`}
                style={{ gridColumn: `span ${t.w}`, gridRow: `span ${t.h}` }}
                aria-labelledby={titleId}
                aria-describedby="edit-hint"
                tabIndex={0}
                onKeyDown={onTileKey(t.id)}
              >
                <header className="tile-head">
                  <button
                    type="button"
                    className="icon-btn handle"
                    aria-label={`Drag to move ${spec.title}`}
                    onPointerDown={onHandleDown(t.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                  >
                    <IGrip />
                  </button>
                  <h2 id={titleId} className="tile-title">{spec.title}</h2>
                  {spec.pinned && <span className="pin-note" title="Always on your dashboard"><IPin /><span className="sr-only">Always on your dashboard</span></span>}
                  <span className="size-chip" aria-label={`${WIDTH_NAME[t.w]} width, ${t.h} ${t.h === 1 ? 'row' : 'rows'} tall`}>{WIDTH_NAME[t.w]} · {t.h} {t.h === 1 ? 'row' : 'rows'}</span>
                  <Menu
                    label={`Options for ${spec.title}`}
                    items={menuFor(t, i)}
                    note={spec.pinned ? 'Always on your dashboard. Move or resize it; it can’t be removed.' : undefined}
                  >
                    <IMore />
                  </Menu>
                </header>
                {/* A live miniature: the real glance at twice the space, shown at half size. */}
                <div className="tile-preview" aria-hidden="true" {...{ inert: '' }}>
                  <div className="preview-zoom">
                    <Glance route={route} go={go} w={t.w} h={t.h} />
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn resize-handle"
                  aria-label={`Drag to resize ${spec.title}`}
                  onPointerDown={onResizeDown(t)}
                  onPointerMove={onResizeMove}
                  onPointerUp={onResizeUp}
                  onPointerCancel={onResizeUp}
                >
                  <IResize />
                </button>
              </article>
            );
          })}
        </div>
      </div>
      <Library layout={layout} onAdd={(k) => { const next = add(layout, k); commit(next, `${TILES[k].title} added at the end. ${describe(next, k)}.`); }} onPreset={onPreset} onReset={onReset} layouts={layouts} onClose={() => go({ edit: false })} />
    </div>
  );
}

function Library({ layout, onAdd, onPreset, onReset, layouts, onClose }: {
  layout: Layout;
  layouts: SavedLayouts;
  onAdd: (k: TileKind) => void;
  onPreset: (p: PresetId) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const left = available(layout);
  const on = layout.tiles.filter((t) => !TILES[t.id].pinned);
  return (
    <aside className="tile-library" aria-label="Tile library">
      <div className="row between">
        <h2 className="h3">Tiles</h2>
        <button type="button" className="icon-btn" aria-label="Finish editing the layout" onClick={onClose}><IClose /></button>
      </div>

      <section aria-labelledby="lib-saved" className="stack-8">
        <h3 id="lib-saved" className="label">Saved layouts</h3>
        <button type="button" className="lib-row" aria-expanded={layouts.open} aria-controls="layout-controls" onClick={layouts.onToggle}>
          <span className="stack">
            <span className="strong">{layouts.active ?? 'Working view'}</span>
            <span className="caption">{layouts.count ? `${layouts.count} saved` : 'None saved yet'} · save, switch or rename · appearance</span>
          </span>
          <span className="caption">{layouts.open ? 'Close' : 'Open'}</span>
        </button>
      </section>

      <section aria-labelledby="lib-presets" className="stack-8">
        <h3 id="lib-presets" className="label">Start from a preset</h3>
        {PRESET_IDS.map((p) => (
          <button key={p} type="button" className="lib-row" aria-pressed={layout.preset === p} onClick={() => onPreset(p)}>
            <span className="stack">
              <span className="strong">{PRESETS[p].name}</span>
              <span className="caption">{PRESETS[p].blurb}</span>
            </span>
          </button>
        ))}
        <button type="button" className="quiet-btn" onClick={onReset}>Reset to default</button>
      </section>

      <section aria-labelledby="lib-add" className="stack-8">
        <h3 id="lib-add" className="label">Add a tile</h3>
        {left.length === 0 && <p className="caption">Every tile is on your dashboard.</p>}
        {left.map((k) => (
          <button key={k} type="button" className="lib-row" onClick={() => onAdd(k)} aria-label={`Add ${TILES[k].title}`}>
            <span className="stack">
              <span className="strong">{TILES[k].title}</span>
              <span className="caption">{TILES[k].blurb}</span>
            </span>
            <IPlus />
          </button>
        ))}
      </section>

      <section aria-labelledby="lib-on" className="stack-8">
        <h3 id="lib-on" className="label">Always on your dashboard</h3>
        {(['heads-ups', 'day-tracker'] as const).map((k) => (
          <div key={k} className="lib-row static">
            <span className="stack">
              <span className="strong">{TILES[k].title}</span>
              <span className="caption">Move or resize it; it stays on every layout.</span>
            </span>
            <IPin />
          </div>
        ))}
        <p className="caption">{on.length} more {on.length === 1 ? 'tile' : 'tiles'} on your dashboard. Remove one from its ⋯ menu.</p>
      </section>
    </aside>
  );
}
