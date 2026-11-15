// The person's Loop build on GitHub (desktop app only). The main process holds
// the token and talks to GitHub (electron/github.cjs); this keeps the last
// status read so the Settings panel and the Device life tile agree.
import { useEffect, useState } from 'react';

export interface Run { id: number; status: string; conclusion: string | null; event: string; createdAt: string; url: string }
export interface LoopBuildStatus {
  owner: string;
  repo: string;
  branch: string;
  htmlUrl: string;
  isFork: boolean;
  parent: string | null;
  loopVersion: string | null;
  /** Files in patches/, applied to every build. */
  patches: string[];
  /** Loop and Learn customizations named in the build workflow. */
  customizations: string[];
  workflow: { state: string; url: string } | null;
  latestRun: Run | null;
  lastBuild: Run | null;
  testflightExpiresAt: string | null;
  readAt: string;
}
export interface Commit { sha: string; date: string | null; message: string }
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface GithubBridge {
  config: () => Promise<{ connected: boolean; owner: string; repo: string; branch: string }>;
  connect: (input: { token: string; repo: string; branch: string }) => Promise<Result<{ warnings: string[] }>>;
  status: () => Promise<Result<{ status: LoopBuildStatus }>>;
  build: () => Promise<Result<object>>;
  commits: () => Promise<Result<{ commits: Commit[] }>>;
  disconnect: () => Promise<{ ok: true }>;
}

export const githubBridge = (): GithubBridge | null => window.loopstack?.github ?? null;

let current: LoopBuildStatus | null = null;
const subs = new Set<(s: LoopBuildStatus | null) => void>();
export function setLoopBuild(s: LoopBuildStatus | null) {
  current = s;
  for (const f of subs) f(s);
}
export function useLoopBuild(): LoopBuildStatus | null {
  const [s, set] = useState(current);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return s;
}

/** Read the build status once at launch when connected; failures stay quiet until Settings is opened. */
export async function bootLoopBuild(): Promise<void> {
  const b = githubBridge();
  if (!b) return;
  const c = await b.config();
  if (!c.connected) return;
  const r = await b.status();
  if (r.ok) setLoopBuild(r.status);
}

/** Whole days until the TestFlight build expires; negative once it has. */
export const daysLeft = (s: LoopBuildStatus | null, now = Date.now()) =>
  s?.testflightExpiresAt ? Math.floor((Date.parse(s.testflightExpiresAt) - now) / 86_400_000) : null;
