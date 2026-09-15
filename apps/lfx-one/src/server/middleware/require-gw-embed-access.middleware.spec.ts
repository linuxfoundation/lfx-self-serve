// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const personaMocks = vi.hoisted(() => ({ getPersonas: vi.fn() }));
const projectMocks = vi.hoisted(() => ({ getWriterSummary: vi.fn() }));
const flagMocks = vi.hoisted(() => ({ isServerFeatureEnabled: vi.fn() }));
const authMocks = vi.hoisted(() => ({ getEffectiveUsername: vi.fn(), getEffectiveEmail: vi.fn() }));

vi.mock('../utils/auth-helper', async () => {
  const actual = await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper');
  return { ...actual, getEffectiveUsername: authMocks.getEffectiveUsername, getEffectiveEmail: authMocks.getEffectiveEmail };
});
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { getPersonas: personaMocks.getPersonas } }));
vi.mock('../services/project.service', () => ({ ProjectService: vi.fn(() => ({ getWriterSummary: projectMocks.getWriterSummary })) }));
vi.mock('../services/logger.service', () => ({
  logger: { debug: vi.fn(), startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../helpers/server-feature-flag.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/server-feature-flag.helper')>('../helpers/server-feature-flag.helper');
  return { ...actual, isServerFeatureEnabled: flagMocks.isServerFeatureEnabled };
});

import { requireGwEmbedAccess } from './require-gw-embed-access.middleware';

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({ path: '/api/gw/newsletters', bearerToken: 'token-1', method: 'POST', readableEnded: false, resume: vi.fn(), ...overrides }) as unknown as Request;

const NO_ACCESS = { isRootWriter: false, personas: ['contributor'] };
const NO_WRITER = { hasWriterFoundation: false, hasWriterProject: false };

describe('requireGwEmbedAccess', () => {
  let next: NextFunction & ReturnType<typeof vi.fn>;
  let res: Response & { setHeader: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    flagMocks.isServerFeatureEnabled.mockReturnValue(true);
    // No identity by default: the writer-summary cache keys on one, so an absent key routes every
    // case below through the uncached path and keeps them independent of cache state.
    authMocks.getEffectiveUsername.mockReturnValue(null);
    authMocks.getEffectiveEmail.mockReturnValue(null);
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
    const headers = new Map<string, unknown>();
    res = {
      setHeader: vi.fn((name: string, value: unknown) => headers.set(String(name).toLowerCase(), value)),
      getHeader: vi.fn((name: string) => headers.get(String(name).toLowerCase())),
    } as unknown as Response & { setHeader: ReturnType<typeof vi.fn> };
  });

  it('denies an authenticated caller holding no ED persona, no root writer and no writer grant', async () => {
    // The gap this middleware exists to close: the routes require newsletterAccessGuard, so a
    // Contributor with no project role must not be able to relay through the proxy either.
    personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
    projectMocks.getWriterSummary.mockResolvedValue(NO_WRITER);

    await requireGwEmbedAccess(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'GW_EMBED_ACCESS_REQUIRED' }));
    // The route promises a correlation id on every response, and a denial terminates here.
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
  });

  it('lets a denied caller finish sending, rather than leaving the upload stuck', async () => {
    // apiErrorHandler answers without reading the request. Nothing else reads it either, so
    // without an explicit discard the client cannot finish writing — the hang the controller's
    // 413 path needed its drain protocol to avoid.
    personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
    projectMocks.getWriterSummary.mockResolvedValue(NO_WRITER);
    const req = buildReq();

    await requireGwEmbedAccess(req, res, next);

    expect(req.resume).toHaveBeenCalled();
  });

  it('still denies when the request exposes no resume(), rather than turning a 403 into a 500', async () => {
    personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
    projectMocks.getWriterSummary.mockResolvedValue(NO_WRITER);

    await requireGwEmbedAccess(buildReq({ resume: undefined } as unknown as Partial<Request>), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'GW_EMBED_ACCESS_REQUIRED' }));
  });

  it.each([
    ['root writer', { isRootWriter: true, personas: ['contributor'] }],
    ['executive director', { isRootWriter: false, personas: ['executive-director'] }],
  ])('admits a %s without enumerating writer grants', async (_label, personas) => {
    personaMocks.getPersonas.mockResolvedValue(personas);

    await requireGwEmbedAccess(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith();
    // The enumeration is the expensive call; the common pilot personas must not pay for it.
    expect(projectMocks.getWriterSummary).not.toHaveBeenCalled();
  });

  it.each([
    ['a foundation', { hasWriterFoundation: true, hasWriterProject: false }],
    ['a project', { hasWriterFoundation: false, hasWriterProject: true }],
  ])('admits a non-ED caller holding writer on %s', async (_label, summary) => {
    personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
    projectMocks.getWriterSummary.mockResolvedValue(summary);

    await requireGwEmbedAccess(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['the flag is off', { flag: false, bearer: 'token-1' }],
    ['the caller has no bearer', { flag: true, bearer: undefined }],
  ])('defers to the controller uniform 404 when %s, rather than disclosing the route with a 403', async (_label, { flag, bearer }) => {
    flagMocks.isServerFeatureEnabled.mockReturnValue(flag);

    await requireGwEmbedAccess(buildReq({ bearerToken: bearer } as Partial<Request>), res, next);

    expect(next).toHaveBeenCalledWith();
    // Must not run an authorization check it would have to answer with a disclosing status.
    expect(personaMocks.getPersonas).not.toHaveBeenCalled();
  });

  it('fails closed when the persona lookup throws, rather than admitting the caller', async () => {
    const boom = new Error('persona service unavailable');
    personaMocks.getPersonas.mockRejectedValue(boom);

    await requireGwEmbedAccess(buildReq(), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    // Called with the error, never with nothing — the latter would be an open pass.
    expect(next).not.toHaveBeenCalledWith();
  });

  describe('writer-summary caching', () => {
    // `/api/gw/*` is called many times per screen, and getWriterSummary fully paginates the
    // caller's direct grants and access-checks every one. Uncached, a plain writer paid that sweep
    // on every proxied request. Each case uses its own identity: the cache is module-scoped and
    // deliberately outlives a single test.
    const asUser = (username: string): Request => {
      authMocks.getEffectiveUsername.mockReturnValue(username);
      return buildReq();
    };

    it('reuses one lookup across repeated calls from the same caller', async () => {
      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockResolvedValue({ hasWriterFoundation: true, hasWriterProject: false });

      await requireGwEmbedAccess(asUser('writer-reuse'), res, next);
      await requireGwEmbedAccess(asUser('writer-reuse'), res, next);
      await requireGwEmbedAccess(asUser('writer-reuse'), res, next);

      expect(projectMocks.getWriterSummary).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenNthCalledWith(3);
    });

    it('never serves one caller the grants of another', async () => {
      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockResolvedValueOnce({ hasWriterFoundation: true, hasWriterProject: false });
      projectMocks.getWriterSummary.mockResolvedValueOnce(NO_WRITER);

      await requireGwEmbedAccess(asUser('writer-a'), res, next);
      await requireGwEmbedAccess(asUser('writer-b'), res, next);

      expect(projectMocks.getWriterSummary).toHaveBeenCalledTimes(2);
      // The second caller holds nothing, so the cached admit must not have carried over.
      expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('does not cache under an absent identity, which would pool unrelated callers together', async () => {
      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockResolvedValue(NO_WRITER);

      await requireGwEmbedAccess(buildReq(), res, next);
      await requireGwEmbedAccess(buildReq(), res, next);

      expect(projectMocks.getWriterSummary).toHaveBeenCalledTimes(2);
    });

    it('retries after a failed lookup instead of pinning the caller for the whole TTL', async () => {
      // A cached rejection would deny a legitimate writer for the full window over one blip.
      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockRejectedValueOnce(new Error('query service unavailable'));
      projectMocks.getWriterSummary.mockResolvedValueOnce({ hasWriterFoundation: true, hasWriterProject: false });

      await requireGwEmbedAccess(asUser('writer-blip'), res, next);
      expect(next).toHaveBeenLastCalledWith(expect.any(Error));

      await requireGwEmbedAccess(asUser('writer-blip'), res, next);

      expect(projectMocks.getWriterSummary).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenLastCalledWith();
    });

    it('falls back to the email when no username is present', async () => {
      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockResolvedValue({ hasWriterFoundation: true, hasWriterProject: false });
      authMocks.getEffectiveEmail.mockReturnValue('writer@example.test');

      await requireGwEmbedAccess(buildReq(), res, next);
      await requireGwEmbedAccess(buildReq(), res, next);

      expect(projectMocks.getWriterSummary).toHaveBeenCalledTimes(1);
    });
  });
});
