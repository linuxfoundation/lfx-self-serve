// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getWorkExperiencesForUser } = vi.hoisted(() => ({
  execute: vi.fn(),
  getWorkExperiencesForUser: vi.fn(),
}));

// The shared barrels pull Angular-compiled modules into a Node test run; narrow them to the entries
// this service actually uses, as the other server-service specs do.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/invitation.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/org-lens-projects.constants')),
  ...(await import('../../../../../packages/shared/src/constants/social-listening.constants')),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
vi.mock('./cdp.service', () => ({
  CdpService: class {
    public getWorkExperiencesForUser = getWorkExperiencesForUser;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { debug: vi.fn(), startOperation: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { OrgLensEmployerAffiliationService } from './org-lens-employer-affiliation.service';

const REQ = {} as never;

function experience(organization: string, endDate?: string): WorkExperienceEntry {
  return { id: `we-${organization}`, organization, jobTitle: 'Engineer', startDate: 'Jan 2020', endDate, source: 'manual' };
}

function rows(...values: { ACCOUNT_ID: string; ACCOUNT_NAME: string; ACTIVE_MEMBERSHIP_COUNT: number }[]): { rows: typeof values } {
  return { rows: values };
}

describe('OrgLensEmployerAffiliationService', () => {
  let service: OrgLensEmployerAffiliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrgLensEmployerAffiliationService();
  });

  it('answers "no employer" without touching Snowflake when the profile has no work history', async () => {
    getWorkExperiencesForUser.mockResolvedValue([]);

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: null,
      accountId: null,
      hasActiveMembership: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports a current employer with no active memberships as a non-member', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Bank Pekao')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-1', ACCOUNT_NAME: 'Bank Pekao', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Bank Pekao',
      accountId: 'acc-1',
      hasActiveMembership: false,
    });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('ORG_LENS_ACCOUNT_CONTEXT'), ['Bank Pekao']);
  });

  it('reports an employer with active memberships as a member', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('ServiceNow')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-2', ACCOUNT_NAME: 'ServiceNow', ACTIVE_MEMBERSHIP_COUNT: 3 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
  });

  // A company nobody has a Salesforce account for certainly holds no membership.
  it('reports an employer that matches no account as a non-member, with no account id', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Corner Shop Ltd')]);
    execute.mockResolvedValue(rows());

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Corner Shop Ltd',
      accountId: null,
      hasActiveMembership: false,
    });
  });

  // The shared `currentEmployerFromWorkExperiences` falls back to the most recent ended job; naming a
  // company someone has left is exactly the misleading copy this state exists to remove.
  it('reports no employer for a profile whose jobs have all ended', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Former Employer', 'Dec 2023'), experience('Older Employer', 'Jan 2020')]);

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: null,
      accountId: null,
      hasActiveMembership: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('asks about the current employer, not a past one', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Former Employer', 'Dec 2023'), experience('Current Employer')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-3', ACCOUNT_NAME: 'Current Employer', ACTIVE_MEMBERSHIP_COUNT: 1 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ employerName: 'Current Employer' });
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['Current Employer']);
  });

  // Duplicate account names must not let an empty row downgrade a member company.
  it('orders a duplicated company name so the account holding memberships answers', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-4', ACCOUNT_NAME: 'Acme', ACTIVE_MEMBERSHIP_COUNT: 2 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
    expect(execute.mock.calls[0][0]).toContain('ORDER BY ACTIVE_MEMBERSHIP_COUNT DESC');
  });
});
