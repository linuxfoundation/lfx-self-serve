// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_DOCUMENT_COMMENT_ID_REGEX } from '../constants/mktg-document-comments.constants';
import { mktgSignOffRequestIds } from './mktg-sign-off.utils';

const revision = `000001-${'a'.repeat(64)}`;
describe('sign-off request correlation', () => {
  it('namespaces IDs by full revision and role without subject data, within CR bounds', () => {
    const ids = mktgSignOffRequestIds(revision, 'tocChair', 'n'.repeat(36));
    if (!ids) throw new Error('Missing synthetic IDs');
    for (const id of Object.values(ids)) {
      expect(id.length).toBeLessThanOrEqual(128);
      expect(MKTG_DOCUMENT_COMMENT_ID_REGEX.test(id)).toBe(true);
    }
    expect(ids).not.toEqual(mktgSignOffRequestIds(revision, 'ed', 'n'.repeat(36)));
    expect(ids).not.toEqual(mktgSignOffRequestIds(`000002-${'a'.repeat(64)}`, 'tocChair', 'n'.repeat(36)));
    expect(ids).toEqual(mktgSignOffRequestIds(revision, 'tocChair', 'n'.repeat(36)));
  });
  it.each(['', 'bad/nonce', 'n'.repeat(37)])('rejects invalid nonce %s before an intent is committed', (nonce) => {
    expect(mktgSignOffRequestIds(revision, 'ed', nonce)).toBeNull();
  });
  it('rejects legacy and malformed revision IDs', () => {
    expect(mktgSignOffRequestIds(`legacy-${'a'.repeat(64)}`, 'ed', 'nonce')).toBeNull();
    expect(mktgSignOffRequestIds('current', 'ed', 'nonce')).toBeNull();
  });
});
