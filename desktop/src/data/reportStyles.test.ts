import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types
import { blocksChange, checkCopy } from '../../../scripts/system/core.mjs';
import { REPORT_STYLES, styleById } from './reportStyles';

describe('care-team report styles', () => {
  it('defaults to LoopStack, also for an unknown saved value', () => {
    expect(REPORT_STYLES[0].id).toBe('loopstack');
    expect(styleById('nope').id).toBe('loopstack');
    expect(styleById(null).id).toBe('loopstack');
  });
  it('every style covers glucose, Loop and settings, with unique sections', () => {
    for (const s of REPORT_STYLES) {
      const blocks = s.sections.flatMap((x) => x.blocks);
      for (const need of ['agp', 'insulin', 'explorer', 'timeline']) expect(blocks, `${s.id} ${need}`).toContain(need);
      expect(new Set(s.sections.map((x) => x.id)).size).toBe(s.sections.length);
    }
  });
  it('never borrows another system’s automation name for Loop', () => {
    for (const s of REPORT_STYLES) expect(JSON.stringify(s.terms)).not.toMatch(/SmartGuard|Control-IQ|Automated Mode/i);
  });
  it('every borrowed layout says it isn’t theirs, and the copy passes the gate', () => {
    for (const s of REPORT_STYLES.slice(1)) {
      expect(s.note).toMatch(/Not made by or affiliated with/);
      const blocking = (checkCopy(`${s.label}. ${s.note}`) as { code: string }[]).filter((f) => blocksChange(f));
      expect(blocking, s.id).toEqual([]);
    }
  });
});
