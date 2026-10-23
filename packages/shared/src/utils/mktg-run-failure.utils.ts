// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_RUN_ERROR_SETTLE_MS,
  MKTG_RUN_FAILURE_REASON,
  MKTG_SESSION_AGENT_OUTPUT_EVENT_TYPES,
  MKTG_SESSION_EVENTS_TRUNCATED,
  MKTG_SESSION_TURN_STARTED,
} from '../constants/mktg-run.constants';
import type { MktgRunFailure, MktgSettledSessionError } from '../interfaces/mktg-run.interface';
import { extractMktgAgentTexts, isMktgToolTaskEvent } from './mktg-session-event.utils';

/** Only explicit new work or agent-authored text proves recovery; passive metadata never does.
 * Dated unrecovered errors must settle. Undated errors are returned as-is (Slides policy);
 * mktgRunFailureFromPayloads never fails an undated error. Tool-task errors are ignored.
 */
export function settledMktgSessionError(payloads: string[], now = Date.now()): MktgSettledSessionError | null {
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
    if (type === MKTG_SESSION_EVENTS_TRUNCATED) return null; // A capped page cannot prove a terminal outcome.
    if (type === MKTG_SESSION_TURN_STARTED) {
      error = null;
      continue;
    } // Earlier-turn errors do not belong to this turn.
    const tool = isMktgToolTaskEvent(event);
    const isError = /error|fail/i.test(type);
    if (tool && isError) continue;
    const newWork = type === 'llm_start' || type === 'runtime_start' || type === 'llm_done' || type.startsWith('tool_');
    const agentText = !tool && (MKTG_SESSION_AGENT_OUTPUT_EVENT_TYPES as readonly string[]).includes(type) && extractMktgAgentTexts(payload).length > 0;
    const at = typeof event['created_at'] === 'string' ? Date.parse(event['created_at']) : Number.NaN;
    if (isError && !/tool/i.test(type)) {
      error = { eventType: type, at, text: typeof event['content'] === 'string' ? event['content'] : JSON.stringify(event['content'] ?? type) };
    } else if (error && (agentText || newWork)) {
      // Unknown/status/heartbeat/completion events leave the error standing, at any age.
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
