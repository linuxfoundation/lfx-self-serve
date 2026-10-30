// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBER_360_ACCESS_REFUSAL_REGEX,
  MEMBER_360_FAILURE_MESSAGE,
  MEMBER_360_FAILURE_MESSAGE_MAX_CHARS,
  MEMBER_360_STOPPED_MESSAGE,
} from '../constants/member-360.constants';
import type { Member360FailureReason, Member360Result } from '../interfaces/member-360.interface';
import { mktgOneOffTerminalFacts } from './mktg-one-off-terminal.utils';
import { createMember360Redactor } from './member-360-redaction.utils';

/** Classify redacted prose on the server; never expose internal markers in the short reason. */
export function classifyMember360FailureReason(redactedText: string): Member360FailureReason {
  return MEMBER_360_ACCESS_REFUSAL_REGEX.test(redactedText) ? 'no_edit_access' : 'agent_stopped';
}

/** Read only event metadata and root final output, never nested tool results or reasoning. */
export function member360TerminalResult(payloads: string[], contacts: (string | null)[] = []): Member360Result | null {
  const { rootDone, sessionEnded, failed, doneText: finalText } = mktgOneOffTerminalFacts(payloads);
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
