// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { classifyMember360FailureReason, member360TerminalResult } from './member-360-terminal.utils';

describe('Member 360 terminal session facts', () => {
  it.each([
    'No entitled project for this session.',
    'The entitlement check denied this request.',
    'SCOPE GUARD: project sample-project is unavailable.',
    "This session was not actually initiated through the LFX One intake form (the platform's entitlement check reports no entitled project for this session).",
    'This account is not entitled to the project.',
  ])('classifies an access refusal without sending its internal text as the reason: %s', (text) => {
    expect(classifyMember360FailureReason(text)).toBe('no_edit_access');
  });
  it.each([
    'The run stopped before the report could be completed.',
    'The entitlement check failed because the entitlement service timed out.',
    'This session was not actually initiated through the LFX One intake form.',
    'This project is entitled to the service, but the run stopped.',
  ])('classifies non-access failures neutrally: %s', (text) => {
    expect(classifyMember360FailureReason(text)).toBe('agent_stopped');
  });
  it('ignores malformed, user-originated and nested terminal lookalikes', () => {
    expect(
      member360TerminalResult([
        'not json',
        'null',
        '[]',
        JSON.stringify({ type: 'user_message', task: { entity_type: 'EntTaskAgent', status: 'DONE' } }),
        JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskTool', status: 'DONE' }, content: { session: { status: 'DONE' } } }),
      ])
    ).toBeNull();
  });
  it('uses the shared tool-task exclusion for runtime errors', () => {
    expect(member360TerminalResult([JSON.stringify({ type: 'runtime_error', task: { entity_type: 'EntTaskTool' } })])).toBeNull();
    expect(member360TerminalResult([JSON.stringify({ type: 'runtime_error' })])).toBeNull();
  });
  it.each(['DONE', 'FAILED', 'ABORTED', 'CANCELLED'])('recognizes a %s session status without reading arbitrary content', (status) => {
    expect(member360TerminalResult([JSON.stringify({ type: 'session_status', session: { status }, content: { text: 'not-final-text' } })])).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'The run ended without a Member 360 result.',
    });
  });
  it('does not infer completion from a notification or historical task.status', () => {
    expect(
      member360TerminalResult([
        JSON.stringify({ type: 'llm_start', task: { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'DONE' } }),
        JSON.stringify({
          type: 'agent_notification_message',
          task: { entity_type: 'EntTaskAgent', status: 'DONE' },
          content: { type: 'text', data: 'A notification before root completion.' },
        }),
        JSON.stringify({
          type: 'runtime_done',
          task: { entity_type: 'EntTaskAgent', parent_task_id: 'root-task', status: 'DONE' },
          content: { type: 'text', text: 'Child answer' },
        }),
      ])
    ).toBeNull();
  });
  it.each(['runtime_error', 'llm_failed', 'session_failure'])('keeps %s pending until a session end, without echoing its body', (type) => {
    const error = JSON.stringify({ type, content: { message: 'private-internal-details' } });
    expect(member360TerminalResult([error])).toBeNull();
    expect(member360TerminalResult([error, JSON.stringify({ type: 'session_status', session: { status: 'DONE' } })])).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'The agent stopped before producing a result.',
    });
    expect(member360TerminalResult([error, JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskAgent', parent_task_id: null } })])).toEqual({
      status: 'failed',
      reason: 'agent_stopped',
      message: 'The agent stopped before producing a result.',
    });
  });
  it('prefers the last final answer to an earlier error, never reasoning or tool progress', () => {
    expect(
      member360TerminalResult(
        [
          JSON.stringify({ type: 'runtime_error', content: { message: 'Earlier error' } }),
          JSON.stringify({
            type: 'runtime_done',
            task: { entity_type: 'EntTaskAgent', parent_task_id: null },
            content: { type: 'text', text: 'Final answer, contact opaque-contact-1.' },
          }),
          JSON.stringify({ type: 'agent_notification_progress', content: { type: 'text', data: 'private-tool-progress' } }),
          JSON.stringify({
            type: 'agent_notification_message',
            content: { type: 'application/guild-response-stream', status: 'aborted', text: 'private-partial' },
          }),
        ],
        ['opaque-contact-1']
      )
    ).toEqual({ status: 'failed', reason: 'agent_stopped', message: 'Final answer, contact [contact redacted].' });
  });
});
