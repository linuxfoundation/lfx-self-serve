// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assertOrgLensRead: vi.fn(), getAccessAwareOrgs: vi.fn(), toRollUpSet: vi.fn() }));

vi.mock('./org-lens-read-access.helper', () => ({ assertOrgLensRead: mocks.assertOrgLensRead }));
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = mocks.getAccessAwareOrgs;
    public toRollUpSet = mocks.toRollUpSet;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'viewer' }));

const { resolveOrgLensRollUp } = await import('./org-lens-roll-up.helper');

const ROOT = '0016100000ROOTAAA1';
const A = '0016100000AAAAAAA1';
const B = '0016100000BBBBBBB1';
const orgs = [A, B].map((accountId) => ({ uid: accountId, accountId, name: accountId, logoUrl: null }));

const run = () => resolveOrgLensRollUp({ path: '/x' } as unknown as Request, `family-${ROOT}`, 'op');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAccessAwareOrgs.mockResolvedValue({});
  mocks.toRollUpSet.mockReturnValue({ families: [{ rootUid: ROOT, orgs }], lookupOutcome: 'ok', degraded: false });
});

describe('resolveOrgLensRollUp: the all employee view is excluded from roll-up membership', () => {
  it('leaves a company the caller reaches only as an employee out of the members', async () => {
    mocks.assertOrgLensRead.mockImplementation(async (_req: unknown, orgUid: string) => (orgUid === A ? 'org-grant' : 'employee-view'));

    const scope = await run();

    expect(scope.members.map((member) => member.accountId)).toEqual([A]);
  });

  it('refuses the roll-up when every company resolves only as employee-view', async () => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');

    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('keeps grant holders and authorizer-entitled companies', async () => {
    mocks.assertOrgLensRead.mockImplementation(async (_req: unknown, orgUid: string) => (orgUid === A ? 'org-grant' : 'auditor-entitlement'));

    expect((await run()).members).toHaveLength(2);
  });
});
