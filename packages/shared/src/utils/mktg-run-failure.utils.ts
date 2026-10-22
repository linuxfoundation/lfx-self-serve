// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_ERROR_SETTLE_MS, MKTG_RUN_ERROR_TEARDOWN_MS, MKTG_RUN_FAILURE_REASON } from '../constants/mktg-run.constants';
import type { MktgRunFailure, MktgSettledSessionError } from '../interfaces/mktg-run.interface';
import { extractMktgAgentTexts } from './mktg-session-event.utils';

/** New work or agent text recovers immediately; only completion events may be teardown.
 * Dated unrecovered errors must settle. Undated errors are returned as-is (Slides policy);
 * mktgRunFailureFromPayloads never fails an undated error.
 */
export function settledMktgSessionError(payloads: string[], now = Date.now(), teardownMs = MKTG_RUN_ERROR_TEARDOWN_MS): MktgSettledSessionError | null {
  let error: MktgSettledSessionError | null = null;
  for (const payload of payloads) {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof event['type'] === 'string' ? event['type'] : '';
    if (!type || type === 'user_message' || type === 'trigger_message') continue;
    const completion = /^(?:runtime|session)_(?:done|end|ended|complete|completed|stop|stopped|close|closed|terminated)$/.test(type);
    const at = typeof event['created_at'] === 'string' ? Date.parse(event['created_at']) : Number.NaN;
    if (/error|fail/i.test(type) && !/tool/i.test(type)) {
      error = { eventType: type, at, text: typeof event['content'] === 'string' ? event['content'] : JSON.stringify(event['content'] ?? type) };
    } else if (error && (extractMktgAgentTexts(payload).length || !completion || at > error.at + teardownMs)) {
      // Only completion/lifecycle-end events inside the window can be teardown.
      // Consumers handle validated finalize output before consulting this reader.
      error = null;
    }
  }
  if (!error) return null;
  if (!Number.isFinite(error.at)) return error; // Slides retains its existing undated-error policy.
  return now - error.at >= MKTG_RUN_ERROR_SETTLE_MS ? error : null;
}

/** Fixed safe copy only: never expose the provider payload returned by the internal reader. */
export function mktgRunFailureFromPayloads(payloads: string[], now = Date.now()): MktgRunFailure | null {
  const error = settledMktgSessionError(payloads, now);
  if (!error || !Number.isFinite(error.at)) return null; // Ordinary runs cannot age an undated error.
  return { reason: MKTG_RUN_FAILURE_REASON, eventType: /^[a-zA-Z0-9_-]{1,80}$/.test(error.eventType) ? error.eventType : 'session_failed' };
}
