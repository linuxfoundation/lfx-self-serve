// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { assertOrgUid, assertOrgLensRead, parseOrgLensRoiMethod, getSummary, getCoverage, getAnnual, logger } = vi.hoisted(() => ({
  assertOrgUid: vi.fn(),
  assertOrgLensRead: vi.fn(),
  parseOrgLensRoiMethod: vi.fn(),
  getSummary: vi.fn(),
  getCoverage: vi.fn(),
  getAnnual: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../helpers/org-uid.helper', () => ({ assertOrgUid }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ assertOrgLensRead }));
vi.mock('../helpers/org-lens-roi-method.helper', () => ({ parseOrgLensRoiMethod }));
vi.mock('../services/org-lens-roi.service', () => ({
  OrgLensRoiService: class {
    public getSummary = getSummary;
    public getCoverage = getCoverage;
    public getAnnual = getAnnual;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { OrgLensRoiController } from './org-lens-roi.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(query: Record<string, unknown> = {}): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

/**
 * These endpoints serve organization-level financial aggregates and their only per-organization
 * authorization barrier is `assertOrgLensRead`. The Playwright suite intercepts the route and
 * manufactures the 403, so it proves the client handles a refusal — not that the server produces
 * one. It would stay green if this gate were deleted or moved after the Snowflake read.
 *
 * The page's dark-launch flag does not help: flags are evaluated in the browser and gate no
 * endpoint, so these routes are reachable by any authenticated caller from the moment they ship.
 *
 * Hence the ordering assertions below. It is not enough that the gate is called — it must resolve
 * before the service does any work, or a refused caller still costs a cache read and a warehouse
 * query, and a cached payload could be served alongside the eventual error.
 */
describe('OrgLensRoiController — authorization gate', () => {
  let controller: OrgLensRoiController;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new OrgLensRoiController();
    next = vi.fn();
    assertOrgUid.mockReturnValue(undefined);
    parseOrgLensRoiMethod.mockReturnValue('logit');
    assertOrgLensRead.mockResolvedValue(undefined);
    getSummary.mockResolvedValue({ hasData: false });
    getCoverage.mockResolvedValue({ coverageReason: 'unmapped' });
    getAnnual.mockResolvedValue({ rows: [] });
  });

  const handlers = [
    { name: 'getSummary', operation: 'get_org_lens_roi_summary', service: getSummary },
    { name: 'getCoverage', operation: 'get_org_lens_roi_coverage', service: getCoverage },
    { name: 'getAnnual', operation: 'get_org_lens_roi_annual', service: getAnnual },
  ] as const;

  describe.each(handlers)('$name', ({ name, operation, service }) => {
    it('validates the org uid and the method, then checks access — all before the service runs', async () => {
      const res = buildRes();

      await controller[name](buildReq({ method: 'logit' }), res, next);

      expect(assertOrgUid).toHaveBeenCalledWith(ORG_UID, operation);
      expect(parseOrgLensRoiMethod).toHaveBeenCalledWith('logit', operation);
      expect(assertOrgLensRead).toHaveBeenCalledWith(expect.anything(), ORG_UID, operation);
      expect(service).toHaveBeenCalledTimes(1);

      const uidOrder = assertOrgUid.mock.invocationCallOrder[0];
      const methodOrder = parseOrgLensRoiMethod.mock.invocationCallOrder[0];
      const accessOrder = assertOrgLensRead.mock.invocationCallOrder[0];
      const serviceOrder = service.mock.invocationCallOrder[0];
      expect(uidOrder).toBeLessThan(methodOrder);
      // Cheap synchronous validation precedes the awaited grant lookup, so a malformed request
      // never costs a role-grants round-trip.
      expect(methodOrder).toBeLessThan(accessOrder);
      // The assertion that matters: no data access until the caller's grant is resolved.
      expect(accessOrder).toBeLessThan(serviceOrder);
      expect(next).not.toHaveBeenCalled();
    });

    it('does not touch the service when the caller has no grant, and forwards the 403', async () => {
      const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
      assertOrgLensRead.mockRejectedValueOnce(forbidden);
      const res = buildRes();

      await controller[name](buildReq(), res, next);

      expect(service).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(forbidden);
    });

    it('does not touch the service when the grant could not be verified, and forwards the 503', async () => {
      // 503 is deliberately distinct from 403 upstream: a transient outage must not tell a viewer
      // they lost access they still hold. Both must still fail closed here.
      const unavailable = Object.assign(new Error('unavailable'), { statusCode: 503 });
      assertOrgLensRead.mockRejectedValueOnce(unavailable);
      const res = buildRes();

      await controller[name](buildReq(), res, next);

      expect(service).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(unavailable);
    });

    it('rejects a malformed org uid without checking access or reading data', async () => {
      const invalid = Object.assign(new Error('invalid orgUid'), { statusCode: 400 });
      assertOrgUid.mockImplementationOnce(() => {
        throw invalid;
      });
      const res = buildRes();

      await controller[name](buildReq(), res, next);

      expect(assertOrgLensRead).not.toHaveBeenCalled();
      expect(service).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(invalid);
    });

    it('rejects an unknown estimation method without checking access or reading data', async () => {
      // Every ROI route validates `method`, including the ones whose read ignores it, so an
      // unrecognised value is rejected identically across the surface rather than by whichever
      // handlers happen to use it.
      const invalid = Object.assign(new Error('invalid method'), { statusCode: 400 });
      parseOrgLensRoiMethod.mockImplementationOnce(() => {
        throw invalid;
      });
      const res = buildRes();

      await controller[name](buildReq({ method: 'nope' }), res, next);

      expect(assertOrgLensRead).not.toHaveBeenCalled();
      expect(service).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(invalid);
    });

    it('sends the payload with no-store so the browser never caches an authorized read', async () => {
      const res = buildRes();

      await controller[name](buildReq(), res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.json).toHaveBeenCalledTimes(1);
    });
  });
});
