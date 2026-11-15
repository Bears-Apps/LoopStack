import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './state';
import { onDatasetChange } from './data/current';
import { boot } from './data/source';
import { bootLoopBuild } from './data/loopBuild';
import { loadWorkspace, resolvedAppearance } from './layout/saved';
// Tokens come from the LoopStack system, not a copy (COL-1).
import '../../src/styles/tokens.css';
import './styles/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

// Apply the saved appearance before any data connector can delay first paint.
try {
  const preference = loadWorkspace(window.localStorage).current.appearance;
  const theme = resolvedAppearance(preference, window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch { /* The shell still offers session-only appearance when storage is blocked. */ }

/** Remounts the app when the dataset changes, so every view and the shared thread start from the new data. */
function Root() {
  const [version, setVersion] = useState(0);
  useEffect(() => onDatasetChange(() => setVersion((v) => v + 1)), []);
  return (
    <StoreProvider key={version}>
      <App />
    </StoreProvider>
  );
}

// Read Nightscout first when connected, so the first paint is the person's own
// data rather than the sample patient's under the person's name.
if (window.loopstack?.nightscout) rootEl.innerHTML = '<p class="boot-note">Reading your Nightscout…</p>';
void bootLoopBuild().catch(() => undefined);
void boot().then((error) => {
  if (error) window.sessionStorage.setItem('loopstack.ns.error', error);
  createRoot(rootEl).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
