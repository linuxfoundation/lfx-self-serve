// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Epic #5845: the Crowdfunding pages (Initiatives and Donations) are hidden entirely in the all employee view. The routes
 * live under `/api/crowdfunding`, so the controller asks the lens gate itself and refuses an employee with 403
 * `EMPLOYEE_VIEW_FORBIDDEN` before any upstream call.
 */

const ORG_UID = '0016100000ACMEAAA1';

const mocks = vi.hoisted(() => ({
  employeeViewEnabled: vi.fn(),
  resolveOrgLensViewMode: vi.fn(),
  getOrgDonations: vi.fn(),
  getMyInitiatives: vi.fn(),
  getInitiativesStats: vi.fn(),
}));

vi.mock('../helpers/org-lens-employee-view-flag.helper', () => ({ isOrgLensEmployeeViewEnabled: mocks.employeeViewEnabled }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ resolveOrgLensViewMode: mocks.resolveOrgLensViewMode }));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: vi.fn().mockResolvedValue('synthetic-user') }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => Date.now()), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/crowdfunding.service', () => ({
  CrowdfundingService: class {
    public getOrgDonations = mocks.getOrgDonations;
    public getMyInitiatives = mocks.getMyInitiatives;
    public getInitiativesStats = mocks.getInitiativesStats;
  },
}));

const { CrowdfundingController } = await import('./crowdfunding.controller');

const request = (query: Record<string, string>): Request => ({ query }) as unknown as Request;
const response = (): Response => ({ json: vi.fn() }) as unknown as Response;

const calls: [
  string,
  (controller: InstanceType<typeof CrowdfundingController>, req: Request, res: Response, next: () => void) => Promise<void>,
  Record<string, string>,
][] = [
  ['the organization initiatives list', (c, req, res, next) => c.getMyInitiatives(req, res, next), { orgUid: ORG_UID }],
  ['the initiatives stats for a company', (c, req, res, next) => c.getInitiativesStats(req, res, next), { orgUid: ORG_UID }],
  ['the company donations', (c, req, res, next) => c.getOrgDonations(req, res, next), { orgUid: ORG_UID }],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.employeeViewEnabled.mockReturnValue(true);
  mocks.resolveOrgLensViewMode.mockResolvedValue('full');
  mocks.getOrgDonations.mockResolvedValue({ data: [], total: 0, pageSize: 20, offset: 0 });
  mocks.getMyInitiatives.mockResolvedValue({ data: [], total: 0, pageSize: 20, offset: 0 });
  mocks.getInitiativesStats.mockResolvedValue({});
});

describe('Crowdfunding controller in the all employee view', () => {
  it.each(calls)('refuses %s with 403 EMPLOYEE_VIEW_FORBIDDEN and never reaches the Crowdfunding service', async (_label, run, query) => {
    mocks.resolveOrgLensViewMode.mockResolvedValue('employee');
    const next = vi.fn();

    await run(new CrowdfundingController(), request(query), response(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
    expect(mocks.getOrgDonations).not.toHaveBeenCalled();
    expect(mocks.getMyInitiatives).not.toHaveBeenCalled();
    expect(mocks.getInitiativesStats).not.toHaveBeenCalled();
  });

  it.each(calls)('serves %s to a full-view caller as before', async (_label, run, query) => {
    const res = response();
    const next = vi.fn();

    await run(new CrowdfundingController(), request(query), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(mocks.resolveOrgLensViewMode).toHaveBeenCalledWith(expect.anything(), ORG_UID, expect.any(String));
  });

  it.each(calls)('asks no gate and changes nothing for %s while the employee view is off', async (_label, run, query) => {
    mocks.employeeViewEnabled.mockReturnValue(false);
    const res = response();

    await run(new CrowdfundingController(), request(query), res, vi.fn());

    expect(mocks.resolveOrgLensViewMode).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it('leaves the project and foundation lens initiatives list alone: only a company scope is gated', async () => {
    const res = response();

    await new CrowdfundingController().getMyInitiatives(request({ projectUid: '7c1a9000-0000-4000-8000-000000000001' }), res, vi.fn());

    expect(mocks.resolveOrgLensViewMode).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
