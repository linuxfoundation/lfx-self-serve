// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  readMktgActiveRunConflict,
  readMktgRunAnsweredConflict,
  readMktgRunNotFailedConflict,
  mktgActiveRunConflictHeading,
  mktgRunNotFailedNotice,
} from './mktg-run-active.utils';

const body = {
  code: 'MKTG_RUN_ACTIVE',
  message: 'A run is in progress.',
  startedBy: 'Synthetic writer',
  startedByViewer: false,
  startedAt: '2026-10-19T12:00:00.000Z',
  activeRunId: 'b'.repeat(64),
  state: 'writing',
  agentKey: 'brand-kit',
  documentId: 'living',
};

describe('answered-run acknowledgement', () => {
  const answered = { code: 'MKTG_RUN_ANSWERED', answeredBy: 'Synthetic writer', answeredAt: '2026-10-19T12:00:00Z' };
  it('projects only the display name and time contract', () => {
    expect(readMktgRunAnsweredConflict({ ...answered, creatorSubject: 'private-subject', sessionId: 'private-session' })).toEqual(answered);
  });
  it.each([null, 'bad', { ...answered, code: 'OTHER' }, { ...answered, answeredBy: '' }, { ...answered, answeredAt: 'bad' }])(
    'rejects malformed acknowledgement %j',
    (value) => {
      expect(readMktgRunAnsweredConflict(value)).toBeNull();
    }
  );
});

describe('refused dismiss', () => {
  const runId = 'b'.repeat(64);
  const refused = {
    code: 'MKTG_RUN_NOT_FAILED',
    runId,
    change: 'retried',
    changedBy: 'Synthetic Writer',
    changedByViewer: false,
    changedAt: '2026-10-19T12:00:00Z',
  };
  it('projects only who and when from the actual top-level response, never an opaque server field', () => {
    const body = { ...refused, message: 'x', error: 'x', path: '/api/synthetic', closedBySubject: 'private-subject', sessionId: 'private-session' };
    expect(readMktgRunNotFailedConflict(body, runId)).toEqual(refused);
  });
  it.each([
    null,
    'bad',
    [refused],
    { code: 'MKTG_RUN_NOT_FAILED', runId },
    { ...refused, code: 'OTHER' },
    { ...refused, runId: 'c'.repeat(64) },
    { ...refused, change: 'answered' },
    { ...refused, changedByViewer: 'true' },
    { ...refused, changedAt: 'invalid' },
    { ...refused, changedAt: undefined },
  ])('names nobody for a body it cannot validate %j', (value) => {
    expect(readMktgRunNotFailedConflict(value, runId)).toBeNull();
  });
  it('never trusts facts for a run id this page could not have dismissed', () => {
    expect(readMktgRunNotFailedConflict({ ...refused, runId: '../unsafe' }, '../unsafe')).toBeNull();
  });
  it.each(['writer@synthetic.example', 'auth0|synthetic-subject', '<b>Synthetic</b>', '  ', 7, null])(
    'keeps the conflict but drops %j as a name',
    (changedBy) => {
      expect(readMktgRunNotFailedConflict({ ...refused, changedBy }, runId)).toEqual({ ...refused, changedBy: null });
    }
  );
  it.each([
    [
      { change: 'closed', changedBy: 'Synthetic Writer', changedByViewer: false },
      '19 Oct, 12:00',
      'Synthetic Writer already closed this run at 19 Oct, 12:00.',
    ],
    [
      { change: 'retried', changedBy: 'Synthetic Writer', changedByViewer: false },
      '19 Oct, 12:00',
      'Synthetic Writer already retried this run at 19 Oct, 12:00.',
    ],
    [{ change: 'retried', changedBy: null, changedByViewer: true }, '19 Oct, 12:00', 'You already retried this run at 19 Oct, 12:00.'],
    [{ change: 'closed', changedBy: null, changedByViewer: false }, '19 Oct, 12:00', 'Someone on your team already closed this run at 19 Oct, 12:00.'],
    [{ change: 'retried', changedBy: 'Synthetic Writer', changedByViewer: false }, '', 'Synthetic Writer already retried this run.'],
  ] as const)('says %j at %j as %j', (facts, localTime, line) => {
    expect(mktgRunNotFailedNotice({ ...facts, changedAt: refused.changedAt }, localTime)).toBe(line);
  });
  it.each([
    ['closed', 'Brand Kit', '19 Oct, 12:30', 'Synthetic Writer already closed the Brand Kit run started at 19 Oct, 12:10 (closed at 19 Oct, 12:30).'],
    ['retried', 'Brand Kit', '19 Oct, 12:30', 'Synthetic Writer already retried the Brand Kit run started at 19 Oct, 12:10 (retried at 19 Oct, 12:30).'],
    ['closed', 'Brand Kit', '', 'Synthetic Writer already closed the Brand Kit run started at 19 Oct, 12:10.'],
    ['closed', 'Member 360 run', '', 'Synthetic Writer already closed the Member 360 run started at 19 Oct, 12:10.'],
  ] as const)('says which run was %s, by the label %j and its started time, at %j', (change, label, localTime, line) => {
    const facts = { change, changedBy: 'Synthetic Writer', changedByViewer: false, changedAt: refused.changedAt };
    expect(mktgRunNotFailedNotice(facts, localTime, { label, started: '19 Oct, 12:10' })).toBe(line);
  });
  it.each([
    [{ changedBy: null, changedByViewer: true }, 'You already closed the Brand Kit run started at 19 Oct, 12:10.'],
    [{ changedBy: null, changedByViewer: false }, 'Someone on your team already closed the Brand Kit run started at 19 Oct, 12:10.'],
  ])('keeps the viewer and the unnamed writer as they are with a run to name %j', (who, line) => {
    expect(mktgRunNotFailedNotice({ change: 'closed', changedAt: null, ...who }, '', { label: 'Brand Kit', started: '19 Oct, 12:10' })).toBe(line);
  });
  it('gives no time when the record has none, whatever the caller formats', () => {
    expect(mktgRunNotFailedNotice({ change: 'closed', changedBy: 'Synthetic Writer', changedByViewer: false, changedAt: null }, '19 Oct, 12:00')).toBe(
      'Synthetic Writer already closed this run.'
    );
    const untimed = { ...refused, changedAt: null };
    expect(readMktgRunNotFailedConflict(untimed, runId)).toEqual(untimed);
  });
});

