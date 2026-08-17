// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.route.spec.ts: validation.helper's import graph transitively reaches
// Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { getMyClas, resolveIdentity, getPdfUrl, getSignHandoff } = vi.hoisted(() => ({
  getMyClas: vi.fn(),
  resolveIdentity: vi.fn(),
  getPdfUrl: vi.fn(),
  getSignHandoff: vi.fn(),
}));
const { listClaGroupOptions } = vi.hoisted(() => ({ listClaGroupOptions: vi.fn() }));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/cla-group-search.stub', () => ({ listClaGroupOptions }));
vi.mock('../services/cla.service', () => ({
  ClaService: class {
    public getMyClas = getMyClas;
    public resolveIdentity = resolveIdentity;
    public getPdfUrl = getPdfUrl;
    public getSignHandoff = getSignHandoff;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthenticationError, MicroserviceError } from '../errors';
import { ClasController } from './clas.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;
}

const iclaAgreement = { id: 'sig-icla', kind: 'ICLA', projectName: 'p', signedOn: '2022-01-01', status: 'valid', pdfAvailable: true };
const resolvedIdentity = { lfUsername: 'alice', emails: [], githubIds: [], githubUsernames: [], githubLinked: false };

beforeEach(() => {
  vi.clearAllMocks();
  getUsernameFromAuth.mockResolvedValue('alice');
  resolveIdentity.mockResolvedValue(resolvedIdentity);
});

describe('ClasController.getMyClas', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getMyClas({ params: {} } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('never passes request-supplied identity to the service (session-derived only)', async () => {
    const response = { agreements: [iclaAgreement], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };
    getMyClas.mockResolvedValue(response);
    const res = buildRes();
    // A malicious body/query attempting to select another user's data.
    const req = { params: {}, body: { userId: 'someone-else' }, query: { userID: 'someone-else' } } as any;

    await new ClasController().getMyClas(req, res, vi.fn());

    // The service is called with only (req); the controller passes no identity argument.
    expect(getMyClas).toHaveBeenCalledWith(req);
    expect(getMyClas).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(response);
  });

  it('forwards upstream failures to the error handler', async () => {
    getMyClas.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const next = vi.fn();

    await new ClasController().getMyClas({ params: {} } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
  });
});

describe('ClasController.getPdfUrl', () => {
  it('returns the presigned URL for an owned ICLA', async () => {
    getPdfUrl.mockResolvedValue({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    const res = buildRes();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, res, vi.fn());

    expect(getPdfUrl).toHaveBeenCalledWith(expect.anything(), 'sig-icla', resolvedIdentity);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('returns 404 (never 403) when the endpoint reports no owned PDF (unknown / not-owned / ECLA)', async () => {
    // Ownership + ICLA-eligibility is enforced upstream; the service returns null on the endpoint's 404.
    getPdfUrl.mockResolvedValue(null);
    const res = buildRes();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-x' } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('forwards non-404 upstream failures to the error handler', async () => {
    getPdfUrl.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const next = vi.fn();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sign CLA hand-off (#1251)
// ---------------------------------------------------------------------------

describe('ClasController.getSignHandoff', () => {
  const handoff = { claUserId: 'u-1', redirectUrl: 'https://app.dev.lfx.dev/profile/clas' };

  it('returns the server-resolved identifier and return URL', async () => {
    getSignHandoff.mockResolvedValue(handoff);
    const res = buildRes();

    await new ClasController().getSignHandoff({ params: {}, query: {}, body: {} } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(handoff);
  });

  it('ignores a client-supplied identifier — the session is the only source (FR-003)', async () => {
    getSignHandoff.mockResolvedValue(handoff);
    const res = buildRes();
    // An attempt to have the hand-off carry someone else's EasyCLA record.
    const req = { params: {}, query: { claUserId: 'someone-else' }, body: { claUserId: 'someone-else' } } as any;

    await new ClasController().getSignHandoff(req, res, vi.fn());

    // The service receives only (req) — no identifier is threaded through from input.
    expect(getSignHandoff).toHaveBeenCalledWith(req);
    expect(res.json).toHaveBeenCalledWith(handoff);
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ claUserId: 'someone-else' }));
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getSignHandoff({ params: {}, query: {}, body: {} } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getSignHandoff).not.toHaveBeenCalled();
  });

  it('forwards a failed resolution instead of returning a partial payload', async () => {
    getSignHandoff.mockRejectedValue(new MicroserviceError('no user id', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getSignHandoff({ params: {}, query: {}, body: {} } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('ClasController.getClaGroupOptions', () => {
  it('returns the stubbed selection options', async () => {
    listClaGroupOptions.mockReturnValue([{ claGroupId: 'cg-1', projectName: 'Venus test' }]);
    const res = buildRes();

    await new ClasController().getClaGroupOptions({ params: {}, query: {} } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith([{ claGroupId: 'cg-1', projectName: 'Venus test' }]);
  });

  it('forwards the picker query to the search', async () => {
    listClaGroupOptions.mockReturnValue([]);

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: 'venus' } } as any, buildRes(), vi.fn());

    // The query has to survive the route for #1250 to be a drop-in replacement of the search
    // alone. If the controller dropped it, the picker would silently list everything.
    expect(listClaGroupOptions).toHaveBeenCalledWith('venus');
  });

  it('treats a repeated or malformed q as an empty query rather than failing', async () => {
    listClaGroupOptions.mockReturnValue([]);

    // Express parses a repeated ?q=&q= into an array; it must not reach the search as one.
    await new ClasController().getClaGroupOptions({ params: {}, query: { q: ['a', 'b'] } } as any, buildRes(), vi.fn());

    expect(listClaGroupOptions).toHaveBeenCalledWith('');
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getClaGroupOptions({ params: {}, query: {} } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
  });
});
