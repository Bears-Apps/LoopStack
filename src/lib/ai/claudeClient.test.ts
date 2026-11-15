import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeError, claudeErrorMessage, completedText } from './claudeClient';
import { parseClaudeFeedback } from './claudeFeedback';

const text = (t: string) => ({ type: 'text' as const, text: t, citations: null });

describe('completedText', () => {
  it('accepts only a finished turn', () => {
    expect(completedText({ stop_reason: 'end_turn', content: [text('Hello '), text('there')] } as never)).toBe('Hello there');
  });

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'incomplete'],
    ['model_context_window_exceeded', 'incomplete'],
    ['pause_turn', 'incomplete'],
    [null, 'incomplete'],
  ])('rejects stop_reason %s as %s — a partial answer is never shown as whole', (reason, kind) => {
    try {
      completedText({ stop_reason: reason, content: [text('partial')] } as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeError);
      expect((err as ClaudeError).kind).toBe(kind);
    }
  });

  it('rejects a finished turn with no text', () => {
    expect(() => completedText({ stop_reason: 'end_turn', content: [] } as never)).toThrow(ClaudeError);
  });
});

describe('claudeErrorMessage', () => {
  it('maps SDK errors to plain language', () => {
    const headers = new Headers();
    expect(claudeErrorMessage(new Anthropic.AuthenticationError(401, undefined, 'bad key', headers)).kind).toBe('auth');
    expect(claudeErrorMessage(new Anthropic.NotFoundError(404, undefined, 'no model', headers)).kind).toBe('model');
    expect(claudeErrorMessage(new Anthropic.RateLimitError(429, undefined, 'slow', headers)).kind).toBe('limit');
    expect(claudeErrorMessage(new Anthropic.BadRequestError(400, undefined, 'Your credit balance is too low', headers)).kind).toBe('limit');
    expect(claudeErrorMessage(new Anthropic.APIUserAbortError()).kind).toBe('cancelled');
    expect(claudeErrorMessage(new Error('boom')).kind).toBe('other');
  });
});

describe('parseClaudeFeedback', () => {
  const now = new Date('2026-10-28T12:00:00Z');

  it('bounds counts and lengths', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, detail: 'd'.repeat(900), evidence: 'e' }));
    const f = parseClaudeFeedback(
      JSON.stringify({ overview: 'ok', observations: many, discussionQuestions: Array(9).fill('q'), dataGaps: [] }),
      'claude-opus-5-5',
      now,
    );
    expect(f.observations).toHaveLength(6);
    expect(f.observations[0].detail).toHaveLength(600);
    expect(f.discussionQuestions).toHaveLength(6);
    expect(f.generatedIso).toBe(now.toISOString());
  });

  it('rejects malformed or empty notes', () => {
    expect(() => parseClaudeFeedback('not json', 'm', now)).toThrow(ClaudeError);
    expect(() => parseClaudeFeedback('{"overview":""}', 'm', now)).toThrow(ClaudeError);
  });
});
