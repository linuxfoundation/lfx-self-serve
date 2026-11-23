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

  // A crashed root, as Guild records it: the root task's status is ERROR on every root
  // event (no parent_task key), tool tasks end DONE, an error is the last event, and
  // there is no root runtime_done and no session object anywhere.
  const now = Date.parse('2026-01-01T12:00:00.000Z');
  const crashedRootPayloads = (lastErrorAgeMs: number, dated = true): string[] => {
    const root = { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'ERROR' };
    const tool = { entity_type: 'EntTaskTool', parent_task_id: null, parent_task: {}, status: 'DONE' };
    const at = (ageMs: number): { created_at?: string } => (dated ? { created_at: new Date(now - ageMs).toISOString() } : {});
    const stream = { type: 'application/guild-response-stream', stream_id: 'opaque-stream-id', sequence: 1 };
    return [
      JSON.stringify({ type: 'runtime_start', task: tool, content: { type: 'progress' }, ...at(lastErrorAgeMs + 10_000) }),
      JSON.stringify({
        type: 'agent_notification_progress',
        task: tool,
        content: { type: 'text', data: 'private-tool-progress' },
        ...at(lastErrorAgeMs + 9_000),
      }),
      JSON.stringify({ type: 'runtime_done', task: tool, content: {}, ...at(lastErrorAgeMs + 8_000) }),
      JSON.stringify({ type: 'llm_start', task: root, content: null, ...at(lastErrorAgeMs + 1_000) }),
      JSON.stringify({ type: 'llm_done', task: root, content: null, ...at(lastErrorAgeMs + 600) }),
      JSON.stringify({ type: 'agent_notification_message', task: root, content: { ...stream, status: 'aborted', text: '' }, ...at(lastErrorAgeMs + 400) }),
      JSON.stringify({
        type: 'agent_notification_error',
        task: root,
        content: { type: 'text', data: 'private-internal-details' },
        ...at(lastErrorAgeMs + 200),
      }),
      JSON.stringify({ type: 'runtime_error', task: root, content: 'private-internal-details', ...at(lastErrorAgeMs) }),
    ];
  };
  it('fails a crashed root once its last error has settled, without echoing the error body', () => {
    const result = member360TerminalResult(crashedRootPayloads(40_000), [], now);
    expect(result).toEqual({ status: 'failed', reason: 'agent_stopped', message: 'The agent stopped before producing a result.' });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('keeps a crashed root pending while its last error is younger than the settle window', () => {
    expect(member360TerminalResult(crashedRootPayloads(10_000), [], now)).toBeNull();
  });
  it('never fails a crashed root on undated errors', () => {
    expect(member360TerminalResult(crashedRootPayloads(40_000, false), [], now)).toBeNull();
  });
  it('keeps a live run pending after an older recovered error', () => {
    expect(
      member360TerminalResult(
        [
          JSON.stringify({ type: 'runtime_error', content: { message: 'private-internal-details' }, created_at: new Date(now - 120_000).toISOString() }),
          JSON.stringify({
            type: 'llm_start',
            task: { entity_type: 'EntTaskAgent', parent_task_id: null, status: 'RUNNING' },
            created_at: new Date(now - 60_000).toISOString(),
          }),
        ],
        [],
        now
      )
    ).toBeNull();
  });
});
