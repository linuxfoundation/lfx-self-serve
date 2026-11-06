// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

vi.mock('@lfx-one/shared/constants', () => ({
  MKTG_SESSION_EVENTS_TRUNCATED: 'mktg_session_events_truncated',
  MKTG_SESSION_TURN_STARTED: 'mktg_session_turn_started',
}));

import { itOsEventsTruncated, itOsTurnComplete } from './it-os-turn.util';

const events = (...types: string[]): string[] => types.map((type) => JSON.stringify({ type }));
const TURN = 'mktg_session_turn_started';

describe('itOsTurnComplete', () => {
  it('is complete once every runtime since the latest user message has ended', () => {
    // Shape of a real session: an outer runtime with nested tool runtimes, one of which errored.
    const turn = events(
      TURN,
      'runtime_start',
      'llm_start',
      'llm_done',
      'runtime_start',
      'runtime_done',
      'runtime_start',
      'runtime_error',
      'llm_start',
      'agent_notification_message',
      'runtime_done'
    );
    expect(itOsTurnComplete(turn)).toBe(true);
  });

  it('is not complete after an interim message while the outer runtime is still open', () => {
    expect(itOsTurnComplete(events(TURN, 'runtime_start', 'llm_done', 'agent_notification_message', 'runtime_start', 'runtime_done'))).toBe(false);
  });

  it('only looks at the latest turn', () => {
    const first = events(TURN, 'runtime_start', 'agent_notification_message', 'runtime_done');
    expect(itOsTurnComplete([...first, ...events(TURN, 'runtime_start')])).toBe(false);
    expect(itOsTurnComplete(first)).toBe(true);
  });

  it('is not complete before the agent starts, or when the event page was truncated', () => {
    expect(itOsTurnComplete(events(TURN))).toBe(false);
    expect(itOsTurnComplete([...events(TURN, 'runtime_start', 'runtime_done'), JSON.stringify({ type: 'mktg_session_events_truncated' })])).toBe(false);
  });

  it('flags a truncated event page as too long to follow', () => {
    expect(itOsEventsTruncated([...events(TURN, 'runtime_start', 'runtime_done'), JSON.stringify({ type: 'mktg_session_events_truncated' })])).toBe(true);
    expect(itOsEventsTruncated(events(TURN, 'runtime_start', 'runtime_done'))).toBe(false);
  });
});
