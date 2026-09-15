// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const personaMocks = vi.hoisted(() => ({ getPersonas: vi.fn() }));
const projectMocks = vi.hoisted(() => ({ getWriterSummary: vi.fn() }));
const flagMocks = vi.hoisted(() => ({ isServerFeatureEnabled: vi.fn() }));

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
});
