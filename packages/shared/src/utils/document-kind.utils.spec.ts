// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ProjectDocument } from '../interfaces/project.interface';
import { resolveProjectDocumentKind } from './document-kind.utils';

const doc = (overrides: Partial<ProjectDocument>): ProjectDocument => ({ uid: 'u', type: 'link', name: 'Doc', ...overrides });

describe('resolveProjectDocumentKind', () => {
  it('returns undefined for folders', () => {
    expect(resolveProjectDocumentKind(doc({ type: 'folder' }), 'project')).toBeUndefined();
  });

  it.each(['recording', 'transcript', 'summary'] as const)('names a %s row by its source', (source) => {
    expect(resolveProjectDocumentKind(doc({ type: 'link' }), source)).toBe(source);
  });

  it('trusts the server document_kind for meeting attachments typed link upstream', () => {
    expect(resolveProjectDocumentKind(doc({ type: 'link', document_kind: 'file' }), 'meeting')).toBe('file');
  });

  it('trusts the server document_kind for mailing list links', () => {
    expect(resolveProjectDocumentKind(doc({ type: 'link', document_kind: 'link' }), 'mailing_list')).toBe('link');
  });

  it('labels a committee file as a file and a project link as a link', () => {
    expect(resolveProjectDocumentKind(doc({ type: 'file' }), 'committee')).toBe('file');
    expect(resolveProjectDocumentKind(doc({ type: 'link' }), 'project')).toBe('link');
  });
});
