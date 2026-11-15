import { REVIEW_INSTRUCTIONS, type ReviewEvidence } from './reviewEvidence';

/** Transport-neutral contract. Credentials stay in the future native runtime.
 * Not called by DataChat until an eligible OAuth implementation is connected.
 */
export function chatgptReviewRequest(model: string, evidence: ReviewEvidence) {
  if (!model.trim()) throw new Error('Select a model available to the connected ChatGPT account.');
  return {
    model,
    store: false as const,
    stream: true as const,
    instructions: REVIEW_INSTRUCTIONS,
    input: [{ role: 'user' as const, content: JSON.stringify({ question: evidence.request.question, evidence }) }],
  };
}

/** Treat a streamed prefix as incomplete until the terminal completion event.
 * Return only completed text; a failure after deltas must not appear as an answer.
 * SSE frames may span chunks or use CRLF (including a split CR/LF pair).
 */
export async function completedChatgptText(chunks: AsyncIterable<string>): Promise<string> {
  let buffer = '', text = '', completed = false;
  for await (const chunk of chunks) {
    buffer += chunk;
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const raw = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!raw || raw === '[DONE]') continue;
      let event: { type?: string; delta?: string; response?: { status?: string; error?: { code?: string } }; error?: { code?: string } };
      try { event = JSON.parse(raw); } catch { throw new Error('The ChatGPT response stream was malformed.'); }
      if (event.type === 'response.failed' || event.type === 'error') {
        const code = event.response?.error?.code ?? event.error?.code;
        if (code === 'subscription_sharing_usage_limit_exceeded') throw new Error('ChatGPT plan usage limit reached. Review usage in ChatGPT settings.');
        if (code === 'subscription_sharing_usage_unavailable') throw new Error('ChatGPT plan usage is unavailable. Review the account connection.');
        throw new Error('ChatGPT could not complete this response.');
      }
      if (event.type === 'response.incomplete') throw new Error('ChatGPT returned an incomplete response.');
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
      if (event.type === 'response.completed') completed = true;
    }
  }
  if (!completed || buffer.trim()) throw new Error('ChatGPT response interrupted before completion.');
  if (!text.trim()) throw new Error('ChatGPT completed without a text answer.');
  return text;
}