describe('active-run conflict choices', () => {
  it('accepts the actual top-level error response and ignores unrelated error metadata', () => {
    const conflict = readMktgActiveRunConflict({ ...body, error: body.message, service: 'object_store', path: '/api/synthetic' }, 'brand-kit');
    expect(conflict).toEqual(body);
    expect(conflict && mktgActiveRunConflictHeading(conflict)).toBe("Synthetic writer's Brand Kit run is in progress");
  });
  it.each([true, false])('uses viewer ownership for a living FAQ heading (own=%s)', (startedByViewer) => {
    const conflict = readMktgActiveRunConflict({ ...body, agentKey: 'faq', startedByViewer }, 'faq');
    expect(conflict).not.toBeNull();
    expect(conflict && mktgActiveRunConflictHeading(conflict)).toBe(
      startedByViewer ? 'Your FAQ run is in progress' : "Synthetic writer's FAQ run is in progress"
    );
  });
  it.each([
    { code: 'OTHER' },
    { state: 'failed' },
    { activeRunId: '../unsafe' },
    { documentId: 'run-' + 'a'.repeat(24) },
    { agentKey: 'faq' },
    { startedBy: '' },
    { startedBy: null },
    { startedByViewer: undefined },
    { startedByViewer: 'true' },
    { startedAt: undefined },
    { startedAt: 'invalid' },
  ])('rejects malformed or out-of-slot facts %j', (override) => {
    expect(readMktgActiveRunConflict({ ...body, ...override }, 'brand-kit')).toBeNull();
  });
  it.each([
    ['linkedin-post', 'LinkedIn post'],
    ['member-360', 'Member 360'],
  ])('uses the exact one-off %s title, without a doubled run suffix', (agentKey, label) => {
    const conflict = readMktgActiveRunConflict({ ...body, agentKey, documentId: 'run-' + 'a'.repeat(24) }, agentKey);
    expect(conflict).not.toBeNull();
    expect(conflict && mktgActiveRunConflictHeading(conflict)).toBe(`Your ${label} run is in progress`);
    expect(readMktgActiveRunConflict({ ...body, agentKey }, agentKey)).toBeNull();
  });
});
