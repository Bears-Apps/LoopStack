import type { GlucoseReading } from '@/data/sources/types';

// Loop-mode tracking + override analysis.
//
// Loop posts a devicestatus heartbeat (~5 min) while closed loop is running.
// Time in "manual mode" = stretches where the heartbeat says not-looping, or
// goes silent — the moments the user has taken over. Overrides arrive as
// Nightscout "Temporary Override" treatments with a preset name + duration.
//
// The analysis answers two questions the user actually asked:
//   1. How much time am I spending in manual mode, and when?
//   2. Are my overrides working — and where would a better preset replace
//      ad-hoc manual control?
// All output copy stays in the pattern-support register: review/consider,
// never dose instructions.

export type LoopStatusEntry = {
  iso: string;
  /** True when the heartbeat reported an active closed-loop cycle. */
  looping: boolean;
};

export type OverrideEvent = {
  startIso: string;
  durationMin: number;
  /** Preset name, e.g. "Workout", "Illness" — '(unnamed)' when absent. */
  name: string;
};

export type OverrideOutcome = {
  name: string;
  count: number;
  totalMinutes: number;
  avgGlucose: number | null;
  tirPct: number | null;          // TIR 70–180 during the override windows
  baselineTirPct: number;         // TIR outside any override, same window
  deltaTir: number | null;        // tirPct − baseline
  verdict: 'working' | 'review' | 'building';
  note: string;
};

export type ManualEpisode = {
  startIso: string;
  minutes: number;
};

export type LoopModeSummary = {
  windowDays: number;
  /** Share of the window spent with closed loop confirmed running (0–100). */
  closedLoopPct: number;
  manualMinutesPerDay: number;
  manualEpisodeCount: number;
  longestManualMinutes: number;
  /** Local hour (0–23) where manual time clusters most, or null. */
  peakManualHour: number | null;
  overrideOutcomes: OverrideOutcome[];
  /** Evidence-phrased review lines. Empty until signals clear the gates. */
  suggestions: string[];
};

const HEARTBEAT_GAP_MIN = 15;       // silence longer than this = not looping
const EPISODE_MIN_MINUTES = 30;     // shorter manual blips aren't episodes
const MIN_OVERRIDE_COUNT = 3;       // occurrences before an outcome is judged
// Fallback only. The real boundaries come from Profile -> Targets, passed in
// by the caller: scoring override outcomes against 70-180 while the dashboard
// scores against the user's own range put two different "time in range"
// numbers on one screen with no way to tell them apart.
const DEFAULT_TIR_LOW = 70;
const DEFAULT_TIR_HIGH = 180;

const ms = (iso: string) => new Date(iso).getTime();

function tirOf(
  values: number[],
  low: number,
  high: number,
): number | null {
  if (values.length === 0) return null;
  const inRange = values.filter((v) => v >= low && v <= high).length;
  return Math.round((inRange / values.length) * 100);
}

