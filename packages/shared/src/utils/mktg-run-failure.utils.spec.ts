// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MKTG_RUN_FAILURE_REASON } from '../constants/mktg-run.constants';
import { mktgRunFailureFromPayloads, settledMktgSessionError } from './mktg-run-failure.utils';

const now = Date.parse('2026-10-21T12:00:00Z');
const event = (type: string, content: unknown = {}, ago = 60_000): string => JSON.stringify({ type, content, created_at: new Date(now - ago).toISOString() });

describe('shared Guild terminal failure detection', () => {
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
  it.each(['llm_start', 'llm_done', 'runtime_start', 'runtime_done', 'tool_done', 'agent_notification_progress'])(
    'treats %s after the teardown window as liveness',
    (type) => {
      expect(mktgRunFailureFromPayloads([event('runtime_error'), event(type, {}, 54_000)], now)).toBeNull();
    }
  );
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
