// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const {
  assertOrgUid,
  assertOrgLensRead,
  assertOrgLensRoiProjectSlug,
  parseOrgLensRoiMethod,
  getSummary,
  getCoverage,
  getAnnual,
  getInvestmentBreakdown,
  getProjects,
  getProjectDetail,
  getProjectAnnual,
  logger,
} = vi.hoisted(() => ({
  assertOrgUid: vi.fn(),
  assertOrgLensRead: vi.fn(),
  assertOrgLensRoiProjectSlug: vi.fn(),
  parseOrgLensRoiMethod: vi.fn(),
  getSummary: vi.fn(),
  getCoverage: vi.fn(),
  getAnnual: vi.fn(),
  getInvestmentBreakdown: vi.fn(),
  getProjects: vi.fn(),
  getProjectDetail: vi.fn(),
  getProjectAnnual: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../helpers/org-uid.helper', () => ({ assertOrgUid }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ assertOrgLensRead }));
vi.mock('../helpers/org-lens-roi-method.helper', () => ({ parseOrgLensRoiMethod }));
vi.mock('../helpers/org-lens-roi-project-slug.helper', () => ({ assertOrgLensRoiProjectSlug }));
vi.mock('../services/org-lens-roi.service', () => ({
  OrgLensRoiService: class {
    public getSummary = getSummary;
    public getCoverage = getCoverage;
    public getAnnual = getAnnual;
    public getInvestmentBreakdown = getInvestmentBreakdown;
    public getProjects = getProjects;
    public getProjectDetail = getProjectDetail;
    public getProjectAnnual = getProjectAnnual;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { OrgLensRoiController } from './org-lens-roi.controller';

const ORG_UID = '001410000000000AAA';
const PROJECT_SLUG = 'kubernetes';

function buildReq(query: Record<string, unknown> = {}): Request {
  return { params: { orgUid: ORG_UID, projectSlug: PROJECT_SLUG }, query, path: '/test' } as unknown as Request;
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
    assertOrgLensRoiProjectSlug.mockReturnValue(undefined);
    parseOrgLensRoiMethod.mockReturnValue('logit');
    assertOrgLensRead.mockResolvedValue(undefined);
    getSummary.mockResolvedValue({ hasData: false });
    getCoverage.mockResolvedValue({ coverageReason: 'unmapped' });
    getAnnual.mockResolvedValue({ rows: [] });
    getInvestmentBreakdown.mockResolvedValue({ rows: [], total: 0 });
    getProjects.mockResolvedValue({ method: 'logit', rows: [] });
    getProjectDetail.mockResolvedValue({ orgUid: ORG_UID, method: 'logit', project: { projectSlug: PROJECT_SLUG }, hasOrgLensProject: true });
    getProjectAnnual.mockResolvedValue({ method: 'logit', projectSlug: PROJECT_SLUG, rows: [], apportioned: true, efficiencyConstant: true });
  });

  // Every handler on the controller belongs here. A new endpoint added without a row is silently
  // exempt from the ordering and refusal coverage below, which is the failure this list exists to
  // prevent — not merely a gap in the count.
  const handlers = [
    { name: 'getSummary', operation: 'get_org_lens_roi_summary', service: getSummary },
    { name: 'getCoverage', operation: 'get_org_lens_roi_coverage', service: getCoverage },
    { name: 'getAnnual', operation: 'get_org_lens_roi_annual', service: getAnnual },
    { name: 'getInvestmentBreakdown', operation: 'get_org_lens_roi_investment_breakdown', service: getInvestmentBreakdown },
    { name: 'getProjects', operation: 'get_org_lens_roi_projects', service: getProjects },
    { name: 'getProjectDetail', operation: 'get_org_lens_roi_project_detail', service: getProjectDetail },
    { name: 'getProjectAnnual', operation: 'get_org_lens_roi_project_annual', service: getProjectAnnual },
  ] as const;

  /** The two handlers that take a `:projectSlug`, and so carry a fourth validation and a 404 path. */
  const projectHandlers = [
    { name: 'getProjectDetail', operation: 'get_org_lens_roi_project_detail', service: getProjectDetail },
    { name: 'getProjectAnnual', operation: 'get_org_lens_roi_project_annual', service: getProjectAnnual },
  ] as const;

  it('covers every request handler the controller exposes', () => {
    // Without this, adding a sixth endpoint and forgetting the list above would leave it with no
    // authorization coverage at all — and the suite would still report every test passing.
    const prototype = Object.getPrototypeOf(controller) as Record<string, unknown>;
    const requestHandlers = Object.getOwnPropertyNames(prototype).filter((key) => {
      const value = prototype[key];
      // Express handlers take (req, res, next); `send` and the constructor do not.
      return key !== 'constructor' && typeof value === 'function' && value.length === 3;
    });

    expect(requestHandlers.sort()).toEqual(handlers.map((handler) => handler.name).sort());
  });

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

  describe.each(projectHandlers)('$name — project slug', ({ name, operation, service }) => {
    it('validates the slug before checking access or reading data', async () => {
      const res = buildRes();

      await controller[name](buildReq({ method: 'logit' }), res, next);

      expect(assertOrgLensRoiProjectSlug).toHaveBeenCalledWith(PROJECT_SLUG, operation);
      // The slug reaches a cache sub-resource key, which `buildOrgCacheKey` does not validate, so
      // this has to resolve before anything builds one.
      expect(assertOrgLensRoiProjectSlug.mock.invocationCallOrder[0]).toBeLessThan(assertOrgLensRead.mock.invocationCallOrder[0]);
      expect(assertOrgLensRoiProjectSlug.mock.invocationCallOrder[0]).toBeLessThan(service.mock.invocationCallOrder[0]);
    });

    it('rejects a malformed slug without checking access or reading data', async () => {
      const invalid = Object.assign(new Error('invalid projectSlug'), { statusCode: 400 });
      assertOrgLensRoiProjectSlug.mockImplementationOnce(() => {
        throw invalid;
      });
      const res = buildRes();

      await controller[name](buildReq(), res, next);

      expect(assertOrgLensRead).not.toHaveBeenCalled();
      expect(service).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(invalid);
    });

    it('forwards a 404 — never an empty 200 — when the slug names no project of this organization', async () => {
      // The distinction this asserts is a product requirement, not a formality: answering 200 with
      // an empty payload would let another organization's project read as "measured, no data".
      service.mockResolvedValueOnce(null);
      const res = buildRes();

      await controller[name](buildReq(), res, next);

      expect(res.json).not.toHaveBeenCalled();
      const error = vi.mocked(next).mock.calls[0][0] as { statusCode?: number };
      expect(error.statusCode).toBe(404);
    });
  });
});
