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
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('ORG_LENS_ACCOUNT_CONTEXT'), ['BANKPEKAO']);
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
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['CURRENTEMPLOYER']);
  });

  // A day job alongside a foundation or board role is two open-ended entries for one person.
  it('reports a member when any current employer holds a membership, whichever entry comes first', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Bank Pekao'), experience('The Linux Foundation')]);
    execute.mockResolvedValue(
      rows(
        { ACCOUNT_ID: 'acc-lf', ACCOUNT_NAME: 'The Linux Foundation', ACTIVE_MEMBERSHIP_COUNT: 4 },
        { ACCOUNT_ID: 'acc-bp', ACCOUNT_NAME: 'Bank Pekao', ACTIVE_MEMBERSHIP_COUNT: 0 }
      )
    );

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'The Linux Foundation',
      accountId: 'acc-lf',
      hasActiveMembership: true,
    });
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['BANKPEKAO', 'THELINUXFOUNDATION']);
  });

  it('asks about every current employer in one query', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Alpha'), experience('Beta'), experience('Gone', 'Dec 2023')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-a', ACCOUNT_NAME: 'Alpha', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Alpha',
      accountId: 'acc-a',
      hasActiveMembership: false,
    });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('IN (?, ?)'), ['ALPHA', 'BETA']);
  });

  it('names the first current employer when none of them is a member', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Bank Pekao'), experience('Corner Shop Ltd')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-bp', ACCOUNT_NAME: 'Bank Pekao', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
      employerName: 'Bank Pekao',
      hasActiveMembership: false,
    });
  });

  it('asks once per distinct current employer', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme'), experience(' acme ')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-4', ACCOUNT_NAME: 'Acme', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await service.getEmployerAffiliation(REQ, 'lfid');

    expect(execute).toHaveBeenCalledWith(expect.anything(), ['ACME']);
  });

  // `employerName` is read back to the caller in their own sentence, so it must not switch to the
  // Salesforce spelling on one answer and the profile spelling on another.
  it('reports the profile spelling, not the matched account name', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('bank pekao'), experience('the linux foundation')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-lf', ACCOUNT_NAME: 'The Linux Foundation, Inc.', ACTIVE_MEMBERSHIP_COUNT: 4 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'the linux foundation',
      accountId: 'acc-lf',
      hasActiveMembership: true,
    });
  });

  it('keeps the profile spelling for the non-member answer too', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('bank pekao')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-bp', ACCOUNT_NAME: 'Bank Pekao S.A.', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
      employerName: 'bank pekao',
      accountId: 'acc-bp',
    });
  });

  // An exact-name miss would state "not a member" about a company that is one. A trailing legal form
  // is the one part of a company name routinely written on one side and omitted on the other.
  it('matches a member account whose name carries a legal-form suffix the profile omits', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-acme', ACCOUNT_NAME: 'Acme, LLC', ACTIVE_MEMBERSHIP_COUNT: 2 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
      accountId: 'acc-acme',
      hasActiveMembership: true,
    });
  });

  it('matches when the profile carries the legal form and the account does not', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme Inc.')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-acme', ACCOUNT_NAME: 'Acme', ACTIVE_MEMBERSHIP_COUNT: 1 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['ACME']);
  });

  // The SQL and the JS normalization are twins; a drift between them fails silently, as a member
  // company reading as a non-member. This pins the shape both sides produce.
  it('compares both sides on the same normalized key', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('  Bank   Pekao S.A. ')]);
    execute.mockResolvedValue(rows());

    await service.getEmployerAffiliation(REQ, 'lfid');

    const [query, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['BANKPEKAO']);
    expect(query).toContain("REGEXP_REPLACE(UPPER(c.ACCOUNT_NAME), '[.,'']+', '')");
    expect(query).toContain("$', '')");
  });

  // Only one suffix, and never the whole name: "Limited" alone is a company, not a legal form.
  it('does not strip a legal form that is the entire name', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Limited')]);
    execute.mockResolvedValue(rows());

    await service.getEmployerAffiliation(REQ, 'lfid');

    expect(execute).toHaveBeenCalledWith(expect.anything(), ['LIMITED']);
  });

  // Duplicate account names must not let an empty row downgrade a member company.
  it('orders a duplicated company name so the account holding memberships answers', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-4', ACCOUNT_NAME: 'Acme', ACTIVE_MEMBERSHIP_COUNT: 2 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
    expect(execute.mock.calls[0][0]).toContain('ORDER BY ACTIVE_MEMBERSHIP_COUNT DESC');
  });
});
