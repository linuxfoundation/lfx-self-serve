// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { listClaGroups, getPdfUrl } = vi.hoisted(() => ({ listClaGroups: vi.fn(), getPdfUrl: vi.fn() }));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/org-cla.service', () => ({
  OrgClaService: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthenticationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgClasController } from './org-clas.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsernameFromAuth.mockResolvedValue('alice');
});

describe('OrgClasController.listClaGroups', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().listClaGroups({ params: { orgUid: '0014100000Te2ovAAB' }, query: {}, body: {} } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(res.json).not.toHaveBeenCalled();
    expect(listClaGroups).not.toHaveBeenCalled();
  });

  it('never passes a client-supplied user id to the service', async () => {
    const response = { orgUid: '0014100000Te2ovAAB', claGroups: [] };
    listClaGroups.mockResolvedValue(response);
    const res = buildRes();
    const req = {
      params: { orgUid: '0014100000Te2ovAAB' },
      body: { userId: 'someone-else' },
      query: { userID: 'someone-else' },
    } as any;

    await new OrgClasController().listClaGroups(req, res, vi.fn());

    expect(listClaGroups).toHaveBeenCalledWith(req, '0014100000Te2ovAAB');
    expect(listClaGroups).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(response);
  });

  it('marks the response no-store, so the CLA list never lands in a shared cache', async () => {
    listClaGroups.mockResolvedValue({ orgUid: '0014100000Te2ovAAB', claGroups: [] });
    const res = buildRes();

    await new OrgClasController().listClaGroups({ params: { orgUid: '0014100000Te2ovAAB' }, query: {}, body: {} } as any, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

describe('OrgClasController.getPdfUrl', () => {
  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getPdfUrl({ params: { orgUid: '0014100000Te2ovAAB', signatureId: 'signature-uuid-1' } } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('rejects a blank signature id before calling the service', async () => {
    const { ServiceValidationError } = await import('../errors');
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getPdfUrl({ params: { orgUid: '0014100000Te2ovAAB', signatureId: '  ' } } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('answers 404 when the service finds no document url', async () => {
    getPdfUrl.mockResolvedValue(null);
    const res = buildRes();

    await new OrgClasController().getPdfUrl({ params: { orgUid: '0014100000Te2ovAAB', signatureId: 'signature-uuid-1' } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Signed document not found' });
    // A handled outcome still closes the operation, or the endpoint's duration and completion
    // telemetry counts drift apart from its request count.
    expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'get_org_cla_pdf_url', expect.anything(), expect.objectContaining({ found: false }));
  });

  it('returns the url and marks the response no-store', async () => {
    getPdfUrl.mockResolvedValue({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 });
    const res = buildRes();
    const req = { params: { orgUid: '0014100000Te2ovAAB', signatureId: 'signature-uuid-1' } } as any;

    await new OrgClasController().getPdfUrl(req, res, vi.fn());

    // The grant-checked orgUid is forwarded, not dropped: it is what scopes the signature to the
    // caller's organization, so a controller that passed only the id would leave the path open.
    expect(getPdfUrl).toHaveBeenCalledWith(req, '0014100000Te2ovAAB', 'signature-uuid-1');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 });
  });
});
