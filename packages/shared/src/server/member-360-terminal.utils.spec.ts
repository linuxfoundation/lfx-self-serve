// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { member360TerminalResult } from './member-360-terminal.utils';

describe('Member 360 terminal session facts', () => {
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
  it.each(['DONE', 'FAILED', 'ABORTED', 'CANCELLED'])('recognizes a %s session status without reading arbitrary content', (status) => {
    expect(member360TerminalResult([JSON.stringify({ type: 'session_status', session: { status }, content: { text: 'not-final-text' } })])).toEqual({
      status: 'failed',
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
  it.each(['runtime_error', 'llm_failed', 'session_failure'])('classifies %s without echoing its internal body', (type) => {
    expect(member360TerminalResult([JSON.stringify({ type, content: { message: 'private-internal-details' } })])).toEqual({
      status: 'failed',
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
    ).toEqual({ status: 'failed', message: 'Final answer, contact [contact redacted].' });
  });
});
