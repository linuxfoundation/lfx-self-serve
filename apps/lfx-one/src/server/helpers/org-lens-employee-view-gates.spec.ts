// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertOrgLensRead: vi.fn(),
  getScopes: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'employee'),
}));

vi.mock('./org-lens-read-access.helper', () => ({ assertOrgLensRead: mocks.assertOrgLensRead }));
vi.mock('../services/org-cla-manager-scopes.service', () => ({
  OrgClaManagerScopesService: class {
    public getCompanySfids = mocks.getScopes;
  },
}));
vi.mock('../services/access-check.service', () => ({ AccessCheckService: class {} }));
vi.mock('../services/org-role-grants.service', () => ({ OrgRoleGrantsService: class {} }));
vi.mock('../services/logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => mocks.getEffectiveUsername() }));

const { assertOrgLensClaRead } = await import('./org-lens-cla-access.helper');
const { assertOrgAnalyticsRead } = await import('./org-analytics-access.helper');

const ORG_UID = '0016100000ACMEAAA1';
const req = (method = 'GET'): Request => ({ path: '/api/orgs/x/lens/cla-groups', method }) as unknown as Request;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getEffectiveUsername.mockReturnValue('employee');
  mocks.getScopes.mockResolvedValue(new Set());
});

describe('assertOrgLensClaRead: employee-view is not admitted', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('refuses an employee-only %s with 403 EMPLOYEE_VIEW_FORBIDDEN', async (method) => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');

    await expect(assertOrgLensClaRead(req(method), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
  });

  it('still admits a CLA Manager of the company through the CLA scope', async () => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');
    mocks.getScopes.mockResolvedValue(new Set([ORG_UID]));

    await expect(assertOrgLensClaRead(req('POST'), ORG_UID, 'op')).resolves.toBe('cla-manager-scope');
  });

  it('leaves a grant holder unchanged', async () => {
    mocks.assertOrgLensRead.mockResolvedValue('org-grant');

    await expect(assertOrgLensClaRead(req('POST'), ORG_UID, 'op')).resolves.toBe('org-grant');
  });
});

describe('assertOrgAnalyticsRead: employee-view is refused unless a route opts in', () => {
  it('refuses an employee-only caller by default', async () => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');

    await expect(assertOrgAnalyticsRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
  });

  it('admits the employee view for a route that opts in', async () => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');

    await expect(assertOrgAnalyticsRead(req(), ORG_UID, 'op', { allowEmployeeView: true })).resolves.toBeUndefined();
  });

  it('leaves grant holders and staff unchanged', async () => {
    mocks.assertOrgLensRead.mockResolvedValue('auditor-entitlement');

    await expect(assertOrgAnalyticsRead(req(), ORG_UID, 'op')).resolves.toBeUndefined();
  });
});
