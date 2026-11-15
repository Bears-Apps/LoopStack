import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ClaudeConfig, ClaudeModelId } from '@/data/claudeConfig';

// Claude transport.
//
// One function, used by every screen that asks Claude something, so the
// guarantees live in one place:
//   - The official SDK, streamed. Streaming keeps a long health-data read from
//     hitting an HTTP timeout, and the UI can show text arriving.
//   - An answer counts only when the FINAL message says the model finished
//     (`end_turn`). A refusal, a max_tokens cut-off or a dropped stream is an
//     error, never a half-answer presented as a whole one.
//   - Refusal fallbacks are on for the models that support them, so a safety
//     classifier misfire on a medical read reruns on a fallback model instead
//     of returning nothing. Haiku has no server-side fallback.
//
// WHY THE BROWSER FLAG: the app's web layer runs inside WKWebView, so the SDK
// sees a browser. `dangerouslyAllowBrowser` sends Anthropic's direct-browser
// CORS header. The "danger" is a key visible to the page's own code — here the
// key is the user's own, typed into their own device, never shipped in the
// bundle or sent anywhere but api.anthropic.com.

export class ClaudeError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'model' | 'limit' | 'network' | 'refusal' | 'incomplete' | 'cancelled' | 'other') {
    super(message);
  }
}

export type ClaudeRun = {
  text: string;
  /** Model that produced the answer — differs from the request on a fallback. */
  servedBy: string;
  inputTokens: number;
  outputTokens: number;
};

const FALLBACK_MODELS: ClaudeModelId[] = ['claude-opus-5-5', 'claude-sonnet-5-5'];

function client(config: ClaudeConfig) {
  return new Anthropic({
    apiKey: config.apiKey.trim(),
    dangerouslyAllowBrowser: true,
    // Retries are visible to nobody and each one is billed; one is enough on a
    // phone connection, the user can press the button again.
    maxRetries: 1,
  });
}

/**
 * Text of a finished message, or a ClaudeError saying why it did not finish.
 * Pure and exported so the acceptance rule is unit-tested without a network.
 */
export function completedText(message: Pick<BetaMessage, 'stop_reason' | 'content'>): string {
  if (message.stop_reason === 'refusal') {
    throw new ClaudeError('Claude declined to answer this request. Nothing was saved; you can still export the report without it.', 'refusal');
  }
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
    throw new ClaudeError('Claude ran out of room before finishing, so the partial answer was discarded. Try the brief report.', 'incomplete');
  }
  if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') {
    throw new ClaudeError('Claude stopped before completing an answer.', 'incomplete');
  }
  const text = message.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim();
  if (!text) throw new ClaudeError('Claude finished without a text answer.', 'incomplete');
  return text;
}

/** Plain-language message for any failure. Exported for tests. */
export function claudeErrorMessage(err: unknown): ClaudeError {
  if (err instanceof ClaudeError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ClaudeError('Request cancelled. Nothing was sent after you stopped it.', 'cancelled');
  if (err instanceof Anthropic.AuthenticationError) return new ClaudeError('Anthropic rejected the API key. Check it under Profile → Claude.', 'auth');
  if (err instanceof Anthropic.PermissionDeniedError) return new ClaudeError('This API key does not have access to that model.', 'auth');
  if (err instanceof Anthropic.NotFoundError) return new ClaudeError('That Claude model is not available to this key. Pick another model under Profile → Claude.', 'model');
  if (err instanceof Anthropic.RateLimitError) return new ClaudeError('Claude rate limit reached. Wait a minute and try again.', 'limit');
  if (err instanceof Anthropic.APIConnectionError) return new ClaudeError('Could not reach Claude. Check your connection.', 'network');
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message.toLowerCase();
    if (msg.includes('credit')) return new ClaudeError('The Anthropic account behind this key is out of credit. Add credit in the Claude Console.', 'limit');
    return new ClaudeError('Claude could not accept this request.', 'other');
  }
  if (err instanceof Anthropic.InternalServerError) return new ClaudeError('Claude is temporarily overloaded. Try again shortly.', 'network');
  if (err instanceof Anthropic.APIError) return new ClaudeError(`Claude request failed${err.status ? ` (${err.status})` : ''}.`, 'other');
  return new ClaudeError('Claude request failed.', 'other');
}

/** Cheap credential check: reads model metadata, spends no tokens. */
export async function testClaudeConnection(config: ClaudeConfig): Promise<string> {
  if (!config.apiKey.trim()) throw new ClaudeError('Paste a Claude API key first.', 'auth');
  try {
    const model = await client(config).models.retrieve(config.model);
    return model.display_name || model.id;
  } catch (err) {
    throw claudeErrorMessage(err);
  }
}

export async function runClaude(
  config: ClaudeConfig,
  request: {
    system: string;
    user: string;
    /** JSON schema the answer must match (structured outputs). */
    schema?: Record<string, unknown>;
    maxTokens?: number;
    onText?: (soFar: string) => void;
    signal?: AbortSignal;
  },
): Promise<ClaudeRun> {
  if (!config.apiKey.trim()) throw new ClaudeError('No Claude key set. Add one under Profile → Claude.', 'auth');
  const fallback = FALLBACK_MODELS.includes(config.model);
  try {
    const stream = client(config).beta.messages.stream(
      {
        model: config.model,
        max_tokens: request.maxTokens ?? 16000,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        // Interpreting health records is intelligence-sensitive work.
        output_config: {
          effort: 'high',
          ...(request.schema ? { format: { type: 'json_schema' as const, schema: request.schema } } : {}),
        },
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: request.signal },
    );
    if (request.onText) {
      let soFar = '';
      stream.on('text', (delta) => {
        soFar += delta;
        request.onText?.(soFar);
      });
    }
    const message = await stream.finalMessage();
    const text = completedText(message);
    return {
      text,
      servedBy: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  } catch (err) {
    throw claudeErrorMessage(err);
  }
}
