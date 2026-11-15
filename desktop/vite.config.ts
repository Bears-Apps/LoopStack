// LoopStack desktop renderer. One Vite + React build, two outputs:
//   desktop/dist      the Electron app loads this (default mode)
//   desktop/dist-web  a static browser demo for the portfolio (--mode web)
// It uses the root repo's react, vite and vitest, so the phone app's build is untouched.
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The production page carries its own CSP, so the static web build is locked
// down too. Dev is left without it: Vite's hot reload injects inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'loopstack-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig(({ mode }) => ({
  root: __dirname,
  base: './',
  plugins: [react(), csp()],
  // The phone app's pure metrics (heads-ups, the weekday grid) are reused, not copied.
  resolve: { alias: { '@': path.resolve(__dirname, '..', 'src') } },
  build: {
    outDir: path.resolve(__dirname, mode === 'web' ? 'dist-web' : 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5190,
    strictPort: true,
    // tokens.css lives in the phone app's src/ one level up.
    fs: { allow: [path.resolve(__dirname, '..')] },
  },
  test: {
    root: __dirname,
    include: ['src/**/*.test.ts'],
  },
}));
