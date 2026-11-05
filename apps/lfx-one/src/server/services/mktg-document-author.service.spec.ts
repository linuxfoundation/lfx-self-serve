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
import { MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT } from '@lfx-one/shared/constants';
import { AuthenticationError, MicroserviceError } from '../errors';
import { MktgDocumentAuthorService } from './mktg-document-author.service';

describe('shared document/comment attribution', () => {
  let authors: MktgDocumentAuthorService;
  let lastKnown: Map<string, string>;
  let req: Request;
  beforeEach(() => {
    vi.resetAllMocks();
    lastKnown = new Map();
    authors = new MktgDocumentAuthorService(lastKnown);
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

  it('memoises per request between revision/comment consumers and looks the directory up again on the next request', async () => {
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

  it.each([
    ['a rejected lookup', () => mocks.user.mockRejectedValue(new MicroserviceError('Directory unavailable', 503, 'UNAVAILABLE'))],
    ['an unsuccessful directory response', () => mocks.user.mockResolvedValue({ success: false })],
  ])('serves the last successfully resolved name across requests when %s follows it', async (_case, fail) => {
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    fail();
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Project writer' });
    expect(mocks.user).toHaveBeenCalledTimes(2);
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it('shows no name when no lookup for that subject ever succeeded, whatever another subject resolved to', async () => {
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    mocks.user.mockResolvedValue({ success: false });
    expect(await authors.resolveAuthor({} as Request, 'opaque-approver')).toEqual({ name: null });
    expect(lastKnown.has('opaque-approver')).toBe(false);
  });

  it('refreshes the remembered name on a later success and forgets it when the directory now has none', async () => {
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    mocks.user.mockResolvedValue({ success: true, data: { name: 'Renamed writer' } });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Renamed writer' });
    mocks.user.mockResolvedValue({ success: false });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Renamed writer' });
    mocks.user.mockResolvedValue({ success: true, data: { name: '' } });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: null });
    mocks.user.mockResolvedValue({ success: false });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: null });
  });

  it('keeps the remembered names bounded, dropping the least recently refreshed subject first', async () => {
    for (let index = 0; index <= MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT; index++) {
      mocks.user.mockResolvedValue({ success: true, data: { name: `Writer ${index}` } });
      await authors.resolveAuthor({} as Request, `opaque-writer-${index}`);
    }
    expect(lastKnown.size).toBe(MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT);
    mocks.user.mockResolvedValue({ success: false });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer-0')).toEqual({ name: null });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer-1')).toEqual({ name: 'Writer 1' });
    expect(await authors.resolveAuthor({} as Request, `opaque-writer-${MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT}`)).toEqual({
      name: `Writer ${MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT}`,
    });
  });
});
