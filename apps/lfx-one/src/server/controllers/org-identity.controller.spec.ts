// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, proxyRequestWithResponse, resolveSegment, getRoleGrants } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  resolveSegment: vi.fn(),
  getRoleGrants: vi.fn(),
}));

vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getRoleGrants = getRoleGrants;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'jdoe' }));
vi.mock('../services/org-lens-addresses.service', () => ({ OrgLensAddressesService: class {} }));
vi.mock('../services/org-slug-resolver.service', () => ({
  OrgSlugResolverService: class {
    public resolveSegment = resolveSegment;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import { ORG_ROLE_GRANTS_CORRELATION_HEADER } from '@lfx-one/shared/constants';

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

// Spec 050, contracts/bff-org-slug-transport.md §3: the wire envelope is what the browser guard keys
// its branches on, and the negative envelopes must carry nothing about the organization.
describe('OrgIdentityController.resolveSegment', () => {
  const org = { uid: VALID_UID, slug: 'acme', name: 'Acme' };
  const request = (segment: string, prefer?: string) => ({ params: { segment }, query: prefer ? { prefer } : {}, path: `/api/orgs/resolve/${segment}` }) as any;

  it('answers a hit with the organization and marks the response private / no-store', async () => {
    resolveSegment.mockResolvedValue({ outcome: 'hit', org, cache: 'miss' });
    const res = buildRes();

    await new OrgIdentityController().resolveSegment(request('acme', VALID_UID), res, vi.fn());

    expect(resolveSegment).toHaveBeenCalledWith(expect.anything(), 'acme', VALID_UID);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(org);
  });

  it('answers a miss with the fixed 404 envelope', async () => {
    resolveSegment.mockResolvedValue({ outcome: 'miss', cache: 'miss' });
    const res = buildRes();

    await new OrgIdentityController().resolveSegment(request('acme'), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Organization not found' });
  });

  it('answers an unbroken tie with the fixed 409 envelope', async () => {
    resolveSegment.mockResolvedValue({ outcome: 'ambiguous', cache: 'miss' });
    const res = buildRes();

    await new OrgIdentityController().resolveSegment(request('acme'), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Organization address is ambiguous' });
  });

  // Query-service answers "no rows" with an empty 200, so any upstream status is a transport failure:
  // the fixed 502 is what lets the browser apply FR-020 (SFID through, slug not found) instead of
  // reading a routing 404 / rate-limit 429 as an answer about the address.
  it.each([503, 500, 408, 429, 404, 409, 403])('maps an upstream %i to a 502 the browser reads as "resolver unavailable" (FR-020)', async (upstream) => {
    resolveSegment.mockRejectedValue(new MicroserviceError('down', upstream, 'UPSTREAM', { operation: 'op', service: 'query' }));
    const res = buildRes();
    const next = vi.fn();

    await new OrgIdentityController().resolveSegment(request('acme'), res, next);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'Upstream query-service failure' });
    expect(next).not.toHaveBeenCalled();
  });

  it('hands validation errors to the error handler (400 stays a local answer)', async () => {
    const validation = ServiceValidationError.forField('segment', 'Invalid organization segment', { operation: 'op', service: 'svc', path: '/x' });
    resolveSegment.mockRejectedValueOnce(validation);
    const next = vi.fn();
    const res = buildRes();
    await new OrgIdentityController().resolveSegment(request('bad!'), res, next);
    expect(next).toHaveBeenCalledWith(validation);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('OrgIdentityController.getRoleGrants', () => {
  const grants = { writers: [], auditors: [], cascadingWriters: [], cascadingAuditors: [], isStaff: false, lookupOutcome: 'ok', staffCheck: 'ok' };
  const request = (query: Record<string, string> = {}) => ({ query, path: '/api/orgs/me/role-grants' }) as any;

  beforeEach(() => {
    getRoleGrants.mockResolvedValue(grants);
  });

  // Spec 053: the viewer's Retry asks for a recompute past the BFF cache; nothing else does.
  it('forwards ?refresh=1 as a cache bypass and nothing else', async () => {
    const controller = new OrgIdentityController();

    await controller.getRoleGrants(request({ refresh: '1' }), buildRes(), vi.fn());
    await controller.getRoleGrants(request({ refresh: 'yes' }), buildRes(), vi.fn());
    await controller.getRoleGrants(request(), buildRes(), vi.fn());

    expect(getRoleGrants.mock.calls.map((call) => call[2])).toEqual([true, false, false]);
  });

  // FR-011: the support reference travels in its own header — it is the id logged by the computation
  // that produced the result, which within the short cache window may be an earlier request's.
  it('sets X-Correlation-Id from a failed staff check and no correlation header otherwise', async () => {
    const controller = new OrgIdentityController();
    const failedRes = buildRes();
    getRoleGrants.mockResolvedValueOnce({ ...grants, staffCheck: 'failed', correlationId: 'ref-123' });
    await controller.getRoleGrants(request(), failedRes, vi.fn());
    expect(failedRes.setHeader).toHaveBeenCalledWith(ORG_ROLE_GRANTS_CORRELATION_HEADER, 'ref-123');
    expect(failedRes.setHeader).not.toHaveBeenCalledWith('X-Request-Id', expect.anything());

    const okRes = buildRes();
    await controller.getRoleGrants(request(), okRes, vi.fn());
    expect(okRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(okRes.setHeader).not.toHaveBeenCalledWith(ORG_ROLE_GRANTS_CORRELATION_HEADER, expect.anything());
    expect(okRes.json).toHaveBeenCalledWith(grants);
  });
});
