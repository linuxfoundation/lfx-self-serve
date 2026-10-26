// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LEGAL_FORM_SUFFIXES } from '@lfx-one/shared/constants';
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
  // Real, not stubbed: the key and its SQL twin are both built from this list, so a hand-written copy
  // here would let a drift between them pass.
  ...(await import('../../../../../packages/shared/src/constants/org-lens-employer-affiliation.constants')),
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
      hasActiveMembership: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports a current employer with no active memberships as a non-member', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Delta Harbour')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-1', ACCOUNT_NAME: 'Delta Harbour', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Delta Harbour',
      hasActiveMembership: false,
    });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('ORG_LENS_ACCOUNT_CONTEXT'), ['DELTAHARBOUR']);
  });

  it('reports an employer with active memberships as a member', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Vendor Corp')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-2', ACCOUNT_NAME: 'Vendor Corp', ACTIVE_MEMBERSHIP_COUNT: 3 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
  });

  // A company nobody has a Salesforce account for certainly holds no membership.
  it('reports an employer that matches no account as a non-member, with no account id', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Corner Shop Ltd')]);
    execute.mockResolvedValue(rows());

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Corner Shop Ltd',
      hasActiveMembership: false,
    });
  });

  // The shared `currentEmployerFromWorkExperiences` falls back to the most recent ended job; naming a
  // company someone has left is exactly the misleading copy this state exists to remove.
  it('reports no employer for a profile whose jobs have all ended', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Former Employer', 'Dec 2023'), experience('Older Employer', 'Jan 2020')]);

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: null,
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

  // Self-declared employment is not permission to learn a company's internal id, and nothing renders
  // one, so the response must not carry it back.
  it('never returns a Salesforce account id', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Delta Harbour')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-1', ACCOUNT_NAME: 'Delta Harbour', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    const affiliation = await service.getEmployerAffiliation(REQ, 'lfid');

    expect(Object.keys(affiliation).sort()).toEqual(['employerName', 'hasActiveMembership']);
    expect(JSON.stringify(affiliation)).not.toContain('acc-1');
  });

  // A day job alongside a foundation or board role is two open-ended entries for one person.
  it('reports a member when any current employer holds a membership, whichever entry comes first', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Delta Harbour'), experience('Beta Coastal')]);
    execute.mockResolvedValue(
      rows(
        { ACCOUNT_ID: 'acc-bc', ACCOUNT_NAME: 'Beta Coastal', ACTIVE_MEMBERSHIP_COUNT: 4 },
        { ACCOUNT_ID: 'acc-dh', ACCOUNT_NAME: 'Delta Harbour', ACTIVE_MEMBERSHIP_COUNT: 0 }
      )
    );

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Beta Coastal',
      hasActiveMembership: true,
    });
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['DELTAHARBOUR', 'BETACOASTAL']);
  });

  it('asks about every current employer in one query', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Alpha'), experience('Beta'), experience('Gone', 'Dec 2023')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-a', ACCOUNT_NAME: 'Alpha', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'Alpha',
      hasActiveMembership: false,
    });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('IN (?, ?)'), ['ALPHA', 'BETA']);
  });

  it('names the first current employer when none of them is a member', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Delta Harbour'), experience('Corner Shop Ltd')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-dh', ACCOUNT_NAME: 'Delta Harbour', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
      employerName: 'Delta Harbour',
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
    getWorkExperiencesForUser.mockResolvedValue([experience('delta harbour'), experience('beta coastal')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-bc', ACCOUNT_NAME: 'Beta Coastal, Inc.', ACTIVE_MEMBERSHIP_COUNT: 4 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: 'beta coastal',
      hasActiveMembership: true,
    });
  });

  it('keeps the profile spelling for the non-member answer too', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('delta harbour')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-dh', ACCOUNT_NAME: 'Delta Harbour S.A.', ACTIVE_MEMBERSHIP_COUNT: 0 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
      employerName: 'delta harbour',
    });
  });

  // An exact-name miss would state "not a member" about a company that is one. A trailing legal form
  // is the one part of a company name routinely written on one side and omitted on the other.
  it('matches a member account whose name carries a legal-form suffix the profile omits', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-acme', ACCOUNT_NAME: 'Acme, LLC', ACTIVE_MEMBERSHIP_COUNT: 2 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
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
    getWorkExperiencesForUser.mockResolvedValue([experience('  Delta   Harbour S.A. ')]);
    execute.mockResolvedValue(rows());

    await service.getEmployerAffiliation(REQ, 'lfid');

    const [query, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['DELTAHARBOUR']);
    // The whole account-side expression, not a fragment: a change to the suffix alternatives or the
    // whitespace pass on the SQL side must fail here, since every other assertion in this file would
    // survive it on a preselected mocked row.
    expect(query).toContain(
      `REGEXP_REPLACE(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(c.ACCOUNT_NAME), '[.,''/]+', ''), '[^A-Z0-9 ]+', ' ')), ' +(${LEGAL_FORM_SUFFIXES.join(
        '|'
      )})$', ''), ' +', '')`
    );
    // And the alternatives are the shared list, spelled out, so neither side can drift alone.
    expect(LEGAL_FORM_SUFFIXES).toContain('LLC');
    expect(LEGAL_FORM_SUFFIXES).toContain('SA');
  });

  // Only one suffix, and never the whole name: "Limited" alone is a company, not a legal form.
  it('does not strip a legal form that is the entire name', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Limited')]);
    execute.mockResolvedValue(rows());

    await service.getEmployerAffiliation(REQ, 'lfid');

    expect(execute).toHaveBeenCalledWith(expect.anything(), ['LIMITED']);
  });

  // A/S (Danish, Norwegian) and S/A (Brazilian) are legal forms written with a slash; splitting on it
  // would hide the suffix and miss the member account.
  it('matches a slash-written legal form the profile omits', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Nordic Freight')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-nf', ACCOUNT_NAME: 'Nordic Freight A/S', ACTIVE_MEMBERSHIP_COUNT: 1 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['NORDICFREIGHT']);
  });

  it('strips a slash-written legal form from the profile side too', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Coastal Energy S/A')]);
    execute.mockResolvedValue(rows());

    await service.getEmployerAffiliation(REQ, 'lfid');

    expect(execute).toHaveBeenCalledWith(expect.anything(), ['COASTALENERGY']);
  });

  // The key is Latin-only, so a name in another script reduces to nothing. Keeping the affiliation
  // matters more than resolving it: dropping it would answer `employerName: null` and send someone who
  // does have an employer back to the "add an affiliation" copy — the loop #4314 exists to end.
  it('keeps a non-Latin employer name instead of answering that there is none', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('架空会社')]);

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toEqual({
      employerName: '架空会社',
      hasActiveMembership: false,
    });
    // An empty key would match any account whose own name is all punctuation, so it is never asked.
    expect(execute).not.toHaveBeenCalled();
  });

  it('still asks about the resolvable employers alongside a non-Latin one', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('架空会社'), experience('Beta Coastal')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-bc', ACCOUNT_NAME: 'Beta Coastal', ACTIVE_MEMBERSHIP_COUNT: 2 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({
      employerName: 'Beta Coastal',
      hasActiveMembership: true,
    });
    expect(execute).toHaveBeenCalledWith(expect.anything(), ['BETACOASTAL']);
  });

  // Duplicate account names must not let an empty row downgrade a member company.
  it('orders a duplicated company name so the account holding memberships answers', async () => {
    getWorkExperiencesForUser.mockResolvedValue([experience('Acme')]);
    execute.mockResolvedValue(rows({ ACCOUNT_ID: 'acc-4', ACCOUNT_NAME: 'Acme', ACTIVE_MEMBERSHIP_COUNT: 2 }));

    await expect(service.getEmployerAffiliation(REQ, 'lfid')).resolves.toMatchObject({ hasActiveMembership: true });
    expect(execute.mock.calls[0][0]).toContain('ORDER BY ACTIVE_MEMBERSHIP_COUNT DESC');
  });
});
