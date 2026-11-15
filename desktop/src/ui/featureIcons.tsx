// One icon per feature in the library, in the app's line style (kit.tsx):
// a 20-unit grid, 1.6 stroke, currentColor. Decorative: the card names the
// feature, so every icon is aria-hidden.
import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  // 🥜 delayed metabolic response: a peanut shell, and a late, low curve under it
  peanut: <g transform="rotate(-28 10 10)"><path d="M7.4 9.3A3.8 3.8 0 1 1 12.6 9.3C12.2 9.9 12.2 10.3 12.9 10.8A4.2 4.2 0 1 1 7.1 10.8C7.8 10.3 7.8 9.9 7.4 9.3z" /><path d="M9 5.6h.01M11 7h.01M9 13h.01M11.2 14.6h.01" /></g>,
  cloud: <><path d="M6 15h8.5a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.3 8 3.5 3.5 0 0 0 6 15z" /><path d="M8 12h4" /></>,
  star: <path d="M10 3.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 13.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />,
  history: <><path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6" /><path d="M3.5 3.5v3h3" /><path d="M10 6.5V10l2.5 1.5" /></>,
  layout: <><rect x="4" y="3" width="12" height="14" rx="2" /><path d="M7 7h6M7 10h6M7 13h3" /></>,
  premeal: <><circle cx="10" cy="11" r="5.5" /><path d="M10 8.5v5M7.5 11h5" /><path d="M8 3.5h4" /></>,
  clock: <><circle cx="10" cy="10" r="6.5" /><path d="M10 6v4h3" /><path d="M16.5 4.5l-1 1" /></>,
  bolt: <path d="M11 3L5 11h4.5L9 17l6-8h-4.5z" />,
  scale: <><path d="M4 16h12" /><path d="M10 4v12" /><path d="M5 7h10" /><path d="M5 7l-2 4.5h4zM15 7l-2 4.5h4z" /></>,
  profiles: <><circle cx="7.5" cy="7" r="2.5" /><path d="M3.5 15.5c.5-2.5 2-3.8 4-3.8s3.5 1.3 4 3.8" /><path d="M13 5.5h3.5M13 8.5h3.5M14 11.5h2.5" /></>,
  unlock: <><rect x="4.5" y="9" width="11" height="7.5" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 5.8-1" /><path d="M10 12v1.5" /></>,
  'basal-lock': <><path d="M3 13h3v-3h4v3h4v-2h3" /><rect x="12.5" y="3.5" width="5" height="4" rx="1" /><path d="M13.5 3.5V3a1.5 1.5 0 0 1 3 0v.5" /></>,
  damper: <><path d="M3 10h14" /><path d="M5 10c1.5-4 3-4 5 0s3.5 2.5 5 0" /><path d="M10 13.5v3M8.5 15h3" /></>,
  patch: <><rect x="3.5" y="5.5" width="13" height="9" rx="4.5" transform="rotate(-35 10 10)" /><path d="M9 9h.01M11 11h.01M9 11h.01M11 9h.01" /></>,
  library: <><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><path d="M14 11v6M11 14h6" /></>,
};

export function FeatureIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="feature-icon" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{PATHS[name] ?? PATHS.patch}</svg>
    </span>
  );
}

export const FEATURE_ICON_NAMES = Object.keys(PATHS);
