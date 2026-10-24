// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgCreateRequestSchema, mktgRequestStateSchema } from './mktg-requests.schema';

const create = {
  project: 'synthetic-project',
  kind: 'asset',
  target: { familyId: 'positioning-brand' },
  text: 'Synthetic request',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
};
const state = { project: create.project, state: 'done', clientRequestId: create.clientRequestId };

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
    { ...create, kind: 'change' },
    { ...create, target: { ...create.target, documentId: 'living' } },
    { ...create, target: { ...create.target, agentKey: 'faq', documentId: '../unsafe' } },
    { ...create, target: { ...create.target, revisionId: `000001-${'a'.repeat(64)}` } },
    { ...create, target: { ...create.target, agentKey: 'faq', documentId: 'living', revisionId: 'invalid' } },
  ])('rejects invalid create input %#', (input) => {
    expect(mktgCreateRequestSchema.safeParse(input).success).toBe(false);
  });

  it.each(['in-progress', 'done', 'declined'])('accepts state %s with a bounded note and result revision', (value) => {
    expect(mktgRequestStateSchema.safeParse({ ...state, state: value, note: 'Synthetic note', resultRevisionId: `000002-${'b'.repeat(64)}` }).success).toBe(
      true
    );
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
