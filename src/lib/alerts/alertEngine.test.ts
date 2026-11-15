import { describe, expect, it } from 'vitest';
import {
  ALERT_CATEGORIES,
  buildAlerts,
  collectConfidenceSignals,
  nextOccurrence,
  RISK_LEAD_HOURS,
  type AlertCategory,
} from './alertEngine';
import { computeDayHourGrid } from '@/lib/metrics/dayHourGrid';
import type { RiskWindow } from './riskWindows';
import type { BasalInsights } from '@/lib/metabolism/basalInsights';
import type { Autosens } from '@/lib/metabolism/autosens';
import type { AutotuneResult } from '@/lib/metabolism/autotune';
import type { SettingsReview } from '@/lib/metabolism/settingsReview';

// A Wednesday at noon.
const NOW = new Date(2026, 7, 12, 12, 0, 0);

const allOn: Record<AlertCategory, boolean> = {
  risk_window: true,
  trend_confidence: true,
  overnight_drift: true,
  sensitivity_shift: true,
  data_health: true,
  day_report: true,
  trend_heads_up: true,
};
const allOff: Record<AlertCategory, boolean> = {
  risk_window: false,
  trend_confidence: false,
  overnight_drift: false,
  sensitivity_shift: false,
  data_health: false,
  day_report: false,
  trend_heads_up: false,
};

const fridayLow: RiskWindow = {
  id: 'low_5_15_16',
  kind: 'low',
  weekday: 5,
  startHour: 15,
  endHour: 16,
  occurrences: 5,
  weeksObserved: 6,
  recurrencePct: 83,
  extremeMgdl: 52,
  confidence: 'good',
  label: 'Fridays around 3pm',
};

const build = (over: Partial<Parameters<typeof buildAlerts>[0]> = {}) =>
  buildAlerts({
    riskWindows: [],
    newlyReadable: [],
    basal: null,
    autosens: null,
    autotune: null,
    latestGlucoseIso: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    enabled: allOn,
    now: NOW,
    ...over,
  });

describe('nextOccurrence', () => {
  it('finds the next Friday 3pm, two hours ahead', () => {
    const fire = nextOccurrence(5, 15, 2, NOW);
    expect(fire.getDay()).toBe(5);
    expect(fire.getHours()).toBe(13);
    expect(fire.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('rolls to tomorrow when today’s slot has passed', () => {
    const fire = nextOccurrence(null, 9, 1, NOW); // 8am lead, already gone
    expect(fire.getTime()).toBeGreaterThan(NOW.getTime());
    expect(fire.getDate()).toBe(NOW.getDate() + 1);
  });

  it('uses today when the slot is still ahead', () => {
    const fire = nextOccurrence(null, 21, 2, NOW); // 7pm today
    expect(fire.getDate()).toBe(NOW.getDate());
    expect(fire.getHours()).toBe(19);
  });

  it('always returns a future time', () => {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (const hour of [0, 6, 12, 18, 23]) {
        for (const lead of RISK_LEAD_HOURS) {
          expect(nextOccurrence(weekday, hour, lead, NOW).getTime()).toBeGreaterThan(
            NOW.getTime(),
          );
        }
      }
    }
  });
});

describe('risk-window alerts', () => {
  it('schedules one alert per lead time', () => {
    const alerts = build({ riskWindows: [fridayLow] });
    const risk = alerts.filter((a) => a.category === 'risk_window');
    expect(risk).toHaveLength(RISK_LEAD_HOURS.length);
    expect(new Set(risk.map((a) => a.id)).size).toBe(risk.length);
  });

  it('names the pattern and the evidence behind it', () => {
    const a = build({ riskWindows: [fridayLow] })[0];
    expect(a.title).toContain('Fridays');
    expect(a.body).toContain('5 of the last 6 weeks');
    expect(a.body).toContain('52 mg/dL');
  });

  it('repeats weekly for a weekday pattern', () => {
    expect(build({ riskWindows: [fridayLow] })[0].repeatsWeekly).toBe(true);
  });

  it('does not repeat weekly for an every-day pattern', () => {
    const everyDay: RiskWindow = { ...fridayLow, weekday: null, id: 'low_all_15_16' };
    expect(build({ riskWindows: [everyDay] })[0].repeatsWeekly).toBe(false);
  });

  it('skips windows that have not reached confidence', () => {
    const thin: RiskWindow = { ...fridayLow, confidence: 'limited' };
    expect(build({ riskWindows: [thin] }).filter((a) => a.category === 'risk_window')).toHaveLength(
      0,
    );
  });

  it('caps how many windows get scheduled', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...fridayLow,
      id: `low_${i}_9_10`,
      startHour: 9,
      weekday: i % 7,
    }));
    const risk = build({ riskWindows: many }).filter((a) => a.category === 'risk_window');
    expect(risk.length).toBeLessThanOrEqual(4 * RISK_LEAD_HOURS.length);
  });

  it('handles a high window as well as a low one', () => {
    const high: RiskWindow = { ...fridayLow, kind: 'high', extremeMgdl: 260, id: 'high_5_21_22' };
    const a = build({ riskWindows: [high] })[0];
    expect(a.title).toContain('high');
    expect(a.body).toContain('260 mg/dL');
  });
});

