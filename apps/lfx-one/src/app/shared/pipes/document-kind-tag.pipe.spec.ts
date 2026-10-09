// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MyDocumentItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { DocumentKindTagPipe } from './document-kind-tag.pipe';

const doc = (overrides: Partial<MyDocumentItem>): MyDocumentItem => ({
  id: 'x',
  name: 'Doc',
  source: 'project',
  foundationName: '',
  groupOrMeetingName: '',
  groupOrMeetingUid: '',
  date: '',
  ...overrides,
});

describe('DocumentKindTagPipe', () => {
  const pipe = new DocumentKindTagPipe();

  it('returns no label for folders', () => {
    expect(pipe.transform(doc({ isFolder: true, documentKind: 'file' }))).toBeNull();
  });

  it('prefers an explicit documentKind over the source', () => {
    expect(pipe.transform(doc({ source: 'meeting', documentKind: 'file' }))?.value).toBe('File');
  });

  it.each([
    ['file', 'File'],
    ['link', 'Link'],
    ['recording', 'Recording'],
    ['transcript', 'Transcript'],
    ['summary', 'Summary'],
  ] as const)('derives %s from the source when documentKind is unset', (source, label) => {
    expect(pipe.transform(doc({ source }))?.value).toBe(label);
  });

  it('returns no label when nothing identifies the row', () => {
    expect(pipe.transform(doc({ source: 'committee' }))).toBeNull();
  });
});
