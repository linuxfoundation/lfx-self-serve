// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAccessAwareOrgs, checkAccessStrict, getEffectiveUsername } = vi.hoisted(() => ({
  getAccessAwareOrgs: vi.fn(),
  checkAccessStrict: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkAccessStrict = checkAccessStrict;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('./org-lens-read-access.helper', () => ({ assertOrgLensRead: vi.fn() }));

import { SYNTHETIC_ORG_ACCOUNT_ID as READABLE, SYNTHETIC_SECOND_ORG_ACCOUNT_ID as UNCONFIRMED } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { filterConfirmedReadableAccountIds, filterReadableAccountIds } from './org-analytics-access.helper';

const req = {} as Request;
const OPERATION = 'synthetic_operation';

describe('readable account ids with a degraded grant roster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveUsername.mockReturnValue('synthetic-user');
    // The roster confirms one org but only as a lower bound; the authorizer does not grant the other.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Set([READABLE]), upstreamFailed: false, degraded: true });
    checkAccessStrict.mockResolvedValue(new Map([[`${UNCONFIRMED}#auditor`, false]]));
  });

  it('fails the whole batch closed for the strict filter, since the denial cannot be verified', async () => {
    await expect(filterReadableAccountIds(req, [READABLE, UNCONFIRMED], OPERATION)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('still returns the confirmed ids for the confirmed-only filter, leaving the unverified one out', async () => {
    expect(await filterConfirmedReadableAccountIds(req, [READABLE, UNCONFIRMED], OPERATION)).toEqual([READABLE]);
  });

  it('throws for the confirmed-only filter too when the authorizer itself is down', async () => {
    checkAccessStrict.mockRejectedValue(new Error('authorizer down'));
    await expect(filterConfirmedReadableAccountIds(req, [READABLE, UNCONFIRMED], OPERATION)).rejects.toMatchObject({ statusCode: 503 });
  });
});