describe('confidence signals', () => {
  const settings = {
    windowDays: 21,
    items: [
      {
        id: 'maxBasal',
        label: 'Max basal rate',
        current: '3 U/hr',
        reading: "Loop's highest temp: 1.4 U/hr",
        confidence: 'good',
        evidence: '40 temp basals',
        note: 'x',
        deepDive: null,
      },
      {
        id: 'insulinDuration',
        label: 'Insulin duration',
        current: '6 h',
        reading: null,
        confidence: 'unusable',
        evidence: 'none',
        note: 'x',
        deepDive: null,
      },
    ],
  } as unknown as SettingsReview;

  it('marks readable settings readable and unreadable ones not', () => {
    const signals = collectConfidenceSignals({
      settings,
      absorption: null,
      riskWindows: [],
    });
    expect(signals.find((s) => s.id === 'setting:maxBasal')!.readable).toBe(true);
    expect(signals.find((s) => s.id === 'setting:insulinDuration')!.readable).toBe(false);
  });

  it('tracks absorption presets and risk windows too', () => {
    const signals = collectConfidenceSignals({
      settings: null,
      absorption: {
        presets: [
          { presetHours: 6, verdict: 'outlasts' },
          {
            presetHours: 8,
            verdict: 'matches',
            modelKind: 'heavy',
            modelLabel: '🍲 long-tail curve',
          },
        ],
      } as unknown as import('@/lib/metabolism/absorptionProfile').AbsorptionInsights,
      riskWindows: [fridayLow],
    });
    expect(signals.find((s) => s.id === 'preset:6')!.readable).toBe(true);
    expect(signals.find((s) => s.id === 'preset:6')!.detail).toContain('run longer');
    // Marked-curve groups are individual cases with their own id and name.
    expect(signals.find((s) => s.id === 'preset:8:heavy')!.readable).toBe(true);
    expect(signals.find((s) => s.id === 'preset:8:heavy')!.detail).toContain('long-tail');
    expect(signals.find((s) => s.id === 'risk:low_5_15_16')!.readable).toBe(true);
  });

  it('fires an alert for each newly readable signal', () => {
    const alerts = build({
      newlyReadable: [
        { id: 'setting:maxBasal', label: 'Max basal rate', readable: true, detail: 'It reads now.' },
      ],
    });
    const c = alerts.filter((a) => a.category === 'trend_confidence');
    expect(c).toHaveLength(1);
    expect(c[0].title).toBe('New trend confidence reached');
    expect(c[0].body).toContain('It reads now.');
  });
});

