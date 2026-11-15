import { describe, expect, it } from 'vitest';
import { chatgptReviewRequest, completedChatgptText } from './chatgptPlanContract';
import type { ReviewEvidence } from './reviewEvidence';
const event = (type: string, extra = {}) => `data: ${JSON.stringify({ type, ...extra })}\n\n`;
async function* chunks(...s: string[]) { for (const x of s) yield x; }
describe('ChatGPT plan inference contract', () => {
  it('uses only supported fields and no persisted response or conversation', () => {
    const body = chatgptReviewRequest('account-model', { request: { question: 'Why?' } } as ReviewEvidence);
    expect(body.store).toBe(false); expect(body.stream).toBe(true); expect(Object.keys(body).sort()).toEqual(['input', 'instructions', 'model', 'store', 'stream']);
    expect(body.input[0].role).toBe('user');
  });
  it('accepts chunk-split SSE and CRLF frames only when completed', async () => {
    const stream = (event('response.output_text.delta', { delta: 'Answer' }) + event('response.completed')).replace(/\n/g, '\r\n');
    expect(await completedChatgptText(chunks(...stream.split('')))).toBe('Answer');
  });
  it('does not present partial text after a quota failure', async () => {
    await expect(completedChatgptText(chunks(event('response.output_text.delta', { delta: 'Apparently' }), event('response.failed', { response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })))).rejects.toThrow('usage limit');
  });
  it('rejects interrupted, incomplete and malformed streams', async () => {
    await expect(completedChatgptText(chunks(event('response.output_text.delta', { delta: 'Half' })))).rejects.toThrow('interrupted');
    await expect(completedChatgptText(chunks(event('response.incomplete')))).rejects.toThrow('incomplete');
    await expect(completedChatgptText(chunks('data: nope\n\n'))).rejects.toThrow('malformed');
  });
});
