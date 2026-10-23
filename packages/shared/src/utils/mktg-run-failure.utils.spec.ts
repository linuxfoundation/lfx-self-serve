// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MKTG_RUN_FAILURE_REASON, MKTG_SESSION_EVENTS_TRUNCATED, MKTG_SESSION_TURN_STARTED } from '../constants/mktg-run.constants';
import { isMktgRunFailureReason, mktgRunFailureFromPayloads, settledMktgSessionError } from './mktg-run-failure.utils';

const now = Date.parse('2026-10-21T12:00:00Z');
const event = (type: string, content: unknown = {}, ago = 60_000): string => JSON.stringify({ type, content, created_at: new Date(now - ago).toISOString() });

describe('shared Guild terminal failure detection', () => {
  it.each(['no_edit_access', 'agent_stopped'])('accepts the classified reason %s', (reason) => {
    expect(isMktgRunFailureReason(reason)).toBe(true);
  });
  it.each(['unknown_code', '__proto__', 'constructor', 'no_edit_access extra', '', null, undefined, 12])('rejects non-allow-listed reason %s', (reason) => {
    expect(isMktgRunFailureReason(reason)).toBe(false);
  });
  it.each(['runtime_error', 'llm_failed', 'session_errored'])('fails only a settled last %s without exposing raw payloads', (type) => {
    expect(mktgRunFailureFromPayloads([event(type, { error: 'PRIVATE' })], now)).toEqual({ eventType: type, reason: MKTG_RUN_FAILURE_REASON });
  });
  it('keeps a young or undated error pending, rather than destroying its recovery capability', () => {
    expect(mktgRunFailureFromPayloads([event('runtime_error', {}, 1000)], now)).toBeNull();
    const undated = [JSON.stringify({ type: 'runtime_error' })];
    expect(mktgRunFailureFromPayloads(undated, now)).toBeNull();
    expect(settledMktgSessionError(undated, now)?.at).toBeNaN(); // Slides' internal reader returns it as-is.
  });
  it.each(['runtime_done', 'runtime_end', 'session_end'])('does not mistake %s teardown at +1 second for recovery', (type) => {
    expect(mktgRunFailureFromPayloads([event('runtime_error'), event(type, {}, 59_000)], now)?.eventType).toBe('runtime_error');
  });
  it.each(['llm_start', 'runtime_start', 'tool_start', 'tool_done', 'llm_done'])('recovers immediately on %s even through 120 seconds of silence', (type) => {
    expect(mktgRunFailureFromPayloads([event('runtime_error'), event(type, {}, 59_000)], now + 70_000)).toBeNull();
  });
  it('keeps completion-only teardown failed at 31 seconds, but accepts immediate progress text', () => {
    expect(mktgRunFailureFromPayloads([event('runtime_error'), event('runtime_done', {}, 59_000)], now - 29_000)?.eventType).toBe('runtime_error');
    expect(
      mktgRunFailureFromPayloads([event('runtime_error'), event('agent_notification_progress', { type: 'text', data: 'Reading another source.' }, 59_000)], now)
    ).toBeNull();
  });
  it('replays the recorded healthy 15 Oct stream without inventing a terminal failure', () => {
    const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/mktg-run-activity.session.json', import.meta.url), 'utf8')) as {
      events: Record<string, unknown>[];
    };
    const payloads = fixture.events.map((value) => JSON.stringify(value));
    expect(mktgRunFailureFromPayloads(payloads, now)).toBeNull();
    // Synthetic error injected before the recorded new-work sequence, not a recorded failure.
    const firstAt = Date.parse(String(fixture.events[0]['created_at']));
    const injected = JSON.stringify({ type: 'runtime_error', created_at: new Date(firstAt - 1000).toISOString() });
    expect(mktgRunFailureFromPayloads([injected, ...payloads], now)).toBeNull();
  });
  it.each(['status_update', 'heartbeat', 'session_closing', 'closing', 'stopping', 'runtime_done', 'agent_notification_progress'])(
    'does not treat passive %s as recovery even after the former teardown window',
    (type) => {
      expect(mktgRunFailureFromPayloads([event('runtime_error'), event(type, {}, 59_000)], now)?.eventType).toBe('runtime_error');
      expect(mktgRunFailureFromPayloads([event('runtime_error'), event(type, {}, 54_000)], now)?.eventType).toBe('runtime_error');
    }
  );
  it('does not attribute status text to the agent or tool-task errors to the session', () => {
    expect(
      mktgRunFailureFromPayloads([event('runtime_error'), event('status_update', { type: 'text', data: 'Session closing.' }, 59_000)], now)?.eventType
    ).toBe('runtime_error');
    const toolError = JSON.stringify({
      type: 'runtime_error',
      created_at: new Date(now - 60_000).toISOString(),
      task: { entity_type: 'EntTaskTool' },
      content: { type: 'text', data: 'Tool failed.' },
    });
    expect(mktgRunFailureFromPayloads([toolError], now)).toBeNull();
    const activeAgent = JSON.stringify({
      type: 'runtime_start',
      created_at: new Date(now - 61_000).toISOString(),
      task: { entity_type: 'EntTaskAgent', id: 'synthetic-root' },
    });
    expect(mktgRunFailureFromPayloads([activeAgent, toolError], now)).toBeNull();
    expect(mktgRunFailureFromPayloads([event('runtime_error'), toolError], now)?.eventType).toBe('runtime_error');
  });
  it('keeps main queued-turn boundaries and capped-page uncertainty without calling them recovery', () => {
    expect(mktgRunFailureFromPayloads([event('runtime_error'), event(MKTG_SESSION_TURN_STARTED)], now)).toBeNull();
    expect(mktgRunFailureFromPayloads([event('runtime_error'), event(MKTG_SESSION_EVENTS_TRUNCATED)], now)).toBeNull();
    expect(mktgRunFailureFromPayloads([event(MKTG_SESSION_TURN_STARTED), event('runtime_error')], now)?.eventType).toBe('runtime_error');
  });
  it.each([
    event('agent_notification_message', 'QUESTIONS (synthetic gap)', 59_000),
    event('llm_done', { content: [{ type: 'text', text: 'QUESTIONS (synthetic gap)' }] }, 59_000),
    event('llm_start', { payload: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Final tool output' }] }] } }, 59_000),
  ])('preserves output/questions after recovery (%s)', (output) => {
    expect(mktgRunFailureFromPayloads([event('runtime_error'), output], now)).toBeNull();
    expect(mktgRunFailureFromPayloads([output, event('runtime_error', {}, 30_000)], now)?.eventType).toBe('runtime_error');
  });
  it('keeps healthy sessions and nested/user/tool errors pending', () => {
    expect(mktgRunFailureFromPayloads(['null', 'not JSON', event('llm_start'), event('tool_failed')], now)).toBeNull();
    expect(mktgRunFailureFromPayloads([event('user_message', event('runtime_error')), event('runtime_done', { type: 'runtime_error' })], now)).toBeNull();
  });
});