export function computeLoopMode(input: {
  statuses: LoopStatusEntry[];
  overrides: OverrideEvent[];
  glucose: GlucoseReading[];
  windowDays: number;
  now: Date;
  /** In-range boundaries from Profile -> Targets. Omitted = consensus 70-180. */
  targetRange?: { lowMgdl: number; highMgdl: number };
}): LoopModeSummary {
  const { windowDays, now } = input;
  const tirLow = input.targetRange?.lowMgdl ?? DEFAULT_TIR_LOW;
  const tirHigh = input.targetRange?.highMgdl ?? DEFAULT_TIR_HIGH;
  const windowStartMs = now.getTime() - windowDays * 24 * 3600_000;
  const statuses = input.statuses
    .filter((s) => ms(s.iso) >= windowStartMs)
    .sort((a, b) => ms(a.iso) - ms(b.iso));

  // ── manual-time reconstruction from heartbeat intervals ──
  // Interval [s[i], s[i+1]] counts as looping only when s[i] was looping AND
  // the gap is a plausible heartbeat. Everything else is manual/uncovered.
  let loopingMs = 0;
  let manualMs = 0;
  const episodes: ManualEpisode[] = [];
  let episodeStartMs: number | null = null;
  let episodeMs = 0;

  const closeEpisode = () => {
    if (episodeStartMs != null && episodeMs / 60_000 >= EPISODE_MIN_MINUTES) {
      episodes.push({
        startIso: new Date(episodeStartMs).toISOString(),
        minutes: Math.round(episodeMs / 60_000),
      });
    }
    episodeStartMs = null;
    episodeMs = 0;
  };

  for (let i = 0; i < statuses.length - 1; i++) {
    const a = statuses[i];
    const gap = ms(statuses[i + 1].iso) - ms(a.iso);
    const isLooping = a.looping && gap <= HEARTBEAT_GAP_MIN * 60_000;
    if (isLooping) {
      loopingMs += gap;
      closeEpisode();
    } else {
      manualMs += gap;
      if (episodeStartMs == null) episodeStartMs = ms(a.iso);
      episodeMs += gap;
    }
  }
  closeEpisode();

  const coveredMs = loopingMs + manualMs;
  const closedLoopPct =
    coveredMs > 0 ? Math.round((loopingMs / coveredMs) * 100) : 0;
  const manualMinutesPerDay =
    coveredMs > 0 ? Math.round(manualMs / 60_000 / (coveredMs / (24 * 3600_000))) : 0;
  const longestManualMinutes = episodes.reduce((m, e) => Math.max(m, e.minutes), 0);

  // Peak manual hour — where episodes cluster (needs ≥2 episodes to mean much).
  let peakManualHour: number | null = null;
  if (episodes.length >= 2) {
    const byHour = new Map<number, number>();
    for (const e of episodes) {
      const h = new Date(e.startIso).getHours();
      byHour.set(h, (byHour.get(h) ?? 0) + e.minutes);
    }
    peakManualHour = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── override outcomes ──
  const windowGlucose = input.glucose.filter((g) => ms(g.iso) >= windowStartMs);
  const overrides = input.overrides.filter((o) => ms(o.startIso) >= windowStartMs);

  const inAnyOverride = (t: number) =>
    overrides.some(
      (o) => t >= ms(o.startIso) && t <= ms(o.startIso) + o.durationMin * 60_000,
    );
  const baselineValues = windowGlucose
    .filter((g) => !inAnyOverride(ms(g.iso)))
    .map((g) => g.mgdl);
  const baselineTirPct = tirOf(baselineValues, tirLow, tirHigh) ?? 0;

  const byName = new Map<string, OverrideEvent[]>();
  for (const o of overrides) {
    const key = o.name || '(unnamed)';
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(o);
  }

  const overrideOutcomes: OverrideOutcome[] = [...byName.entries()].map(
    ([name, events]) => {
      const values: number[] = [];
      let totalMinutes = 0;
      for (const o of events) {
        totalMinutes += o.durationMin;
        const start = ms(o.startIso);
        const end = start + o.durationMin * 60_000;
        for (const g of windowGlucose) {
          const t = ms(g.iso);
          if (t >= start && t <= end) values.push(g.mgdl);
        }
      }
      const tirPct = tirOf(values, tirLow, tirHigh);
      const avgGlucose =
        values.length > 0
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : null;
      const deltaTir = tirPct != null ? tirPct - baselineTirPct : null;

      let verdict: OverrideOutcome['verdict'] = 'building';
      let note = `${events.length} of ${MIN_OVERRIDE_COUNT} uses needed before this override is judged.`;
      if (events.length >= MIN_OVERRIDE_COUNT && tirPct != null && deltaTir != null) {
        if (deltaTir >= 5) {
          verdict = 'working';
          note = `Time in range ran ${deltaTir}% higher than baseline across ${events.length} uses — this override is earning its keep.`;
        } else if (deltaTir <= -10) {
          verdict = 'review';
          note = `Time in range ran ${Math.abs(deltaTir)}% lower than baseline across ${events.length} uses — the target or duration may not fit; worth reviewing with your care team.`;
        } else {
          verdict = 'working';
          note = `Outcomes track baseline across ${events.length} uses — no adjustment signal yet.`;
        }
      }
      return {
        name,
        count: events.length,
        totalMinutes,
        avgGlucose,
        tirPct,
        baselineTirPct,
        deltaTir,
        verdict,
        note,
      };
    },
  );
  overrideOutcomes.sort((a, b) => b.count - a.count);

  // ── suggestions (gated, pattern-support register) ──
  const suggestions: string[] = [];
  if (closedLoopPct < 85 && coveredMs > 3 * 24 * 3600_000) {
    suggestions.push(
      `Closed loop covered ${closedLoopPct}% of the last ${windowDays} days (~${manualMinutesPerDay} min/day manual). Patterns learn fastest with the loop closed — worth reviewing what pulls you out.`,
    );
  }
  if (peakManualHour != null && episodes.length >= 3) {
    const hh = `${peakManualHour}:00–${(peakManualHour + 1) % 24}:00`;
    suggestions.push(
      `Manual stretches cluster around ${hh} (${episodes.length} episodes). A dedicated override preset for that window could cover the same need without leaving closed loop.`,
    );
  }
  for (const o of overrideOutcomes) {
    if (o.verdict === 'review') {
      suggestions.push(`"${o.name}" override: ${o.note}`);
    }
  }

  return {
    windowDays,
    closedLoopPct,
    manualMinutesPerDay,
    manualEpisodeCount: episodes.length,
    longestManualMinutes,
    peakManualHour,
    overrideOutcomes,
    suggestions,
  };
}
