import { describe, expect, it } from 'vitest';
import { blockDayState, blocks, count, hourVerdict, median, morningGlucose, peak, rangeLabel, select, stretchFor, USABLE_N } from './derive';
import { LUNCH } from './current';

describe('x of 13', () => {
  it('counts usable days only', () => {
    expect(USABLE_N).toBe(13);
  });
  it('matches the boards', () => {
    expect(count(6, 'l')).toBe(11);
    expect(count(7, 'l')).toBe(10);
    expect(count(8, 'l')).toBe(2);
    expect(count(19, 'm')).toBe(7);
    expect(count(20, 'm')).toBe(8);
  });
  it('gives the sheet its numbers for 7am', () => {
    const s = select('hours', 7);
    expect(s).toMatchObject({ sched: 0.92, loop: 0.57, verdict: 'l', n: 10 });
    expect(s.others).toEqual(['Sun 1', 'Wed 4', 'Sat 7']);
  });
});

describe('verdicts and stretches', () => {
  it('reads each hour as the table does', () => {
    expect(hourVerdict(6)).toBe('l');
    expect(hourVerdict(8)).toBe('a');
    expect(hourVerdict(15)).toBe('s');
    expect(hourVerdict(19)).toBe('m');
  });
  it('groups neighbouring hours', () => {
    expect(stretchFor(7)).toEqual([6, 8]);
    expect(stretchFor(20)).toEqual([19, 21]);
    expect(stretchFor(16)).toEqual([15, 18]);
    expect(stretchFor(2)).toEqual([2, 3]);
    expect(rangeLabel(6, 8)).toBe('6–8am');
    expect(rangeLabel(11, 13)).toBe('11am–1pm');
    expect(rangeLabel(21, 24)).toBe('9pm–12am');
  });
});

describe('3-hour blocks', () => {
  const b = blocks();
  it('makes 8 blocks over 24 hours', () => {
    expect(b).toHaveLength(8);
    expect(b.map((x) => x.start)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
  });
  it('takes a day state from two of three hours', () => {
    expect(blockDayState(['l', 'l', 'a'])).toBe('l');
    expect(blockDayState(['l', 'a', 'm'])).toBe('a');
    expect(blockDayState(['s', 's', 'l'])).toBe('s');
    expect(blockDayState(['x', 'x', 'x'])).toBe('x');
  });
  it('averages the hourly medians and counts days', () => {
    const morning = b[2];
    expect(morning.sched).toBe(0.92);
    expect(morning.loop).toBe(0.66);
    expect(morning.verdict).toBe('l');
    expect(morning.counts.l).toBe(10);
    expect(b[5].verdict).toBe('s');
    expect(b[5].counts.s).toBe(2);
    expect(b[6].verdict).toBe('m');
    expect(b[6].counts.m).toBe(7);
    for (const blk of b) expect(Object.values(blk.counts).reduce((t, n) => t + n, 0)).toBe(13);
  });
  it('shows the not-counted night as no data', () => {
    expect(b[0].states['Sun 8']).toBe('x');
    expect(b[1].states['Sun 8']).toBe('x');
  });
});

describe('morning medians', () => {
  it('splits 6am glucose by what Loop did', () => {
    const m = morningGlucose(6);
    expect(m.less).toHaveLength(11);
    expect(m.lessMedian).toBe(94);
    expect(m.about).toEqual([127, 131]);
    expect(m.aboutMedian).toBe(129);
  });
  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('finds the lunch peaks', () => {
    expect(peak(LUNCH.before)).toEqual([13.5, 212]);
    expect(peak(LUNCH.after)).toEqual([13.5, 192]);
  });
});
