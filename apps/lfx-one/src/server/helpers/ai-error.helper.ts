// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Failure handling for the two services that POST to the LiteLLM proxy —
 * `campaign-proxy.service.ts` and `ai.service.ts`.
 *
 * Shared rather than written twice, because written twice is exactly how `aiChatStream` came to
 * drop the proxy's error body while `aiChat` kept it (#3996), and how `makeAiRequest` came to carry
 * the body with no cap and no key redaction at all. The next person to change one changes both.
 */

/**
 * How much of the proxy's error body is worth carrying. A LiteLLM 502 can be a full HTML page, and
 * this body lands whole in an `Error.message` — which becomes one log line. Enough to read the
 * upstream's sentence, not enough to bury the log.
 */
export const AI_ERROR_DETAIL_LIMIT = 500;

/**
 * An AI proxy failure, with the operator's version of the message and the user's held separately.
 *
 * `message` carries the proxy's own response body, so a catch that logs the error records what the
 * proxy actually said — that body is the whole point of #3996.
 * `summary` carries only our own sentence and the HTTP status, and is what a caller may put in
 * front of a user: an upstream body can hold credentials, internal hostnames or a stack, and the
 * redaction below cannot be relied on to catch those — a proxy that echoes the key truncated,
 * re-cased or re-encoded defeats an exact-string strip, and a credential that is not `AI_API_KEY`
 * is not stripped at all. See `docs/architecture/backend/error-handling-architecture.md`
 * § "Information Disclosure Prevention".
 *
 * Deliberately not a `BaseApiError` from `server/errors/`: those carry an HTTP status and a code
 * for `apiErrorHandler` to turn into a response body, and the streaming callers never reach that
 * handler — they catch inside the generators, by which point the SSE response headers are already
 * sent.
 */
export class AiProxyError extends Error {
  public constructor(
    public readonly summary: string,
    detail: string
  ) {
    super(`${summary}${detail}`);
    this.name = 'AiProxyError';
  }
}

/**
 * What a caller may put in front of the user for a failed AI request: our own sentence and the
 * status, never the proxy's body. An error that is not an `AiProxyError` never carried a body.
 */
export function aiErrorSummary(error: unknown): string {
  if (error instanceof AiProxyError) return error.summary;
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

/**
 * The proxy's own words on a failed AI request, as a ready-to-append message suffix.
 *
 * `.catch` keeps a failed body read from replacing the status that actually matters — a torn
 * connection on the error body would otherwise throw over the top of the error being reported.
 *
 * The key is stripped because `AI_API_KEY` travels in the `Authorization` header and a proxy is
 * free to echo the request back in its error payload. `split`/`join` rather than a regex, so a key
 * holding regex metacharacters needs no escaping, and the strip runs before the length bound so a
 * key straddling the cut cannot survive as a fragment. The `apiKey ?` guard is not dead weight:
 * `''.split('')` would explode the body into characters and rejoin it with `[redacted]` between
 * every one.
 *
 * Redaction is a second line, not the boundary. The boundary is `AiProxyError.summary`, which is
 * what reaches a user; this detail is for the server log.
 */
export async function aiErrorDetail(response: Response, apiKey: string): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  const redacted = apiKey ? text.split(apiKey).join('[redacted]') : text;
  if (redacted.length <= AI_ERROR_DETAIL_LIMIT) return `: ${redacted}`;
  return `: ${redacted.slice(0, AI_ERROR_DETAIL_LIMIT)} [truncated, ${redacted.length} chars]`;
}
