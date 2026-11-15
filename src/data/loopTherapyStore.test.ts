import { describe, expect, it } from 'vitest';
import {
  applyTherapyOverrides,
  toEditable,
  validateTherapy,
  type EditableTherapy,
} from './loopTherapyStore';
import type { ClinicalSettings } from './types';

const clinical: ClinicalSettings = {
  urgentLowMgdl: 54,
  targetLowMgdl: 70,
  targetHighMgdl: 180,
  baseIsf: 50,
  observedIsf: 54,
  carbRatio: 10,
  insulinDurationHours: 5,
};

const editable = (patch: Partial<EditableTherapy> = {}): EditableTherapy => ({
  ...toEditable(clinical),
  ...patch,
});

describe('validateTherapy', () => {
  it('accepts a value inside its limits', () => {
    expect(validateTherapy(editable({ targetLowMgdl: 80 }), 'targetLowMgdl')).toEqual({
      ok: true,
    });
  });

  it('rejects a value below its limit', () => {
    const result = validateTherapy(editable({ baseIsf: 1 }), 'baseIsf');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/Base ISF must be between/);
  });

  it('rejects a value above its limit', () => {
    expect(validateTherapy(editable({ carbRatio: 500 }), 'carbRatio').ok).toBe(false);
  });

  it('rejects a non-numeric entry', () => {
    const result = validateTherapy(editable({ carbRatio: NaN }), 'carbRatio');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/needs a number/);
  });

  it('rejects an inverted target range', () => {
    const result = validateTherapy(
      editable({ targetLowMgdl: 160, targetHighMgdl: 120 }),
      'targetLowMgdl',
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/at least 10 mg\/dL/);
  });

  it('rejects a target range narrower than the minimum spread', () => {
    expect(
      validateTherapy(
        editable({ targetLowMgdl: 100, targetHighMgdl: 105 }),
        'targetHighMgdl',
      ).ok,
    ).toBe(false);
  });

  it('accepts a tight but legal target range', () => {
    expect(
      validateTherapy(
        editable({ targetLowMgdl: 100, targetHighMgdl: 110 }),
        'targetHighMgdl',
      ).ok,
    ).toBe(true);
  });
});

describe('applyTherapyOverrides', () => {
  it('returns the profile untouched when nothing is stored', () => {
    expect(applyTherapyOverrides(clinical, null)).toEqual(clinical);
  });

  it('layers stored values over the profile without losing derived ones', () => {
    const merged = applyTherapyOverrides(
      clinical,
      editable({ targetLowMgdl: 80, targetHighMgdl: 160 }),
    );
    expect(merged.targetLowMgdl).toBe(80);
    expect(merged.targetHighMgdl).toBe(160);
    // Observed ISF is derived from data and must survive a manual edit.
    expect(merged.observedIsf).toBe(54);
  });
});
