// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, proxyRequestWithResponse } = vi.hoisted(() => ({ proxyRequest: vi.fn(), proxyRequestWithResponse: vi.fn() }));

vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('../services/org-role-grants.service', () => ({ OrgRoleGrantsService: class {} }));
vi.mock('../services/org-lens-addresses.service', () => ({ OrgLensAddressesService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import { OrgIdentityController } from './org-identity.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn() } as any;
}

const VALID_UID = '001Dn00000ExAmPleA'; // 18-char SFID shape
const rawOrg = { uid: VALID_UID, name: 'Acme', logo_url: 'https://cdn.example.com/logo.png?v=1' };

beforeEach(() => {
  vi.clearAllMocks();
  proxyRequestWithResponse.mockResolvedValue({ data: rawOrg, status: 200, statusText: 'OK', headers: { etag: 'W/"etag-1"' } });
});

describe('OrgIdentityController.uploadLogo', () => {
  it('rejects an invalid uid without calling the proxy', async () => {
    const next = vi.fn();
    const req = { params: { uid: 'not-a-valid-uid' }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, buildRes(), next);

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects an unsupported content type without calling the proxy', async () => {
    const next = vi.fn();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, buildRes(), next);

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects an empty body without calling the proxy', async () => {
    const next = vi.fn();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.alloc(0) } as any;

    await new OrgIdentityController().uploadLogo(req, buildRes(), next);

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('fetches a fresh ETag before uploading and forwards it as If-Match, returning the canonical record', async () => {
    proxyRequest.mockResolvedValue(rawOrg);
    const res = buildRes();
    const body = Buffer.from('binary-image-bytes');
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png; charset=binary' }, body } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/b2b_orgs/${VALID_UID}`, 'GET');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/b2b_orgs/${VALID_UID}/logo`, 'POST', undefined, body, {
      'Content-Type': 'image/png',
      'If-Match': 'W/"etag-1"',
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ uid: VALID_UID, logoUrl: rawOrg.logo_url }));
  });

  it('fails closed with a 502 when the pre-upload fetch carries no ETag, rather than forwarding "undefined"', async () => {
    proxyRequestWithResponse.mockResolvedValue({ data: rawOrg, status: 200, statusText: 'OK', headers: {} });
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(proxyRequest).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unable to upload logo. Please try again.' });
  });

  it('maps a 403 upstream rejection to a 403 permission-denied envelope', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN', { service: 'member_service' }));
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'You no longer have permission to edit this organization.' });
  });

  it('maps a 404 upstream rejection to a 404', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'member_service' }));
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Organization not found' });
  });

  it('maps a 500 upstream failure to a 502', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('boom', 500, 'UPSTREAM_ERROR', { service: 'member_service' }));
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unable to upload logo. Please try again.' });
  });

  it('maps a 412 upstream rejection (org changed since the pre-upload fetch) to a 409 conflict', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('precondition failed', 412, 'PRECONDITION_FAILED', { service: 'member_service' }));
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'This organization was updated elsewhere. Refresh the page and try again.' });
  });

  it('maps a 404 from the pre-upload ETag fetch to a 404, without attempting the upload', async () => {
    proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'member_service' }));
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(proxyRequest).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Organization not found' });
  });

  it('maps a 408 upstream timeout to a 502', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('timeout', 408, 'TIMEOUT', { service: 'member_service' }));
    const res = buildRes();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('forwards any other error to next', async () => {
    proxyRequest.mockRejectedValue(new Error('unexpected'));
    const next = vi.fn();
    const req = { params: { uid: VALID_UID }, headers: { 'content-type': 'image/png' }, body: Buffer.from('abc') } as any;

    await new OrgIdentityController().uploadLogo(req, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
