// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const personaMocks = vi.hoisted(() => ({ getPersonas: vi.fn() }));
const projectMocks = vi.hoisted(() => ({ getWriterSummary: vi.fn() }));
const flagMocks = vi.hoisted(() => ({ isServerFeatureEnabled: vi.fn() }));
const authMocks = vi.hoisted(() => ({ getEffectiveUsername: vi.fn(), getEffectiveEmail: vi.fn(), hasActiveImpersonationSession: vi.fn() }));

vi.mock('../utils/auth-helper', async () => {
  const actual = await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper');
  return {
    ...actual,
    getEffectiveUsername: authMocks.getEffectiveUsername,
    getEffectiveEmail: authMocks.getEffectiveEmail,
    hasActiveImpersonationSession: authMocks.hasActiveImpersonationSession,
  };
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
  ({
    path: '/api/gw/newsletters',
    bearerToken: 'token-1',
    method: 'POST',
    readableEnded: false,
    resume: vi.fn(),
    // The drain is awaited, so the stub has to actually settle it — otherwise every denial below
    // would sit on the 5s cap. 'end' fires on the next microtask, standing in for a client that
    // finishes sending once the server starts reading.
    once: vi.fn((event: string, callback: () => void) => {
      if (event === 'end') {
        queueMicrotask(callback);
      }
    }),
    ...overrides,
  }) as unknown as Request;

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
    authMocks.hasActiveImpersonationSession.mockReturnValue(false);
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

  describe('drain ordering', () => {
    // The reason the drain is awaited rather than fire-and-forget. From the controller's own 413
    // notes: once the response emits `finish`, Node stops feeding the socket into `req`, which
    // severs the drain a few milliseconds after it starts. Responding first and draining second is
    // the same hang with an extra step, so the ordering IS the fix and is asserted directly.
    it('finishes draining before the error is handed on', async () => {
      const order: string[] = [];
      let endCallback: (() => void) | undefined;

      const req = buildReq({
        resume: vi.fn(() => order.push('resume')),
        once: vi.fn((event: string, callback: () => void) => {
          if (event === 'end') {
            endCallback = callback;
          }
        }),
      } as unknown as Partial<Request>);

      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockResolvedValue(NO_WRITER);
      next = vi.fn(() => order.push('next')) as NextFunction & ReturnType<typeof vi.fn>;

      const inFlight = requireGwEmbedAccess(req, res, next);

      // Spin the microtask queue until the drain has registered its listener — the middleware
      // awaits two lookups before reaching it, so a fixed number of ticks races the test.
      for (let i = 0; i < 50 && !endCallback; i++) {
        await Promise.resolve();
      }
      expect(endCallback).toBeDefined();

      // The client has not finished sending, so the denial must not have been handed on yet.
      expect(order).not.toContain('next');

      (endCallback as unknown as () => void)();
      await inFlight;

      expect(order).toEqual(['resume', 'next']);
    });

    it('does not wait on a GET, which has no body to drain', async () => {
      const req = buildReq({ method: 'GET', resume: vi.fn() } as unknown as Partial<Request>);
      personaMocks.getPersonas.mockResolvedValue(NO_ACCESS);
      projectMocks.getWriterSummary.mockResolvedValue(NO_WRITER);

      await requireGwEmbedAccess(req, res, next);

      expect(req.resume).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });
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

  describe('impersonation', () => {
    // The route's two identities diverge while impersonating: authorization below resolves the
    // impersonated TARGET from req.bearerToken, while the controller forwards the browser's own
    // Gatewaze bearer, which belongs to the real user. A write would be audited as the wrong one.
    beforeEach(() => authMocks.hasActiveImpersonationSession.mockReturnValue(true));

    it('refuses the proxy outright, before any authorization work', async () => {
      personaMocks.getPersonas.mockResolvedValue({ isRootWriter: true, personas: ['executive-director'] });

      await requireGwEmbedAccess(buildReq(), res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'GW_EMBED_IMPERSONATION_BLOCKED' }));
      // Refused even for a root writer / ED — the block is about identity, not privilege.
      expect(personaMocks.getPersonas).not.toHaveBeenCalled();
    });

    it('lets the caller finish sending rather than leaving an upload stuck', async () => {
      const req = buildReq();

      await requireGwEmbedAccess(req, res, next);

      expect(req.resume).toHaveBeenCalled();
    });

    it('still carries the correlation id, since the denial terminates here', async () => {
      await requireGwEmbedAccess(buildReq(), res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    });
  });
});
