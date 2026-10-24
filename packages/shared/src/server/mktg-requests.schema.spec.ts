// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgCreateRequestSchema, mktgRequestStateSchema, mktgRequestsRecordSchema } from './mktg-requests.schema';
import { MKTG_REQUESTS_SCHEMA, MKTG_REQUEST_TARGET_ID_MAX } from '../constants/mktg-requests.constants';
import type { MktgRequestsRecord } from '../interfaces/mktg-requests.interface';

const create = {
  project: 'synthetic-project',
  kind: 'asset',
  target: { familyId: 'positioning-brand' },
  text: 'Synthetic request',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
};
const state = { project: create.project, state: 'done', clientRequestId: create.clientRequestId };
const result = { agentKey: 'faq', documentId: 'living', revisionId: `000002-${'b'.repeat(64)}` };
function historicalRecord(): MktgRequestsRecord {
  return {
    schema: MKTG_REQUESTS_SCHEMA,
    project: create.project,
    requests: [
      {
        id: create.clientRequestId,
        clientRequestId: create.clientRequestId,
        kind: 'change',
        target: { familyId: 'retired-family', assetId: 'retired-asset', agentKey: 'retired-agent', documentId: 'living', revisionId: result.revisionId },
        text: create.text,
        requestedBy: 'opaque-writer',
        requesterCommittees: [],
        createdAt: '2026-10-24T00:00:00.000Z',
        state: 'open',
        stateChangedAt: '2026-10-24T00:00:00.000Z',
        stateChangedBy: null,
        note: null,
        stateChanges: [],
      },
    ],
  };
}

describe('Marketing requests input schemas', () => {
  it('accepts asset and document-backed change requests, preserves text and opaque targets', () => {
    expect(mktgCreateRequestSchema.parse({ ...create, text: '  Synthetic request  ' }).text).toBe('  Synthetic request  ');
    expect(
      mktgCreateRequestSchema.safeParse({
        ...create,
        kind: 'change',
        target: { ...create.target, agentKey: 'faq', documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` },
      }).success
    ).toBe(true);
    expect(mktgCreateRequestSchema.safeParse({ ...create, text: 'x'.repeat(2000) }).success).toBe(true);
    for (const target of [
      { ...create.target, assetId: 'one-pager' },
      { ...create.target, assetId: 'faq', agentKey: 'faq' },
    ]) {
      expect(mktgCreateRequestSchema.parse({ ...create, target }).target).toEqual(target);
    }
  });

  it.each([
    null,
    [],
    {},
    { ...create, project: '../unsafe' },
    { ...create, project: ['project'] },
    { ...create, kind: 'unknown' },
    { ...create, text: '' },
    { ...create, text: '  ' },
    { ...create, text: 'x'.repeat(2001) },
    { ...create, clientRequestId: '' },
    { ...create, requestedBy: 'spoofed' },
    { ...create, target: null },
    { ...create, target: { familyId: 'unknown' } },
    { ...create, target: { ...create.target, assetId: '' } },
    { ...create, target: { ...create.target, assetId: 'pitch-deck' } },
    { ...create, target: { ...create.target, assetId: 'faq', agentKey: 'brand-kit' } },
    { ...create, target: { ...create.target, assetId: 'one-pager', agentKey: 'faq' } },
    { ...create, target: { ...create.target, agentKey: 'unknown' } },
    { ...create, target: { familyId: 'website-web', agentKey: 'faq' } },
    { ...create, kind: 'change' },
    { ...create, target: { ...create.target, documentId: 'living' } },
    { ...create, target: { ...create.target, agentKey: 'faq', documentId: '../unsafe' } },
    { ...create, target: { ...create.target, revisionId: `000001-${'a'.repeat(64)}` } },
    { ...create, target: { ...create.target, agentKey: 'faq', documentId: 'living', revisionId: 'invalid' } },
  ])('rejects invalid create input %#', (input) => {
    expect(mktgCreateRequestSchema.safeParse(input).success).toBe(false);
  });

  it.each(['in-progress', 'done', 'declined'])('accepts state %s with a bounded note', (value) => {
    expect(mktgRequestStateSchema.safeParse({ ...state, state: value, note: 'Synthetic note' }).success).toBe(true);
  });
  it('requires a complete result reference and accepts it only on done', () => {
    expect(mktgRequestStateSchema.parse({ ...state, result })).toMatchObject({ state: 'done', result });
    for (const value of ['open', 'in-progress', 'declined'])
      expect(mktgRequestStateSchema.safeParse({ ...state, state: value, note: 'Synthetic note', result }).success).toBe(false);
    for (const invalid of [{ revisionId: result.revisionId }, { ...result, documentId: '../bad' }, { ...result, revisionId: 'bad' }])
      expect(mktgRequestStateSchema.safeParse({ ...state, result: invalid }).success).toBe(false);
  });
  it('uses an explicit withdrawal action, not free-text note semantics', () => {
    const withdraw = { project: create.project, clientRequestId: create.clientRequestId, withdraw: true };
    expect(mktgRequestStateSchema.parse(withdraw)).toEqual(withdraw);
    expect(mktgRequestStateSchema.safeParse({ ...withdraw, state: 'declined' }).success).toBe(true);
    for (const invalid of [
      { ...withdraw, state: 'done' },
      { ...withdraw, note: 'not server-owned' },
      { ...withdraw, result },
      { ...withdraw, withdraw: false },
    ])
      expect(mktgRequestStateSchema.safeParse(invalid).success).toBe(false);
    expect(mktgRequestStateSchema.safeParse({ ...state, state: 'declined', note: 'withdrawn' }).success).toBe(true);
  });
  it('reads retired catalog identifiers while rejecting them for new requests', () => {
    const stored = historicalRecord();
    expect(mktgRequestsRecordSchema.parse(stored).requests[0]?.target).toEqual(stored.requests[0]?.target);
    expect(mktgCreateRequestSchema.safeParse({ ...create, target: stored.requests[0]?.target }).success).toBe(false);
    stored.requests = stored.requests.map((row) => ({ ...row, state: 'done', result: { ...result, agentKey: 'retired-agent' } }));
    expect(mktgRequestsRecordSchema.safeParse(stored).success).toBe(true);
  });
  it.each([
    { familyId: '' },
    { familyId: 'x'.repeat(MKTG_REQUEST_TARGET_ID_MAX + 1) },
    { familyId: 'retired', documentId: 'living' },
    { familyId: 'retired', agentKey: 'old', revisionId: result.revisionId },
  ])('still rejects malformed historical target structure %#', (target) => {
    const stored = historicalRecord();
    stored.requests = stored.requests.map((row) => ({ ...row, target }));
    expect(mktgRequestsRecordSchema.safeParse(stored).success).toBe(false);
  });

  it.each([
    null,
    {},
    { ...state, project: '../unsafe' },
    { ...state, state: 'unknown' },
    { ...state, state: 'declined' },
    { ...state, state: 'declined', note: '  ' },
    { ...state, note: 'x'.repeat(2001) },
    { ...state, note: 1 },
    { ...state, resultRevisionId: 'invalid' },
    { ...state, clientRequestId: 'invalid' },
    { ...state, changedBy: 'spoofed' },
  ])('rejects invalid state input %#', (input) => {
    expect(mktgRequestStateSchema.safeParse(input).success).toBe(false);
  });
});
