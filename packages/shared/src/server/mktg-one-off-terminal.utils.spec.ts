// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_ONE_OFF_FAILURE_MESSAGE_MAX_CHARS, MKTG_ONE_OFF_STOPPED_MESSAGE, MKTG_ONE_OFF_TERMINAL_TASK_STATUSES } from '../constants/mktg-one-off.constants';
import { MKTG_SESSION_EVENTS_TRUNCATED, MKTG_SESSION_TURN_STARTED } from '../constants/mktg-run.constants';
import { MKTG_ONE_OFF_RECORDED_REFUSAL_PAYLOADS, MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS } from '../constants/mktg-one-off-terminal.fixture';
import { member360TerminalResult } from './member-360-terminal.utils';
import { mktgOneOffFailureText, mktgOneOffTerminalFacts, mktgOneOffTurnEnded } from './mktg-one-off-terminal.utils';

const root = { entity_type: 'EntTaskAgent', parent_task_id: null };
const emptyFacts = {
  rootDone: false,
  sessionEnded: false,
  failed: false,
  doneText: '',
  currentRootDone: false,
  currentDoneText: '',
  currentTurnOffset: 0,
  rootTaskEnded: false,
  lastRootMessageText: '',
};

describe('mktgOneOffTerminalFacts', () => {
  it('classifies the recorded public-list shape: 12 events, no runtime_done, current DONE status and final root .data', () => {
    expect(MKTG_ONE_OFF_RECORDED_REFUSAL_PAYLOADS).toHaveLength(12);
    expect(mktgOneOffTerminalFacts(MKTG_ONE_OFF_RECORDED_REFUSAL_PAYLOADS)).toEqual({
      ...emptyFacts,
      rootTaskEnded: true,
      lastRootMessageText: 'SYNTHETIC final refusal: the request form could not be read.',
    });
    // The Member wrapper must NOT adopt the public task-status/notification rule.
    expect(member360TerminalResult(MKTG_ONE_OFF_RECORDED_REFUSAL_PAYLOADS)).toBeNull();
  });

  it('derives the normalized boundary with a content-free marker and 11 public events', () => {
    expect(MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS).toHaveLength(12);
    expect(JSON.parse(MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS[0])).toEqual({ type: MKTG_SESSION_TURN_STARTED });
    expect(mktgOneOffTerminalFacts(MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS)).toMatchObject({ currentTurnOffset: 1, rootTaskEnded: true });
  });

  it('suppresses all current terminal/text evidence on a capped page without widening Member behavior', () => {
    const done = JSON.stringify({ type: 'runtime_done', task: root, content: { type: 'text', text: 'SYNTHETIC legacy done' } });
    const payloads = [...MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS, done, JSON.stringify({ type: MKTG_SESSION_EVENTS_TRUNCATED })];
    const facts = mktgOneOffTerminalFacts(payloads);
    expect(facts).toMatchObject({
      rootDone: true,
      doneText: 'SYNTHETIC legacy done',
      currentRootDone: false,
      currentDoneText: '',
      rootTaskEnded: false,
      lastRootMessageText: '',
    });
    expect(mktgOneOffFailureText(facts)).toBe(MKTG_ONE_OFF_STOPPED_MESSAGE);
    expect(member360TerminalResult(payloads)).toMatchObject({ status: 'failed', message: 'SYNTHETIC legacy done' });
  });

  it('resets only current-turn facts at each queued marker, preserving the legacy Member facts', () => {
    const done = JSON.stringify({ type: 'runtime_done', task: { ...root, status: 'DONE' }, content: { type: 'text', text: 'SYNTHETIC previous turn' } });
    const facts = mktgOneOffTerminalFacts([done, JSON.stringify({ type: MKTG_SESSION_TURN_STARTED })]);
    expect(facts).toEqual({ ...emptyFacts, rootDone: true, doneText: 'SYNTHETIC previous turn', currentTurnOffset: 2 });
    expect(mktgOneOffFailureText(facts)).toBe(MKTG_ONE_OFF_STOPPED_MESSAGE);
  });

  it('requires a root reply or runtime completion before trusting terminal task status', () => {
    const marker = JSON.stringify({ type: MKTG_SESSION_TURN_STARTED });
    const progress = JSON.stringify({ type: 'agent_notification_progress', task: { ...root, status: 'DONE' }, content: {} });
    const bare = mktgOneOffTerminalFacts([marker, progress]);
    expect(bare.rootTaskEnded).toBe(true); // Metadata alone remains a fact, not a terminal decision.
    expect(mktgOneOffTurnEnded(bare)).toBe(false);
    const reply = JSON.stringify({
      type: 'agent_notification_message',
      task: { ...root, status: 'DONE' },
      content: { type: 'text', data: 'SYNTHETIC current refusal' },
    });
    expect(mktgOneOffTurnEnded(mktgOneOffTerminalFacts([marker, progress, reply]))).toBe(true);
    expect(mktgOneOffTurnEnded(mktgOneOffTerminalFacts([marker, JSON.stringify({ type: 'runtime_done', task: root, content: {} })]))).toBe(true);
    expect(mktgOneOffTurnEnded(mktgOneOffTerminalFacts(MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS))).toBe(true);
    expect(mktgOneOffTurnEnded({ ...emptyFacts, rootTaskEnded: true, lastRootMessageText: '  ' })).toBe(false);
  });

  it('keeps legacy runtime_done text separate from public root-message text', () => {
    const message = JSON.stringify({ type: 'agent_notification_message', task: root, content: { type: 'text', data: 'SYNTHETIC earlier root reply' } });
    const done = JSON.stringify({ type: 'runtime_done', task: root, content: { type: 'text', text: 'SYNTHETIC final refusal' } });
    expect(mktgOneOffTerminalFacts([message, done])).toEqual({
      ...emptyFacts,
      rootDone: true,
      doneText: 'SYNTHETIC final refusal',
      currentRootDone: true,
      currentDoneText: 'SYNTHETIC final refusal',
      lastRootMessageText: 'SYNTHETIC earlier root reply',
    });
  });

  it.each(['data', 'text', 'bare'])('reads only the last root plain message using %s', (key) => {
    expect(
      mktgOneOffTerminalFacts([
        JSON.stringify({ type: 'agent_notification_message', task: root, content: { type: 'text', data: 'SYNTHETIC earlier reply' } }),
        JSON.stringify({
          type: 'agent_notification_message',
          task: root,
          content: key === 'bare' ? 'SYNTHETIC final reply' : { type: 'text', [key]: 'SYNTHETIC final reply' },
        }),
      ])
    ).toEqual({ ...emptyFacts, lastRootMessageText: 'SYNTHETIC final reply' });
  });

  it('uses the newest root status, not an older DONE or a newer child/tool status', () => {
    const event = (task: object) => JSON.stringify({ type: 'agent_notification_message', task, content: { type: 'text', data: 'SYNTHETIC reply' } });
    expect(
      mktgOneOffTerminalFacts([
        event({ ...root, status: 'DONE' }),
        event({ ...root, status: 'RUNNING' }),
        event({ ...root, parent_task_id: 'synthetic-parent', status: 'DONE' }),
        event({ entity_type: 'EntTaskTool', status: 'DONE' }),
      ])
    ).toEqual({ ...emptyFacts, lastRootMessageText: 'SYNTHETIC reply' });
  });

  it('leaves Member 360 on its runtime_done-only text policy', () => {
    expect(
      member360TerminalResult([
        JSON.stringify({ type: 'agent_notification_message', task: { ...root, status: 'DONE' }, content: { type: 'text', data: 'SYNTHETIC earlier reply' } }),
        JSON.stringify({ type: 'runtime_done', task: root, content: {} }),
      ])
    ).toEqual({ status: 'failed', reason: 'agent_stopped', message: 'The run ended without a Member 360 result.' });
  });

  it('ignores user, trigger, nested/tool, stream, progress, model-turn and reasoning text', () => {
    const payloads = ['not json', 'null', '[]'];
    for (const type of ['user_message', 'trigger_message'])
      payloads.push(
        JSON.stringify({ type, task: { ...root, status: 'DONE' }, session: { status: 'FAILED' }, content: { type: 'text', data: 'SYNTHETIC private input' } })
      );
    for (const type of ['runtime_done', 'runtime_error', 'agent_notification_message'])
      payloads.push(JSON.stringify({ type, task: { entity_type: 'EntTaskTool', status: 'DONE' }, content: { type: 'text', data: 'SYNTHETIC tool text' } }));
    for (const type of ['runtime_done', 'agent_notification_message'])
      for (const parent of [{ parent_task_id: 'synthetic-parent' }, { parent_task: { id: 'synthetic-parent' } }])
        payloads.push(
          JSON.stringify({ type, task: { entity_type: 'EntTaskAgent', ...parent, status: 'DONE' }, content: { type: 'text', data: 'SYNTHETIC child reply' } })
        );
    payloads.push(
      JSON.stringify({
        type: 'agent_notification_message',
        task: root,
        content: { type: 'application/guild-response-stream', text: 'SYNTHETIC partial reply' },
      }),
      JSON.stringify({ type: 'agent_notification_progress', task: root, content: { type: 'text', data: 'SYNTHETIC progress' } }),
      JSON.stringify({ type: 'llm_done', task: root, content: { type: 'text', text: 'SYNTHETIC model turn' } }),
      JSON.stringify({ type: 'agent_notification_message', task: root, content: { type: 'application/guild-reasoning-progress', text: 'SYNTHETIC reasoning' } })
    );
    const facts = mktgOneOffTerminalFacts(payloads);
    // The original Member predicate still sees the parent_task-only runtime_done; current facts do not.
    expect(facts).toEqual({ ...emptyFacts, rootDone: true });
    expect(mktgOneOffTurnEnded(facts)).toBe(false);
  });

  it.each(MKTG_ONE_OFF_TERMINAL_TASK_STATUSES)('recognizes current root task status %s without requiring text or runtime_done', (status) => {
    expect(mktgOneOffTerminalFacts([JSON.stringify({ type: 'agent_notification_progress', task: { ...root, status }, content: {} })])).toEqual({
      ...emptyFacts,
      rootTaskEnded: true,
    });
  });

  it.each(['DONE', 'FAILED', 'ERROR', 'ABORTED', 'CANCELLED', 'CANCELED', 'COMPLETED'])(
    'retains explicit %s session metadata without echoing internal errors',
    (status) => {
      expect(
        mktgOneOffTerminalFacts([JSON.stringify({ type: 'session_status', session: { status }, content: { text: 'SYNTHETIC internal detail' } })])
      ).toEqual({ ...emptyFacts, sessionEnded: true });
    }
  );

  it('prefers trimmed done text, then the last root message, then the common fallback', () => {
    expect(mktgOneOffFailureText({ ...emptyFacts, currentDoneText: ' SYNTHETIC done ', lastRootMessageText: 'SYNTHETIC earlier message' })).toBe(
      'SYNTHETIC done'
    );
    expect(mktgOneOffFailureText({ ...emptyFacts, currentDoneText: ' ', lastRootMessageText: ' SYNTHETIC final message ' })).toBe('SYNTHETIC final message');
    expect(mktgOneOffFailureText(emptyFacts)).toBe(MKTG_ONE_OFF_STOPPED_MESSAGE);
  });

  it.each(['currentDoneText', 'lastRootMessageText'] as const)('bounds %s using the common limit', (key) => {
    expect(mktgOneOffFailureText({ ...emptyFacts, [key]: 'x'.repeat(MKTG_ONE_OFF_FAILURE_MESSAGE_MAX_CHARS + 1) })).toHaveLength(
      MKTG_ONE_OFF_FAILURE_MESSAGE_MAX_CHARS
    );
  });

  it('keeps error evidence separate from the last final runtime reply', () => {
    expect(
      mktgOneOffTerminalFacts([
        JSON.stringify({ type: 'runtime_error', content: { message: 'SYNTHETIC provider details' } }),
        JSON.stringify({ type: 'runtime_done', task: root, content: { type: 'text', text: 'SYNTHETIC first reply' } }),
        JSON.stringify({ type: 'runtime_done', task: root, content: { type: 'text', text: 'SYNTHETIC final reply' } }),
      ])
    ).toEqual({
      ...emptyFacts,
      rootDone: true,
      failed: true,
      doneText: 'SYNTHETIC final reply',
      currentRootDone: true,
      currentDoneText: 'SYNTHETIC final reply',
    });
  });
});
