// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgDiscardedRunMessage, mktgRunAnsweredBy, readMktgRetiredRunHint } from './mktg-run-navigation.utils';

describe('retired run navigation', () => {
  const row = { runId: 'b'.repeat(64), state: 'discarded', replacedBy: 'c'.repeat(64), closedBy: 'Synthetic writer', closedAt: '2026-10-28T10:00:00Z' };
  it('shares scope validation and safe attribution for every answers route', () => {
    const body = { code: 'MKTG_RUN_ANSWERED', details: { runId: row.runId, questionsId: 'd'.repeat(64), answeredBy: 'Synthetic writer' } };
    expect(mktgRunAnsweredBy(body, row.runId, 'd'.repeat(64))).toBe('Synthetic writer');
    expect(mktgRunAnsweredBy({ code: 'MKTG_RUN_ANSWERED', details: { answeredBy: null } }, row.runId, 'd'.repeat(64))).toBe('Someone on your team');
    expect(mktgRunAnsweredBy(body, 'e'.repeat(64), 'd'.repeat(64))).toBeNull();
    expect(mktgRunAnsweredBy(body, row.runId, 'e'.repeat(64))).toBeNull();
    expect(mktgRunAnsweredBy({ code: 'MKTG_RUN_ANSWERED', answeredBy: 'synthetic@example.test' }, row.runId, 'd'.repeat(64))).toBe('Someone on your team');
    expect(mktgRunAnsweredBy({ code: 'MKTG_RUN_ANSWERED', details: { answeredBy: '<script>synthetic</script>' } }, row.runId, 'd'.repeat(64))).toBe(
      'Someone on your team'
    );
  });

  it('reads only safe optional hint fields and shares the exact named copy', () => {
    const hint = readMktgRetiredRunHint({ ...row, sessionId: 'synthetic-private', ownerToken: 'synthetic-private-proof' });
    expect(hint).toEqual(row);
    expect(mktgDiscardedRunMessage(hint, '10:00 AM')).toBe('This run was discarded by Synthetic writer at 10:00 AM; a newer run was started.');
  });
  it.each(['synthetic-writer@example.test', 'auth0|synthetic-subject', 'did:key:synthetic'])(
    'does not echo an identifier-like attribution (%s)',
    (closedBy) => {
      const hint = readMktgRetiredRunHint({ ...row, closedBy });
      expect(hint?.closedBy).toBeNull();
      expect(mktgDiscardedRunMessage(hint)).toBe('This run was discarded; a newer run was started.');
    }
  );
  it.each([null, {}, { ...row, state: 'writing' }, { ...row, state: 'completed' }, { ...row, runId: 'bad' }])('ignores a non-hint %j', (value) => {
    expect(readMktgRetiredRunHint(value)).toBeNull();
  });
  it('aligns the unnamed, superseded and legacy-time variants with the document page', () => {
    const hint = readMktgRetiredRunHint({ ...row, closedBy: null });
    expect(mktgDiscardedRunMessage(hint, '10:00 AM')).toBe('This run was discarded at 10:00 AM; a newer run was started.');
    expect(mktgDiscardedRunMessage(readMktgRetiredRunHint({ ...row, state: 'superseded' }))).toBe('A newer run replaced this one.');
    expect(readMktgRetiredRunHint({ ...row, closedAt: 'bad', replacedBy: 'bad' })).toMatchObject({ closedAt: null, replacedBy: null });
    expect(mktgDiscardedRunMessage(null)).toBe('This run was discarded; a newer run was started.');
  });
});
