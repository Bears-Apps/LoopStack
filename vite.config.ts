// vitest/config re-exports vite's defineConfig with the `test` key added, so
// one config can carry both. Importing from 'vite' silently type-errors on
// `test` while still running, which is how the worktree exclusion below was
// accepted at runtime and rejected by tsc.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Relative base so assets resolve from the bundled web-dir inside the
  // Capacitor iOS WKWebView (loaded via capacitor://localhost) and from any
  // static host equally well.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  test: {
    // Agent worktrees live under .claude/worktrees/ — inside the project, so
    // the default glob picks up a full copy of the suite per worktree and runs
    // the same tests three or four times over. Excluded here rather than moved,
    // because their location is the tool's business, not this project's.
    // Electron's node:test suites run via desktop:test, not Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', 'desktop/electron/test/**'],
  },
});
