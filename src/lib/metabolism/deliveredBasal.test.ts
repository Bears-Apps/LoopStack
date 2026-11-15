import { describe, it, expect } from 'vitest';
import {
  deliveredBasalByDay,
  hasMeasuredBasal,
  measuredDays,
  MIN_TEMP_COVERAGE_MINUTES_PER_DAY,
} from './deliveredBasal';
import type { LoopTherapy } from '@/data/loopTherapy';

// A flat 1.0 U/hr schedule makes every expected total arithmetic: a full day is
// 24 U, and any temp's contribution is (rate − 1) × hours away from that.
const FLAT: LoopTherapy = {
  basalSchedule: [{ startMinutes: 0, value: 1 }],
} as unknown as LoopTherapy;

const day = (iso: string) => new Date(iso).getTime();

describe('deliveredBasalByDay', () => {
  it('integrates the schedule when no temps ran at all', () => {
    const start = day('2026-03-02T00:00:00');
    const out = deliveredBasalByDay([], FLAT, start, start + 24 * 3600_000);
    expect(out).toHaveLength(1);
    expect(out[0].units).toBeCloseTo(24, 1);
    expect(out[0].tempMinutes).toBe(0);
  });

  /**
   * The bug this module exists to fix. Loop spends the day running temps; the
   * old Nightscout path reported basal: 0 for the same day, which made the
   * Bolus share tile read 100%.
   */
  it('counts temp-basal delivery instead of reporting zero', () => {
    const start = day('2026-03-02T00:00:00');
    // Six hours at 2.0 U/hr (double schedule), rest at the 1.0 schedule.
    const out = deliveredBasalByDay(
      [{ iso: '2026-03-02T00:00:00', rateUPerHr: 2, durationMin: 360 }],
      FLAT,
      start,
      start + 24 * 3600_000,
    );
    // 6h × 2.0 + 18h × 1.0 = 30
    expect(out[0].units).toBeCloseTo(30, 1);
    expect(out[0].tempMinutes).toBe(360);
    expect(out[0].units).toBeGreaterThan(0);
  });

  it('honours a zero temp — insulin deliberately withheld is not schedule delivery', () => {
    const start = day('2026-03-02T00:00:00');
    const out = deliveredBasalByDay(
      [{ iso: '2026-03-02T00:00:00', rateUPerHr: 0, durationMin: 720 }],
      FLAT,
      start,
      start + 24 * 3600_000,
    );
    // 12h suspended + 12h × 1.0 = 12, NOT the 24 the schedule alone implies.
    expect(out[0].units).toBeCloseTo(12, 1);
  });

  it('lets a newer temp supersede a running one, as the pump does', () => {
    const start = day('2026-03-02T00:00:00');
    const out = deliveredBasalByDay(
      [
        { iso: '2026-03-02T00:00:00', rateUPerHr: 3, durationMin: 240 }, // 4h @3
        { iso: '2026-03-02T02:00:00', rateUPerHr: 0, durationMin: 120 }, // cancels at 2h
      ],
      FLAT,
      start,
      start + 24 * 3600_000,
    );
    // 2h@3 + 2h@0 + 20h@1 = 6 + 0 + 20 = 26. Stacking would have given more.
    expect(out[0].units).toBeCloseTo(26, 1);
  });

  it('splits delivery across day boundaries', () => {
    const start = day('2026-03-02T00:00:00');
    const out = deliveredBasalByDay([], FLAT, start, start + 3 * 24 * 3600_000);
    expect(out).toHaveLength(3);
    for (const d of out) expect(d.units).toBeCloseTo(24, 1);
  });

  it('returns nothing for an inverted or empty window', () => {
    const start = day('2026-03-02T00:00:00');
    expect(deliveredBasalByDay([], FLAT, start, start)).toEqual([]);
    expect(deliveredBasalByDay([], FLAT, start, start - 1000)).toEqual([]);
  });

  it('ignores malformed records rather than trusting them', () => {
    const start = day('2026-03-02T00:00:00');
    const out = deliveredBasalByDay(
      [
        { iso: 'not-a-date', rateUPerHr: 5, durationMin: 60 },
        { iso: '2026-03-02T00:00:00', rateUPerHr: 5, durationMin: 0 },
      ],
      FLAT,
      start,
      start + 24 * 3600_000,
    );
    expect(out[0].units).toBeCloseTo(24, 1);
    expect(out[0].tempMinutes).toBe(0);
  });
});

describe('hasMeasuredBasal — the measured/assumed line', () => {
  /**
   * The honesty guard. A window with no temp records integrates to exactly the
   * scheduled total; reporting that as measured delivery would present an
   * assumption as an observation, which is the specific failure the scheduled
   * fallback was introduced to avoid.
   */
  it('refuses to call a temp-free reconstruction measured', () => {
    const start = day('2026-04-06T00:00:00');
    const out = deliveredBasalByDay([], FLAT, start, start + 7 * 24 * 3600_000);
    expect(out).toHaveLength(7);
    out.forEach((d) => expect(d.units).toBeCloseTo(24, 1));
    expect(hasMeasuredBasal(out)).toBe(false);
    expect(measuredDays(out)).toEqual([]);
  });

  /**
   * Buckets are LOCAL calendar days, which is what "insulin per day" means to
   * the person reading it — so a spring-forward day really is 23 hours of
   * delivery and a 7×24h span really does touch 8 local days. Pinned because
   * the arithmetic looks like an off-by-one until you remember why.
   */
  it('buckets by local day across a DST transition', () => {
    const start = day('2026-03-02T00:00:00'); // US DST begins Mar 8, 2026
    const out = deliveredBasalByDay([], FLAT, start, start + 7 * 24 * 3600_000);
    expect(out.length).toBeGreaterThanOrEqual(7);
    const short = out.filter((d) => d.units < 23.5);
    expect(short.length).toBeGreaterThan(0);
    // Total delivery is still exactly the elapsed hours, however it is split.
    const total = out.reduce((a, d) => a + d.units, 0);
    expect(total).toBeCloseTo(7 * 24, 0);
  });

  it('accepts a window where most days carry real temp coverage', () => {
    const start = day('2026-03-02T00:00:00');
    const temps = [0, 1, 2, 3].map((i) => ({
      iso: new Date(start + i * 24 * 3600_000 + 3600_000).toISOString(),
      rateUPerHr: 1.4,
      durationMin: MIN_TEMP_COVERAGE_MINUTES_PER_DAY + 30,
    }));
    const out = deliveredBasalByDay(temps, FLAT, start, start + 7 * 24 * 3600_000);
    expect(hasMeasuredBasal(out)).toBe(true);
    expect(measuredDays(out)).toHaveLength(4);
  });

  it('treats an empty window as unmeasured', () => {
    expect(hasMeasuredBasal([])).toBe(false);
  });
});
