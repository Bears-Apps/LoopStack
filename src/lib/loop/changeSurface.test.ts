import { describe, expect, it } from 'vitest';
import {
  buildClaudeHandoff,
  SURFACE_BLURBS,
  SURFACE_LABELS,
  surfaceFor,
  type ChangeSurface,
} from './changeSurface';
import type { FixLogChangeKind } from '@/data/types';

const ALL_KINDS: FixLogChangeKind[] = [
  'isf',
  'carb_ratio',
  'absorption_window',
  'favorite_carbs',
  'schedule_override',
  'timing_split',
];

const handoff = (over: Partial<Parameters<typeof buildClaudeHandoff>[0]> = {}) =>
  buildClaudeHandoff({
    title: 'Late pasta absorption: 3h → 5h',
    change: {
      kind: 'absorption_window',
      label: 'Late pasta absorption',
      currentValue: '3h',
      proposedValue: '5h',
    },
    explanation: 'The late-dinner pattern showed a second rise past three hours.',
    rationale: ['12 late-pasta dinners in 30 days', 'Second rise in 9 of 12'],
    confidence: 'high',
    confidenceScore: 86,
    ...over,
  });

describe('surface classification', () => {
  it('routes every change kind somewhere', () => {
    for (const kind of ALL_KINDS) {
      const s = surfaceFor(kind);
      expect(SURFACE_LABELS[s]).toBeTruthy();
      expect(SURFACE_BLURBS[s]).toBeTruthy();
    }
  });

  it('sends schedules and ratios to Loop settings', () => {
    for (const kind of ['isf', 'carb_ratio', 'schedule_override'] as FixLogChangeKind[]) {
      expect(surfaceFor(kind)).toBe<ChangeSurface>('settings');
    }
  });

  it('sends absorption presets to the source, since they are compiled in', () => {
    expect(surfaceFor('absorption_window')).toBe<ChangeSurface>('code');
  });

  it('treats a timing split as a habit, not a change to make anywhere', () => {
    expect(surfaceFor('timing_split')).toBe<ChangeSurface>('behaviour');
  });
});

describe('the Claude handoff', () => {
  const h = handoff();

  it('states the change with both values and the evidence grade', () => {
    expect(h.prompt).toContain('Current: 3h');
    expect(h.prompt).toContain('Proposed: 5h');
    expect(h.prompt).toContain('high (86/100)');
  });

  it('gives an assistant with no LoopStack context what it needs', () => {
    expect(h.prompt).toContain('DIY Loop');
    expect(h.prompt).toContain('read-only');
    expect(h.prompt).toContain('never writes');
  });

  it('carries the evidence, not just the number', () => {
    expect(h.prompt).toContain('12 late-pasta dinners in 30 days');
    expect(h.prompt).toContain('Second rise in 9 of 12');
  });

  it('points at where the value lives when that is known', () => {
    expect(h.prompt).toContain('LoopKit');
    expect(h.prompt).toContain('defaultAbsorptionTimes');
  });

  it('omits the location line rather than guessing for other kinds', () => {
    const settings = handoff({
      change: { kind: 'isf', label: 'Base ISF', currentValue: '50', proposedValue: '54' },
    });
    expect(settings.prompt).not.toContain('Likely location');
  });

  it('fences the assistant off from dosing logic', () => {
    expect(h.prompt).toContain('Do NOT modify dosing algorithms');
    expect(h.prompt).toContain('medical device');
    expect(h.prompt).toContain('if you are unsure, say so and stop');
  });

  it('asks to see the code before it is changed', () => {
    expect(h.prompt).toContain('before changing anything');
    expect(h.prompt).toContain('minimal edit');
  });

  it('frames the value as a starting point, not a prescription', () => {
    expect(h.prompt).toContain('not a prescription');
    expect(h.prompt).toContain('care team');
  });

  it('never renders a null line into the prompt', () => {
    const settings = handoff({
      change: { kind: 'isf', label: 'Base ISF', currentValue: '50', proposedValue: '54' },
    });
    expect(settings.prompt).not.toContain('null');
  });
});

describe('the read-more view', () => {
  it('explains the change and where it happens, in plain language', () => {
    const h = handoff();
    expect(h.readMore).toContain('second rise past three hours');
    expect(h.readMore).toContain('Loop source');
    expect(h.readMore).toContain('rebuild');
  });

  it('says plainly that LoopStack will not make the change', () => {
    expect(handoff().readMore).toContain('cannot make this change for you');
    expect(handoff().readMore).toContain('care team');
  });

  it('describes a settings change as needing no build', () => {
    const s = handoff({
      change: { kind: 'isf', label: 'Base ISF', currentValue: '50', proposedValue: '54' },
    });
    expect(s.readMore).toContain('No build required');
  });

  it('carries the rationale as readable bullets', () => {
    expect(handoff().readMore).toContain('• 12 late-pasta dinners in 30 days');
  });
});