describe('overnight drift', () => {
  const basal = (over: Partial<BasalInsights['blocks'][number]>) =>
    ({
      blocks: [
        {
          label: 'Overnight',
          startHour: 0,
          endHour: 6,
          windowCount: 6,
          avgDriftPerHour: 9,
          consistencyPct: 83,
          verdict: 'drifts_up',
          scheduledRate: 0.8,
          note: '',
          ...over,
        },
      ],
    }) as unknown as BasalInsights;

  it('schedules an evening heads-up for a consistent drift', () => {
    const a = build({ basal: basal({}) }).find((x) => x.category === 'overnight_drift')!;
    expect(a).toBeDefined();
    expect(new Date(a.fireAtIso).getHours()).toBe(21);
    expect(a.body).toContain('6 quiet nights');
  });

  it('stays quiet when the block holds steady', () => {
    const flat = basal({ verdict: 'flat' });
    expect(build({ basal: flat }).filter((a) => a.category === 'overnight_drift')).toHaveLength(0);
  });

  it('stays quiet when the drift is inconsistent', () => {
    const noisy = basal({ consistencyPct: 40 });
    expect(build({ basal: noisy }).filter((a) => a.category === 'overnight_drift')).toHaveLength(0);
  });
});

describe('sensitivity shift', () => {
  const autosens = (over: Partial<Autosens>) =>
    ({
      ratio: 0.85,
      clamped: false,
      rawRatio: 0.85,
      verdict: 'sensitive',
      medianDeviation: -1,
      negativeSharePct: 70,
      cleanStepCount: 200,
      excludedStepCount: 40,
      hoursAnalysed: 24,
      baselineIsf: 44,
      note: '',
      ...over,
    }) as Autosens;

  it('flags a sustained sensitive run as context', () => {
    const a = build({ autosens: autosens({}) }).find((x) => x.category === 'sensitivity_shift')!;
    expect(a.title).toContain('sensitive');
    expect(a.body).toContain('Loop already accounts for this');
  });

  it('stays quiet when sensitivity is as expected', () => {
    const steady = autosens({ verdict: 'as_expected', ratio: 1 });
    expect(build({ autosens: steady }).filter((a) => a.category === 'sensitivity_shift')).toHaveLength(0);
  });

  it('stays quiet when the ratio is pinned at a clamp', () => {
    // A clamped value reflects missing data more than a real shift.
    const clamped = autosens({ clamped: true });
    expect(build({ autosens: clamped }).filter((a) => a.category === 'sensitivity_shift')).toHaveLength(0);
  });
});

describe('data health', () => {
  it('warns when glucose has gone quiet', () => {
    const a = build({
      latestGlucoseIso: new Date(NOW.getTime() - 8 * 3600_000).toISOString(),
    }).find((x) => x.id === 'data_quiet')!;
    expect(a).toBeDefined();
    expect(a.body).toContain('8h');
    expect(a.body).toContain('stale');
  });

  it('warns when no glucose has ever arrived', () => {
    const a = build({ latestGlucoseIso: null }).find((x) => x.id === 'data_quiet')!;
    expect(a.body).toContain('at all');
  });

  it('stays quiet when data is fresh', () => {
    expect(build().filter((a) => a.id === 'data_quiet')).toHaveLength(0);
  });

  it('warns when insulin records are running short of Loop', () => {
    const autotune = {
      iobAgreement: {
        sampleCount: 400,
        meanAbsDiffU: 1.2,
        agreementPct: 40,
        biasU: -1.1,
        trustworthy: false,
        note: '',
      },
    } as unknown as AutotuneResult;
    const a = build({ autotune }).find((x) => x.id === 'data_iob_gap')!;
    expect(a.body).toContain('temp basals not uploading');
  });

  it('stays quiet when the reconstruction agrees with Loop', () => {
    const autotune = {
      iobAgreement: {
        sampleCount: 400,
        meanAbsDiffU: 0.1,
        agreementPct: 95,
        biasU: 0.02,
        trustworthy: true,
        note: '',
      },
    } as unknown as AutotuneResult;
    expect(build({ autotune }).filter((a) => a.id === 'data_iob_gap')).toHaveLength(0);
  });
});

