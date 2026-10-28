// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBER_360_ACCESS_REFUSAL_REGEX,
  MEMBER_360_FAILURE_MESSAGE,
  MEMBER_360_FAILURE_MESSAGE_MAX_CHARS,
  MEMBER_360_STOPPED_MESSAGE,
} from '../constants/member-360.constants';
import type { Member360FailureReason, Member360Result } from '../interfaces/member-360.interface';
import { isMktgToolTaskEvent } from '../utils/mktg-session-event.utils';
import { createMember360Redactor } from './member-360-redaction.utils';

/** Classify redacted prose on the server; never expose internal markers in the short reason. */
export function classifyMember360FailureReason(redactedText: string): Member360FailureReason {
  return MEMBER_360_ACCESS_REFUSAL_REGEX.test(redactedText) ? 'no_edit_access' : 'agent_stopped';
}

/** Read only event metadata and root final output, never nested tool results or reasoning. */
export function member360TerminalResult(payloads: string[], contacts: (string | null)[] = []): Member360Result | null {
  let rootDone = false;
  let sessionEnded = false;
  let failed = false;
  let finalText = '';
  for (const payload of payloads) {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event['type'] === 'user_message' || event['type'] === 'trigger_message') continue;
    const record = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const task = record(event['task']);
    const content = record(event['content']);
    const root = task['entity_type'] === 'EntTaskAgent' && task['parent_task_id'] == null;
    const tool = isMktgToolTaskEvent(event);
    // Guild's task.status is CURRENT state even on historical events. Only the
    // root runtime_done ends the run: neither tool completion nor a model turn,
    // notification or aborted response stream proves that the session ended.
    if (root && event['type'] === 'runtime_done') {
      rootDone = true;
      if (content['type'] === 'text' && typeof content['text'] === 'string') finalText = content['text'];
    }
    const type = String(event['type']);
    if (!tool && /error|fail/i.test(type) && !/tool/i.test(type)) failed = true;
    const session = record(event['session']);
    if (['DONE', 'FAILED', 'ERROR', 'ABORTED', 'CANCELLED', 'CANCELED', 'COMPLETED'].includes(String(session['status']).toUpperCase())) sessionEnded = true;
  }
  // Root completion outranks an earlier error. Raw runtime error strings may
  // contain internal details; do not mistake them for the agent's own answer.
  if (rootDone || sessionEnded) {
    const message = createMember360Redactor(contacts)(finalText).trim();
    return {
      status: 'failed',
      reason: classifyMember360FailureReason(message),
      message: message.slice(0, MEMBER_360_FAILURE_MESSAGE_MAX_CHARS) || (failed ? MEMBER_360_STOPPED_MESSAGE : MEMBER_360_FAILURE_MESSAGE),
    };
  }
  // Error events can be recoverable; only a session end proves terminal failure.
  return null;
}
