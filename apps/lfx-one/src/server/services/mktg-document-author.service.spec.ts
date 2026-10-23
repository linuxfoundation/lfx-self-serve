// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ subject: vi.fn(), impersonating: vi.fn(), user: vi.fn(), warning: vi.fn() }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: mocks.subject, isImpersonating: mocks.impersonating }));
vi.mock('./user.service', () => ({
  UserService: class {
    public getUserInfo = mocks.user;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: mocks.warning } }));
import { AuthenticationError, MicroserviceError } from '../errors';
import { MktgDocumentAuthorService } from './mktg-document-author.service';

describe('shared document/comment attribution', () => {
  let authors: MktgDocumentAuthorService;
  let req: Request;
  beforeEach(() => {
    vi.resetAllMocks();
    authors = new MktgDocumentAuthorService();
    req = {} as Request;
    mocks.subject.mockReturnValue('opaque-effective-subject');
    mocks.impersonating.mockReturnValue(false);
    mocks.user.mockResolvedValue({ success: true, data: { name: 'Project writer' } });
  });

  it('captures only the effective subject, without reading directory data', () => {
    expect(authors.captureAuthorId(req)).toBe('opaque-effective-subject');
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it('rejects an ordinary writer with no subject but keeps an unidentified target unattributed', () => {
    mocks.subject.mockReturnValue(null);
    expect(() => authors.captureAuthorId(req)).toThrow(AuthenticationError);
    mocks.impersonating.mockReturnValue(true);
    expect(authors.captureAuthorId(req)).toBeNull();
  });

  it('never queries the directory or invents attribution for an absent stored subject', async () => {
    expect(await authors.resolveAuthor(req, null)).toBeNull();
    expect(await authors.resolveAuthor(req, undefined)).toBeNull();
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it('shares promises between revision/comment consumers per request, not across requests', async () => {
    const [revision, comment] = await Promise.all([
      authors.resolveAuthor(req, 'opaque-writer'),
      authors.resolveAuthor(req, 'opaque-writer', 'mktg_document_comment_author'),
    ]);
    expect(revision).toEqual({ name: 'Project writer' });
    expect(comment).toEqual(revision);
    expect(mocks.user).toHaveBeenCalledExactlyOnceWith(req, 'opaque-writer');
    await authors.resolveAuthor({} as Request, 'opaque-writer');
    expect(mocks.user).toHaveBeenCalledTimes(2);
  });

  it('retains the revision store warning and error metadata exactly, once per failed author/request', async () => {
    const err = new MicroserviceError('Directory unavailable', 503, 'UNAVAILABLE');
    mocks.user.mockRejectedValue(err);
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: null });
    await authors.resolveAuthor(req, 'opaque-writer');
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(req, 'mktg_document_store_author', 'Author lookup failed — showing no name', { err });
    expect(mocks.user).toHaveBeenCalledTimes(1);
  });

  it('warns without error metadata for an unsuccessful directory response', async () => {
    mocks.user.mockResolvedValue({ success: false });
    expect(await authors.resolveAuthor(req, 'opaque-writer', 'mktg_document_comment_author', 'Comment author lookup unavailable')).toEqual({ name: null });
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(req, 'mktg_document_comment_author', 'Comment author lookup unavailable');
  });

  it('never falls back to username when the display name is empty', async () => {
    mocks.user.mockResolvedValue({ success: true, data: { name: '', username: 'synthetic-username' } });
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: null });
  });
});