describe('category toggles', () => {
  it('emits nothing when every category is off', () => {
    expect(
      build({
        enabled: allOff,
        riskWindows: [fridayLow],
        latestGlucoseIso: null,
        newlyReadable: [{ id: 'x', label: 'x', readable: true, detail: 'x' }],
      }),
    ).toHaveLength(0);
  });

  it('honours one category at a time', () => {
    const only = { ...allOff, risk_window: true };
    const alerts = build({ enabled: only, riskWindows: [fridayLow], latestGlucoseIso: null });
    expect(alerts.every((a) => a.category === 'risk_window')).toBe(true);
  });

  it('lists every category it can emit', () => {
    const emitted = new Set(
      build({
        riskWindows: [fridayLow],
        latestGlucoseIso: null,
        newlyReadable: [{ id: 'x', label: 'x', readable: true, detail: 'x' }],
        basal: {
          blocks: [
            {
              label: 'Overnight',
              verdict: 'drifts_up',
              consistencyPct: 80,
              windowCount: 5,
              avgDriftPerHour: 8,
            },
          ],
        } as unknown as BasalInsights,
        autosens: { verdict: 'resistant', ratio: 1.15, clamped: false, hoursAnalysed: 24 } as Autosens,
        // The morning report needs a grid to have anything to report. Built
        // from real readings rather than stubbed, so this also proves the
        // engine and the grid agree on shape.
        dayHourGrid: reportableGrid(),
      }).map((a) => a.category),
    );
    for (const c of ALERT_CATEGORIES) expect(emitted.has(c.id)).toBe(true);
  });
});

/**
 * A grid with one weekday that reliably runs high — enough for the engine to
 * have a report worth sending.
 */
function reportableGrid() {
  // Must be NOW, not the real clock: buildAlerts is called with the fixed NOW,
  // and a grid built against real time would sit entirely in its future.
  const now = NOW;
  const glucose: { iso: string; mgdl: number }[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  let found = 0;
  while (found < 6) {
    if (cursor.getDay() === 2) {
      for (const hour of [14, 15, 16]) {
        for (let k = 0; k < 8; k += 1) {
          const d = new Date(cursor);
          d.setHours(hour, k * 7, 0, 0);
          if (d <= now) glucose.push({ iso: d.toISOString(), mgdl: 240 });
        }
      }
      found += 1;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return computeDayHourGrid({
    glucose,
    target: { lowMgdl: 65, highMgdl: 180, urgentLowMgdl: 60 },
    now,
  });
}

describe('safety contract', () => {
  it('never instructs a dose or a settings change in any notification', () => {
    const alerts = build({
      riskWindows: [fridayLow, { ...fridayLow, kind: 'high', id: 'high_2_21_22', extremeMgdl: 250 }],
      newlyReadable: [{ id: 'x', label: 'Carb ratios', readable: true, detail: 'Carb ratios now read ~30.' }],
      basal: {
        blocks: [
          {
            label: 'Overnight',
            verdict: 'drifts_up',
            consistencyPct: 80,
            windowCount: 5,
            avgDriftPerHour: 8,
          },
        ],
      } as unknown as BasalInsights,
      autosens: { verdict: 'sensitive', ratio: 0.85, clamped: false, hoursAnalysed: 24 } as Autosens,
      latestGlucoseIso: null,
      // Morning report and heads-up copy go through the same check.
      dayHourGrid: reportableGrid(),
    });
    expect(alerts.some((a) => a.category === 'trend_heads_up')).toBe(true);
    // A heads-up or a morning report opens its weekday's hours when tapped.
    for (const a of alerts.filter((x) => x.category === 'trend_heads_up' || x.category === 'day_report')) {
      expect(a.route).toMatch(/^\/app\/weekday\?day=\d/);
    }
    expect(alerts.find((x) => x.category === 'trend_heads_up')!.route).toContain('&from=');

    const banned = [
      /take \d/i,
      /\bmake insulin decisions\b/i,
      /\byou should\b/i,
      /\bmust\b/i,
      /\brecommend\b/i,
      /\bcorrect (with|now)\b/i,
      /\beat \d/i,
      /\d+(\.\d+)?\s*units?\b/i,
      /\bgrams? of (fast|carb)/i,
      /(increase|decrease|raise|lower|adjust|set|change) (your |the )?(basal|bolus|dose|isf|carb ratio|insulin)/i,
    ];
    expect(alerts.length).toBeGreaterThan(4);
    for (const a of alerts) {
      for (const re of banned) {
        expect(`${a.title} ${a.body}`, `"${a.title}" / "${a.body}"`).not.toMatch(re);
      }
    }
  });

  it('frames a predicted window as a heads-up, not a directive', () => {
    const a = build({ riskWindows: [fridayLow] })[0];
    expect(a.body).toContain('not a recommendation');
  });
});
