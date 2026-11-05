// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ subject: vi.fn(), impersonating: vi.fn(), user: vi.fn(), warning: vi.fn() }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: mocks.subject, isImpersonating: mocks.impersonating }));
vi.mock('./user.service', () => ({
  UserService: class {
    public getUserInfo = mocks.user;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: mocks.warning } }));
import { MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT, MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { AuthenticationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import type { MktgLastKnownAuthorName } from '@lfx-one/shared/interfaces';
import { MktgDocumentAuthorService } from './mktg-document-author.service';

describe('shared document/comment attribution', () => {
  let authors: MktgDocumentAuthorService;
  let lastKnown: Map<string, MktgLastKnownAuthorName>;
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
  afterEach(() => {
    vi.useRealTimers();
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

  it.each([new MicroserviceError('Directory unavailable', 503, 'UNAVAILABLE'), new ResourceNotFoundError('User'), new Error('NATS timeout')])(
    'serves the last successfully resolved name across requests when the lookup throws %s, saying so in the log',
    async (err) => {
      expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
      mocks.user.mockRejectedValue(err);
      const outage = {} as Request;
      expect(await authors.resolveAuthor(outage, 'opaque-writer')).toEqual({ name: 'Project writer' });
      expect(mocks.user).toHaveBeenCalledTimes(2);
      expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(outage, 'mktg_document_store_author', 'Author lookup failed — showing the last known name', {
        err,
        served_stale: true,
      });
      expect(JSON.stringify(mocks.warning.mock.calls)).not.toContain('Project writer');
    }
  );

  it('shows no name when no lookup for that subject ever succeeded, whatever another subject resolved to', async () => {
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    mocks.user.mockRejectedValue(new MicroserviceError('Directory unavailable', 503, 'UNAVAILABLE'));
    expect(await authors.resolveAuthor({} as Request, 'opaque-approver')).toEqual({ name: null });
    expect(lastKnown.has('opaque-approver')).toBe(false);
  });

  it('refreshes the remembered name on a later success and forgets it when the directory now returns none', async () => {
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    mocks.user.mockResolvedValue({ success: true, data: { name: 'Renamed writer' } });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Renamed writer' });
    mocks.user.mockRejectedValue(new Error('NATS timeout'));
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Renamed writer' });
    mocks.user.mockResolvedValue({ success: true, data: { name: '' } });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: null });
    mocks.user.mockRejectedValue(new Error('NATS timeout'));
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: null });
  });

  it.each(['failed to get M2M token', 'user not found'])(
    "serves the last known name on the directory's success:false answer (%s), which it gives for any upstream error",
    async (error) => {
      expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
      mocks.user.mockResolvedValue({ success: false, error });
      const failed = {} as Request;
      expect(await authors.resolveAuthor(failed, 'opaque-writer')).toEqual({ name: 'Project writer' });
      expect(lastKnown.has('opaque-writer')).toBe(true);
      expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(failed, 'mktg_document_store_author', 'Author lookup failed — showing the last known name', {
        served_stale: true,
      });
      expect(JSON.stringify(mocks.warning.mock.calls)).not.toContain('Project writer');
    }
  );

  it('stops serving a remembered name once its window has passed, until a lookup succeeds again', async () => {
    vi.useFakeTimers();
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    mocks.user.mockRejectedValue(new Error('NATS timeout'));
    vi.advanceTimersByTime(MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS - 1);
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Project writer' });
    vi.advanceTimersByTime(1);
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: null });
    expect(lastKnown.has('opaque-writer')).toBe(false);
    mocks.user.mockResolvedValue({ success: true, data: { name: 'Project writer' } });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Project writer' });
    mocks.user.mockRejectedValue(new Error('NATS timeout'));
    vi.advanceTimersByTime(MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS - 1);
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer')).toEqual({ name: 'Project writer' });
  });

  it('sweeps expired names from memory when another subject resolves, so no name outlives its window', async () => {
    vi.useFakeTimers();
    expect(await authors.resolveAuthor(req, 'opaque-writer')).toEqual({ name: 'Project writer' });
    vi.advanceTimersByTime(MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS / 2);
    expect(await authors.resolveAuthor({} as Request, 'opaque-reviewer')).toEqual({ name: 'Project writer' });
    vi.advanceTimersByTime(MKTG_DOCUMENT_AUTHOR_CACHE_TTL_MS / 2);
    expect(await authors.resolveAuthor({} as Request, 'opaque-approver')).toEqual({ name: 'Project writer' });
    expect([...lastKnown.keys()]).toEqual(['opaque-reviewer', 'opaque-approver']);
  });

  it('keeps the remembered names bounded, dropping the least recently refreshed subject first', async () => {
    for (let index = 0; index <= MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT; index++) {
      mocks.user.mockResolvedValue({ success: true, data: { name: `Writer ${index}` } });
      await authors.resolveAuthor({} as Request, `opaque-writer-${index}`);
    }
    expect(lastKnown.size).toBe(MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT);
    mocks.user.mockRejectedValue(new Error('NATS timeout'));
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer-0')).toEqual({ name: null });
    expect(await authors.resolveAuthor({} as Request, 'opaque-writer-1')).toEqual({ name: 'Writer 1' });
    expect(await authors.resolveAuthor({} as Request, `opaque-writer-${MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT}`)).toEqual({
      name: `Writer ${MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT}`,
    });
  });
});
