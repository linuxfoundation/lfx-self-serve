// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ONE_OFF_FAILURE_MESSAGE_MAX_CHARS, MKTG_ONE_OFF_STOPPED_MESSAGE, MKTG_ONE_OFF_TERMINAL_TASK_STATUSES } from '../constants/mktg-one-off.constants';
import { MKTG_SESSION_EVENTS_TRUNCATED, MKTG_SESSION_TURN_STARTED } from '../constants/mktg-run.constants';
import type { MktgOneOffTerminalFacts } from '../interfaces/mktg-document-run.interface';
import { isMktgToolTaskEvent } from '../utils/mktg-session-event.utils';

/** Root completion/session facts and final root messages, never user text, nested tools or reasoning. */
export function mktgOneOffTerminalFacts(payloads: string[]): MktgOneOffTerminalFacts {
  let rootDone = false;
  let sessionEnded = false;
  let failed = false;
  let doneText = '';
  let currentRootDone = false;
  let currentDoneText = '';
  let currentTurnOffset = 0;
  let truncated = false;
  let rootTaskEnded = false;
  let lastRootMessageText = '';
  for (const [index, payload] of payloads.entries()) {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event['type'] === MKTG_SESSION_EVENTS_TRUNCATED) truncated = true;
    if (event['type'] === MKTG_SESSION_TURN_STARTED) {
      currentTurnOffset = index + 1;
      currentRootDone = false;
      currentDoneText = '';
      rootTaskEnded = false;
      lastRootMessageText = '';
    }
    if (event['type'] === 'user_message' || event['type'] === 'trigger_message') continue;
    const record = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const task = record(event['task']);
    const content = record(event['content']);
    const legacyRoot = task['entity_type'] === 'EntTaskAgent' && task['parent_task_id'] == null;
    const currentRoot = legacyRoot && task['parent_task'] == null;
    const tool = isMktgToolTaskEvent(event);
    // Preserve Member's original predicate; public-list child tasks may use parent_task instead.
    if (event['type'] === 'runtime_done') {
      if (legacyRoot) rootDone = true;
      if (currentRoot) currentRootDone = true;
      if (content['type'] === 'text' && typeof content['text'] === 'string') {
        if (legacyRoot) doneText = content['text'];
        if (currentRoot) currentDoneText = content['text'];
      }
    }
    // Task status is CURRENT even on historical events. Keep the newest root's
    // metadata separately so Member 360 can ignore this public-list policy.
    if (currentRoot) {
      const status = typeof task['status'] === 'string' ? task['status'].toUpperCase() : '';
      rootTaskEnded = MKTG_ONE_OFF_TERMINAL_TASK_STATUSES.includes(status);
      if (event['type'] === 'agent_notification_message') {
        if (typeof event['content'] === 'string') lastRootMessageText = event['content'];
        else if (content['type'] === 'text') {
          lastRootMessageText = '';
          if (typeof content['data'] === 'string') lastRootMessageText = content['data'];
          else if (typeof content['text'] === 'string') lastRootMessageText = content['text'];
        }
      }
    }
    const type = String(event['type']);
    if (!tool && /error|fail/i.test(type) && !/tool/i.test(type)) failed = true;
    const session = record(event['session']);
    if (['DONE', 'FAILED', 'ERROR', 'ABORTED', 'CANCELLED', 'CANCELED', 'COMPLETED'].includes(String(session['status']).toUpperCase())) sessionEnded = true;
  }
  if (truncated) {
    currentRootDone = false;
    currentDoneText = '';
    rootTaskEnded = false;
    lastRootMessageText = '';
  }
  return { rootDone, sessionEnded, failed, doneText, currentRootDone, currentDoneText, currentTurnOffset, rootTaskEnded, lastRootMessageText };
}

/** A current root completion, or terminal status corroborated by a current root reply. */
export function mktgOneOffTurnEnded(facts: MktgOneOffTerminalFacts): boolean {
  return facts.currentRootDone || (facts.rootTaskEnded && facts.lastRootMessageText.trim() !== '');
}

/** Common bounded reply policy for one-offs adopting the public-list terminal facts. */
export function mktgOneOffFailureText(facts: MktgOneOffTerminalFacts): string {
  return (facts.currentDoneText.trim() || facts.lastRootMessageText.trim()).slice(0, MKTG_ONE_OFF_FAILURE_MESSAGE_MAX_CHARS) || MKTG_ONE_OFF_STOPPED_MESSAGE;
}
