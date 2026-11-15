import { useState } from 'react';
import { applyView, deleteView, isAppearance, isDirty, renameView, saveNewView, updateView, type Workspace } from './saved';

/** Display preferences only. Health, account and therapy stores never enter this component. */
export function LayoutControls({ state, onChange, onReset, onClose }: {
  state: Workspace; onChange: (next: Workspace) => void; onReset: () => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const active = state.saved.find(v => v.id === state.activeId);
  const action = (run: () => Workspace, done: string) => {
    try { onChange(run()); setError(''); setMessage(done); setDeleting(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this layout. Try again.'); }
  };
  return (
    <section className="layout-controls" id="layout-controls" aria-labelledby="layouts-heading">
      <div className="row between">
        <div className="stack-4">
          <h2 id="layouts-heading" className="h3">Saved layouts</h2>
          <p className="small">Keep different views of your widgets. Changes stay in your working view until you update a saved layout.</p>
        </div>
        <button type="button" className="quiet-btn" onClick={onClose}>Close layouts</button>
      </div>
      <div className="layout-fields">
        <label className="stack-4">Appearance
          <select aria-label="Appearance" value={state.current.appearance} onChange={e => {
            if (isAppearance(e.target.value)) onChange({ ...state, current: { ...state.current, appearance: e.target.value } });
          }}>
            <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
          </select>
        </label>
        <label className="stack-4">Switch layout
          <select aria-label="Switch layout" value={state.activeId ?? ''} onChange={e => {
            if (e.target.value) action(() => applyView(state, e.target.value), 'Saved layout applied.');
          }}>
            <option value="" disabled>Working view</option>
            {state.saved.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="stack-4">Layout name
          <input value={name} maxLength={60} placeholder="For example, Evening" onChange={e => setName(e.target.value)} />
        </label>
      </div>
      <p className="caption">{active ? `${active.name}${isDirty(state) ? ' has unsaved changes.' : ' matches your working view.'}` : 'Your working view is restored when you reopen the app.'} Order, size, visible widgets, hour-view settings and appearance only. No health data is saved here.</p>
      <div className="row wrap">
        <button type="button" className="solid-btn" onClick={() => action(() => saveNewView(state, name, crypto.randomUUID()), 'New layout saved.')}>Save as new</button>
        <button type="button" className="quiet-btn" disabled={!active || !isDirty(state)} onClick={() => action(() => updateView(state), 'Saved layout updated.')}>Update saved layout</button>
        <button type="button" className="text-btn" disabled={!active || !isDirty(state)} onClick={() => action(() => applyView(state, active!.id), 'Saved layout restored.')}>Revert changes</button>
        <button type="button" className="quiet-btn" disabled={!active} onClick={() => action(() => renameView(state, active!.id, name), 'Layout renamed.')}>Rename</button>
        <button type="button" className="text-btn" disabled={!active} onClick={() => setDeleting(true)}>Delete layout</button>
        <button type="button" className="text-btn" onClick={() => { onReset(); setDeleting(false); setMessage('Default dashboard restored. Saved layouts were kept.'); }}>Reset working view</button>
      </div>
      {deleting && active && <div className="row wrap" role="group" aria-label="Confirm layout deletion">
        <p className="small">Delete “{active.name}”? Your current widgets stay in place.</p>
        <button type="button" className="quiet-btn" onClick={() => action(() => deleteView(state, active.id), 'Saved layout deleted. Current widgets were kept.')}>Confirm delete</button>
        <button type="button" className="text-btn" onClick={() => setDeleting(false)}>Cancel</button>
      </div>}
      {state.saved.length === 0 && <p className="small">No saved layouts yet. Arrange your widgets, choose an appearance, then save a name.</p>}
      {error && <p role="alert" className="small">{error}</p>}
      <p role="status" className="caption">{message}</p>
    </section>
  );
}
