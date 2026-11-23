// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAllEmployees,
  getFormerEmployees,
  getLive,
  getContributors,
  getCompanyEmails,
  getCompanyEmailsByUsername,
  getCompanyEmailsByKeyContacts,
  getCompanyEmailKeys,
  getLfUsernameCompanyEmailStatuses,
  getLiveKeyContactAddressesWithCompanyEmail,
  getPersonKeyContactsIdentity,
  getEmployeeDetail,
  getEmployeeDetailByUsername,
  getKeyContactsForPerson,
  getOrgKeyContacts,
  getTrainees,
  readEventAttendeesSummary,
  assertOrgLensRead,
  logger,
} = vi.hoisted(() => ({
  getAllEmployees: vi.fn(),
  getFormerEmployees: vi.fn(),
  getLive: vi.fn(),
  getContributors: vi.fn(),
  getCompanyEmails: vi.fn(),
  getCompanyEmailsByUsername: vi.fn(),
  getCompanyEmailsByKeyContacts: vi.fn(),
  getCompanyEmailKeys: vi.fn(),
  getLfUsernameCompanyEmailStatuses: vi.fn(),
  getLiveKeyContactAddressesWithCompanyEmail: vi.fn(),
  getPersonKeyContactsIdentity: vi.fn(),
  getEmployeeDetail: vi.fn(),
  getEmployeeDetailByUsername: vi.fn(),
  getKeyContactsForPerson: vi.fn(),
  getOrgKeyContacts: vi.fn(),
  getTrainees: vi.fn(),
  readEventAttendeesSummary: vi.fn(),
  assertOrgLensRead: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// The utils barrel pulls Angular into this plain-Node run; the real username allowlist is what runs here.
// vi.mock factories are hoisted above static imports, so the real module can only load via import().
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-commit-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-employment.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-team-members.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-scope.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-key-contact.utils')),
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
}));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../services/org-lens-people.service', () => ({
  OrgLensPeopleService: class {
    public getAllEmployees = getAllEmployees;
    public getFormerEmployees = getFormerEmployees;
    public getCompanyEmails = getCompanyEmails;
    public getCompanyEmailsByUsername = getCompanyEmailsByUsername;
    public getCompanyEmailsByKeyContacts = getCompanyEmailsByKeyContacts;
    public getCompanyEmailKeys = getCompanyEmailKeys;
    public getLfUsernameCompanyEmailStatuses = getLfUsernameCompanyEmailStatuses;
    public getLiveKeyContactAddressesWithCompanyEmail = getLiveKeyContactAddressesWithCompanyEmail;
    public getPersonKeyContactsIdentity = getPersonKeyContactsIdentity;
    public getEmployeeDetail = getEmployeeDetail;
    public getEmployeeDetailByUsername = getEmployeeDetailByUsername;
  },
}));
vi.mock('../services/org-people-board-members.service', () => ({ OrgPeopleBoardMembersService: class {} }));
vi.mock('../services/org-people-committee-members.service', () => ({ OrgPeopleCommitteeMembersService: class {} }));
vi.mock('../services/org-people-contributors.service', () => ({
  OrgPeopleContributorsService: class {
    public getContributors = getContributors;
  },
}));
vi.mock('../services/org-people-directory.service', () => ({
  OrgPeopleDirectoryService: class {
    public getLive = getLive;
  },
}));
vi.mock('../services/org-people-event-attendees.service', () => ({
  OrgPeopleEventAttendeesService: class {
    public readSummary = readEventAttendeesSummary;
  },
}));
vi.mock('../services/org-people-key-contacts.service', () => ({
  OrgPeopleKeyContactsService: class {
    public getKeyContactsForPerson = getKeyContactsForPerson;
    public getKeyContacts = getOrgKeyContacts;
  },
}));
vi.mock('../services/org-people-trainees.service', () => ({
  OrgPeopleTraineesService: class {
    public getTrainees = getTrainees;
  },
}));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ assertOrgLensRead }));

import { ORG_TRAINEE_OUTSIDE_KEY_PREFIX } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { OrgLensPeopleController } from './org-lens-people.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(username: string): Request {
  return { params: { orgUid: ORG_UID, username }, query: {}, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

function buildRosterReq(query: Record<string, string>): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

const EMPTY_ROSTER = { accountId: ORG_UID, rows: [], stats: { activeInOss: 0 }, foundations: [] };
// A request without the commit filters reads LF and non-LF projects (lfx-self-serve#4694) and all code contributions (#4559).
const DEFAULT_FILTERS = { projectScope: 'all', commitScope: 'all', metric: 'code' };

describe('OrgLensPeopleController All Employees time range (lfx-self-serve#4163)', () => {
  const controller = new OrgLensPeopleController();

  beforeEach(() => {
    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(EMPTY_ROSTER);
    getFormerEmployees.mockResolvedValue(EMPTY_ROSTER);
    getLive.mockResolvedValue(EMPTY_ROSTER);
  });

  it('reads the unranged roster when /all has no range, and defaults /former to 730d', async () => {
    await controller.getAllEmployees(buildRosterReq({}), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ live: 'true' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({}), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, null, DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, null, DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'exclude', 'insights');
  });

  it('passes a valid range through to the stored, live, former and contributors reads', async () => {
    await controller.getAllEmployees(buildRosterReq({ range: '30d' }), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ range: '730d' }), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: 'all' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({ range: '90d' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({ range: '730d' }), buildRes(), vi.fn());
    await controller.getContributors(buildRosterReq({ timeRange: '730d' }), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '30d', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'all', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '90d', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'all', 'exclude', 'insights');
  });

  it('reads the legacy 12mo, still sent by tabs opened before the new ranges, as 365d', async () => {
    await controller.getAllEmployees(buildRosterReq({ range: '12mo' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({ range: '12mo' }), buildRes(), vi.fn());
    await controller.getContributors(buildRosterReq({ timeRange: '12mo' }), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '365d', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '365d', DEFAULT_FILTERS, 'exclude', 'insights');
    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '365d', DEFAULT_FILTERS, 'all', 'exclude', 'insights');
  });

  it('rejects an unknown range with a 400 before any read', async () => {
    for (const [read, query] of [
      [controller.getAllEmployees, { range: '3y' }],
      [controller.getAllEmployees, { live: 'true', range: '12m' }],
      [controller.getFormerEmployees, { range: 'ALL' }],
    ] as const) {
      const next = vi.fn();
      await read.call(controller, buildRosterReq(query), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    }
    expect(getAllEmployees).not.toHaveBeenCalled();
    expect(getLive).not.toHaveBeenCalled();
    expect(getFormerEmployees).not.toHaveBeenCalled();
  });
});

// lfx-self-serve#4598: the All Employees Event Attendees tile is the People -> Event Attendees tab's default Attendees number.
describe('OrgLensPeopleController All Employees Event Attendees tile (lfx-self-serve#4598)', () => {
  const controller = new OrgLensPeopleController();
  const roster = { ...EMPTY_ROSTER, stats: { activeInOss: 3, inGovernance: 0, codeContributors: 1, eventAttendees: 2, trainees: 0 } };

  async function respond(query: Record<string, string>): Promise<{ eventAttendeesTotal?: number | null; stats: { eventAttendees: number } }> {
    const res = buildRes();
    await controller.getAllEmployees(buildRosterReq(query), res, vi.fn());
    return (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(roster);
    getLive.mockResolvedValue(roster);
    readEventAttendeesSummary.mockResolvedValue({ attendeesCount: 486, speakersCount: 9, eventsCount: 12, foundationsCount: 3 });
  });

  it('reads the summary row of the range at the Event Attendees defaults (Employee match, registered or attended) and serves its Attendees count', async () => {
    const stored = await respond({ range: '90d' });
    const live = await respond({ live: 'true', range: '730d' });

    expect(readEventAttendeesSummary).toHaveBeenNthCalledWith(1, ORG_UID, '90d', 'all');
    expect(readEventAttendeesSummary).toHaveBeenNthCalledWith(2, ORG_UID, '730d', 'all');
    expect(stored).toMatchObject({ eventAttendeesTotal: 486, stats: { eventAttendees: 486, activeInOss: 3 } });
    expect(live.eventAttendeesTotal).toBe(486);
  });

  it.each(['all', 'lf'])('uses the summary under the %s project scope: events do not depend on it', async (projectScope) => {
    expect((await respond({ range: '730d', projectScope })).eventAttendeesTotal).toBe(486);
  });

  it('keeps the listed-employee count under the Non-LF project scope', async () => {
    const response = await respond({ range: '730d', projectScope: 'non_lf' });

    expect(readEventAttendeesSummary).not.toHaveBeenCalled();
    expect(response.eventAttendeesTotal).toBeUndefined();
    expect(response.stats.eventAttendees).toBe(2);
  });

  it('keeps the listed-employee count for the unranged roster read', async () => {
    const response = await respond({});

    expect(readEventAttendeesSummary).not.toHaveBeenCalled();
    expect(response.eventAttendeesTotal).toBeUndefined();
  });

  it('serves the roster and marks the tile unavailable, never a different count, when the summary cannot be read', async () => {
    readEventAttendeesSummary.mockRejectedValue(new Error('warehouse down'));

    const response = await respond({ range: '730d' });

    expect(response.eventAttendeesTotal).toBeNull();
    expect(response.stats).toBeDefined();
    expect(logger.warning).toHaveBeenCalled();
  });
});

describe('OrgLensPeopleController commit filters (lfx-self-serve#4164)', () => {
  const controller = new OrgLensPeopleController();
  const picked = { projectScope: 'non_lf', commitScope: 'merged', metric: 'code' };

  beforeEach(() => {
    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(EMPTY_ROSTER);
    getFormerEmployees.mockResolvedValue(EMPTY_ROSTER);
    getLive.mockResolvedValue(EMPTY_ROSTER);
    getContributors.mockResolvedValue({ contributors: [], projects: [], foundationOptions: [], stats: { maintainerRoles: 0 } });
  });

  it('passes the projectScope, commitScope and metric params to every People read', async () => {
    await controller.getAllEmployees(buildRosterReq({ range: '30d', ...picked }), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '30d', ...picked }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({ ...picked }), buildRes(), vi.fn());
    await controller.getContributors(buildRosterReq({ timeRange: '90d', ...picked }), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '30d', picked, 'exclude', 'insights');
    expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, '30d', picked, 'exclude', 'insights');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '730d', picked, 'exclude', 'insights');
    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '90d', picked, 'all', 'exclude', 'insights');
  });

  it('defaults missing params on the Contributors read to the past 2 years, LF and non-LF projects and everyone, former employees included', async () => {
    await controller.getContributors(buildRosterReq({}), buildRes(), vi.fn());

    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'all', 'exclude', 'insights');
  });

  it('reads projectScope=lf as LF projects only', async () => {
    await controller.getContributors(buildRosterReq({ projectScope: 'lf' }), buildRes(), vi.fn());

    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '730d', { ...DEFAULT_FILTERS, projectScope: 'lf' }, 'all', 'exclude', 'insights');
  });

  // lfx-self-serve#4627
  it.each(['current', 'former', 'all'])('forwards employment=%s to the Contributors read', async (employment) => {
    await controller.getContributors(buildRosterReq({ timeRange: '90d', employment }), buildRes(), vi.fn());

    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '90d', DEFAULT_FILTERS, employment, 'exclude', 'insights');
  });

  it.each(['Current', 'everyone', 'ex'])('rejects employment=%s with a 400 naming the field before any read', async (employment) => {
    const next = vi.fn();

    await controller.getContributors(buildRosterReq({ employment }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect((next.mock.calls[0][0] as Error).message).toContain('employment');
    expect(getContributors).not.toHaveBeenCalled();
  });

  it.each([
    ['projectScope', 'LF'],
    ['projectScope', 'nonlf'],
    ['commitScope', 'main'],
    ['metric', 'activities'],
  ])('rejects %s=%s with a 400 naming the field before any read', async (field, value) => {
    for (const [read, query] of [
      [controller.getAllEmployees, { range: '30d', [field]: value }],
      [controller.getAllEmployees, { live: 'true', range: '30d', [field]: value }],
      [controller.getFormerEmployees, { [field]: value }],
      [controller.getContributors, { [field]: value }],
    ] as const) {
      const next = vi.fn();
      await read.call(controller, buildRosterReq(query), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    }
    expect(getAllEmployees).not.toHaveBeenCalled();
    expect(getLive).not.toHaveBeenCalled();
    expect(getFormerEmployees).not.toHaveBeenCalled();
    expect(getContributors).not.toHaveBeenCalled();
  });
});

describe('OrgLensPeopleController team members filter (lfx-self-serve#4685)', () => {
  const controller = new OrgLensPeopleController();

  beforeEach(() => {
    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(EMPTY_ROSTER);
    getFormerEmployees.mockResolvedValue(EMPTY_ROSTER);
    getLive.mockResolvedValue(EMPTY_ROSTER);
    getContributors.mockResolvedValue({ contributors: [], projects: [], foundationOptions: [], stats: { maintainerRoles: 0 } });
  });

  it('forwards teamMembers=include to every People read; a missing pick reads exclude, the default', async () => {
    await controller.getAllEmployees(buildRosterReq({ range: '30d', teamMembers: 'include' }), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '30d', teamMembers: 'include' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({ teamMembers: 'include' }), buildRes(), vi.fn());
    await controller.getContributors(buildRosterReq({ teamMembers: 'include' }), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '30d', DEFAULT_FILTERS, 'include', 'insights');
    expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, '30d', DEFAULT_FILTERS, 'include', 'insights');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'include', 'insights');
    expect(getContributors).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'all', 'include', 'insights');
  });

  it.each(['Exclude', 'true', 'none'])('rejects teamMembers=%s with a 400 naming the field before any read', async (teamMembers) => {
    for (const [read, query] of [
      [controller.getAllEmployees, { range: '30d', teamMembers }],
      [controller.getAllEmployees, { live: 'true', range: '30d', teamMembers }],
      [controller.getFormerEmployees, { teamMembers }],
      [controller.getContributors, { teamMembers }],
    ] as const) {
      const next = vi.fn();
      await read.call(controller, buildRosterReq(query), buildRes(), next);
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
      expect((next.mock.calls[0][0] as Error).message).toContain('teamMembers');
    }
    expect(getAllEmployees).not.toHaveBeenCalled();
    expect(getLive).not.toHaveBeenCalled();
    expect(getFormerEmployees).not.toHaveBeenCalled();
    expect(getContributors).not.toHaveBeenCalled();
  });
});

describe('OrgLensPeopleController getEmployeeDetailByUsername (lfx-self-serve-ops#894)', () => {
  const controller = new OrgLensPeopleController();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unsafe username before any lookup', async () => {
    for (const username of ['a/b', "x' OR '1'='1", 'u'.repeat(257)]) {
      const next = vi.fn();
      await controller.getEmployeeDetailByUsername(buildReq(username), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    }
    expect(getEmployeeDetailByUsername).not.toHaveBeenCalled();
  });

  it('answers a username with no single roster person as an uncached null, not an error', async () => {
    getEmployeeDetailByUsername.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.getEmployeeDetailByUsername(buildReq('jdoe'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(null);
  });
});

describe('OrgLensPeopleController getCompanyEmails', () => {
  const controller = new OrgLensPeopleController();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unsafe person key before any lookup', async () => {
    for (const personKey of ['a/b', "x' OR '1'='1", 'abc', 'k'.repeat(129)]) {
      const next = vi.fn();
      const req = { params: { orgUid: ORG_UID, personKey }, query: {}, path: '/test' } as unknown as Request;
      await controller.getCompanyEmails(req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    }
    expect(getCompanyEmails).not.toHaveBeenCalled();
  });

  // The range and project scope only steer which cached directory a live-only lookup reads first, so a bad value is
  // ignored (the 30d probes still run) rather than failing the address request.
  it.each([
    [
      { range: '90d', projectScope: 'lf' },
      { range: '90d', projectScope: 'lf' },
    ],
    [{ range: '12mo', projectScope: 'lf' }, null],
    [{ range: '90d', projectScope: 'everything' }, null],
    [{ range: '90d' }, null],
    [{}, null],
  ])('passes the directory view %o as %o', async (query, expected) => {
    getCompanyEmails.mockResolvedValue({ companyEmails: [], companyEmailsStatus: 'unavailable' });
    const next = vi.fn();
    const req = { params: { orgUid: ORG_UID, personKey: 'live-0123456789abcdef' }, query, path: '/test' } as unknown as Request;

    await controller.getCompanyEmails(req, buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getCompanyEmails).toHaveBeenCalledWith(req, ORG_UID, 'live-0123456789abcdef', expected);
  });
});

describe('OrgLensPeopleController getCompanyEmailsByKeyContacts', () => {
  const controller = new OrgLensPeopleController();
  const ID_ONE = 'a0F000000000001AAA';
  const ID_TWO = 'a0F000000000002AAA';
  const keyContactReq = (query: Record<string, string>): Request => ({ params: { orgUid: ORG_UID }, query, path: '/test' }) as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyEmailsByKeyContacts.mockResolvedValue({ companyEmails: [], companyEmailsStatus: 'unavailable', companyEmailsReason: 'unconfirmed' });
    getOrgKeyContacts.mockResolvedValue({
      assignments: [
        { contactUid: ID_ONE, username: 'JDoe', email: ' JDoe@Company.example ' },
        { contactUid: ID_TWO, username: 'jdoe', email: 'jdoe@company.example' },
        { contactUid: 'a0F000000000009AAA', username: 'someone-else', email: 'someone@company.example' },
      ],
    });
  });

  it.each([
    ['no ids', {}],
    ['an empty id list', { ids: '' }],
    ['a 15-character id', { ids: 'a0F000000000001' }],
    ['a non-alphanumeric id', { ids: `${ID_ONE},a0F00000000000'AAA` }],
    ['more than 50 ids', { ids: Array.from({ length: 51 }, (_, index) => `a0F${String(index).padStart(15, '0')}`).join(',') }],
  ])('answers 400 for %s, before any lookup', async (_label, query) => {
    const next = vi.fn();

    await controller.getCompanyEmailsByKeyContacts(keyContactReq(query), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(getCompanyEmailsByKeyContacts).not.toHaveBeenCalled();
  });

  it('passes the deduplicated ids, the username their assignments agree on and their current contact emails, ignoring a client-supplied username', async () => {
    const res = buildRes();

    await controller.getCompanyEmailsByKeyContacts(keyContactReq({ ids: `${ID_ONE},${ID_TWO},${ID_ONE}`, username: 'a/b' }), res, vi.fn());

    expect(getOrgKeyContacts).toHaveBeenCalledWith(expect.anything(), ORG_UID);
    expect(getCompanyEmailsByKeyContacts).toHaveBeenCalledWith(expect.anything(), ORG_UID, [ID_ONE, ID_TWO], 'JDoe', new Set(['jdoe@company.example']), false);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  // A role reassigned from A to B keeps its record id: the record addresses are bound to the contact it names now.
  it('binds the record addresses to the email of the contact each record names now', async () => {
    getOrgKeyContacts.mockResolvedValue({ assignments: [{ contactUid: ID_ONE, username: null, email: 'b.current@company.example' }] });

    await controller.getCompanyEmailsByKeyContacts(keyContactReq({ ids: ID_ONE }), buildRes(), vi.fn());

    expect(getCompanyEmailsByKeyContacts).toHaveBeenCalledWith(expect.anything(), ORG_UID, [ID_ONE], null, new Set(['b.current@company.example']), true);
  });

  it('looks up the records alone, without an LF account, when every record is held and none names a username', async () => {
    getOrgKeyContacts.mockResolvedValue({
      assignments: [
        { contactUid: ID_ONE, username: null, email: 'first@company.example' },
        { contactUid: ID_TWO, username: ' ', email: 'first@company.example' },
      ],
    });

    await controller.getCompanyEmailsByKeyContacts(keyContactReq({ ids: `${ID_ONE},${ID_TWO}` }), buildRes(), vi.fn());

    expect(getCompanyEmailsByKeyContacts).toHaveBeenCalledWith(expect.anything(), ORG_UID, [ID_ONE, ID_TWO], null, new Set(['first@company.example']), true);
  });

  it('keeps an LF account possible when only some records name a username', async () => {
    getOrgKeyContacts.mockResolvedValue({
      assignments: [
        { contactUid: ID_ONE, username: null, email: 'first@company.example' },
        { contactUid: ID_TWO, username: 'jdoe', email: 'jdoe@company.example' },
      ],
    });

    await controller.getCompanyEmailsByKeyContacts(keyContactReq({ ids: `${ID_ONE},${ID_TWO}` }), buildRes(), vi.fn());

    expect(getCompanyEmailsByKeyContacts).toHaveBeenCalledWith(
      expect.anything(),
      ORG_UID,
      [ID_ONE, ID_TWO],
      null,
      new Set(['first@company.example', 'jdoe@company.example']),
      false
    );
  });

  it('looks up the records alone when any requested id has no assignment, even if the found ones agree', async () => {
    // ID_TWO is absent from the org's assignments: agreement over ID_ONE alone could hand an email-grouped opener one
    // member's LF addresses. Fail closed to the records, as agreedUsername does for a member without a username.
    getOrgKeyContacts.mockResolvedValue({ assignments: [{ contactUid: ID_ONE, username: 'JDoe', email: 'jdoe@company.example' }] });

    await controller.getCompanyEmailsByKeyContacts(keyContactReq({ ids: `${ID_ONE},${ID_TWO}` }), buildRes(), vi.fn());

    // The found record's current email still binds its addresses; only the username needs every id.
    expect(getCompanyEmailsByKeyContacts).toHaveBeenCalledWith(expect.anything(), ORG_UID, [ID_ONE, ID_TWO], null, new Set(['jdoe@company.example']), false);
  });

  it.each([
    ['unconfirmed', { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'unavailable', companyEmailsReason: 'unconfirmed' }],
    ['failed', { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'failed' }],
  ])('shows no record address when the key contacts read fails, answering %s', async (_label, result) => {
    getOrgKeyContacts.mockRejectedValue(new Error('upstream down'));
    getCompanyEmailsByKeyContacts.mockResolvedValue(result);
    const res = buildRes();
    const next = vi.fn();

    await controller.getCompanyEmailsByKeyContacts(keyContactReq({ ids: ID_ONE }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getCompanyEmailsByKeyContacts).toHaveBeenCalledWith(expect.anything(), ORG_UID, [ID_ONE], null, new Set(), false);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'get_org_lens_people_company_emails_by_key_contact', expect.any(String), {
      org_uid: ORG_UID,
      key_contact_count: 1,
      err: expect.any(Error),
    });
    expect(res.json).toHaveBeenCalledWith(result);
  });
});

describe('OrgLensPeopleController All Employees company email status', () => {
  const controller = new OrgLensPeopleController();
  const row = (personKey: string, lfUsername: string | null, extra: { email?: string; keyContactRoles?: string[] } = {}) => ({
    personKey,
    lfUsername,
    email: null,
    keyContactRoles: [],
    ...extra,
  });
  const roster = {
    ...EMPTY_ROSTER,
    rows: [
      row('person-has', null),
      // A stored row is read by person key only, so a username in the keys does not make it `has`.
      row('person-username-only', 'Known'),
      row('person-none', 'nobody'),
      row('cdp:member-has-username', 'known'),
      row('cdp:member-unconfirmed', null),
      row('live-has', 'known'),
      // The username names one roster person with no address: the drawer answers "No verified company email …".
      row('live-known-empty', 'EmptyUser'),
      row('live-unconfirmed', 'stranger'),
      row('live-no-username', null),
    ],
  };
  const statuses = (res: Response): Record<string, string | undefined> =>
    Object.fromEntries(
      ((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { rows: { personKey: string; companyEmailStatus?: string }[] }).rows.map((r) => [
        r.personKey,
        r.companyEmailStatus,
      ])
    );

  beforeEach(() => {
    vi.clearAllMocks();
    getLive.mockResolvedValue(roster);
    getFormerEmployees.mockResolvedValue(roster);
    getCompanyEmailKeys.mockResolvedValue({ personKeys: ['person-has', 'cdp:member-unconfirmed'], usernames: ['known'], noneUsernames: ['emptyuser'] });
    getLfUsernameCompanyEmailStatuses.mockResolvedValue({ usernames: [], noneUsernames: [] });
  });

  it.each([
    ['the live roster', (res: Response) => controller.getAllEmployees(buildRosterReq({ live: 'true', range: '90d' }), res, vi.fn())],
    ['the former roster', (res: Response) => controller.getFormerEmployees(buildRosterReq({ range: '90d' }), res, vi.fn())],
  ])('stamps every row of %s from one keys read', async (_label, read) => {
    const res = buildRes();

    await read(res);

    expect(getCompanyEmailKeys).toHaveBeenCalledTimes(1);
    expect(statuses(res)).toEqual({
      'person-has': 'has',
      'person-username-only': 'none',
      'person-none': 'none',
      // The drawer answers a cdp: row without any lookup, so neither its key nor its username in the keys counts.
      'cdp:member-has-username': 'unconfirmed',
      'cdp:member-unconfirmed': 'unconfirmed',
      'live-has': 'has',
      'live-known-empty': 'none',
      'live-unconfirmed': 'unconfirmed',
      'live-no-username': 'unconfirmed',
    });
  });

  it('reads only the live usernames the keys do not cover by LF account, tagging them as the drawer answers', async () => {
    getLive.mockResolvedValue({
      ...roster,
      rows: [...roster.rows, row('live-lf-has', ' LfHas '), row('live-lf-none', 'lfnone'), row('live-lf-unknown', 'lfunknown')],
    });
    getLfUsernameCompanyEmailStatuses.mockResolvedValue({ usernames: ['lfhas'], noneUsernames: ['lfnone'] });
    const res = buildRes();

    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '90d' }), res, vi.fn());

    expect(getLfUsernameCompanyEmailStatuses).toHaveBeenCalledWith(expect.anything(), ORG_UID, ['stranger', 'lfhas', 'lfnone', 'lfunknown']);
    expect(statuses(res)).toMatchObject({
      'live-has': 'has',
      'live-known-empty': 'none',
      'live-unconfirmed': 'unconfirmed',
      'live-lf-has': 'has',
      'live-lf-none': 'none',
      // A username the warehouse does not know stays unconfirmed.
      'live-lf-unknown': 'unconfirmed',
    });
  });

  it('leaves the uncovered live rows unconfirmed when the LF-account read fails', async () => {
    getLive.mockResolvedValue({ ...roster, rows: [...roster.rows, row('live-lf-has', 'lfhas')] });
    getLfUsernameCompanyEmailStatuses.mockResolvedValue(null);
    const res = buildRes();

    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '90d' }), res, vi.fn());

    expect(statuses(res)).toMatchObject({ 'live-has': 'has', 'live-lf-has': 'unconfirmed' });
  });

  it('reads the key-contact records of only the username-less live rows listing roles, tagging them as the drawer answers', async () => {
    getLive.mockResolvedValue({
      ...roster,
      rows: [
        ...roster.rows,
        row('live-kc-has', null, { email: ' Has.Contact@Company.example ', keyContactRoles: ['Legal Contact'] }),
        row('live-kc-unlinked', null, { email: 'unlinked@company.example', keyContactRoles: ['Billing Contact'] }),
        // A username-less live row holding no key-contact role (a seat without a username) is not read.
        row('live-seat-only', null, { email: 'seat@company.example' }),
        // A row with a username is read by LF account instead, even when it lists key-contact roles.
        row('live-kc-user', 'known', { email: 'user@company.example', keyContactRoles: ['PO Contact'] }),
      ],
    });
    getLiveKeyContactAddressesWithCompanyEmail.mockResolvedValue(['has.contact@company.example']);
    const res = buildRes();

    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '90d' }), res, vi.fn());

    expect(getLiveKeyContactAddressesWithCompanyEmail).toHaveBeenCalledWith(expect.anything(), ORG_UID, [
      'has.contact@company.example',
      'unlinked@company.example',
    ]);
    expect(statuses(res)).toMatchObject({
      'live-kc-has': 'has',
      'live-kc-unlinked': 'unconfirmed',
      'live-seat-only': 'unconfirmed',
      'live-kc-user': 'has',
    });
  });

  it('leaves the username-less key-contact rows unconfirmed when their record read fails', async () => {
    getLive.mockResolvedValue({
      ...roster,
      rows: [...roster.rows, row('live-kc-has', null, { email: 'has@company.example', keyContactRoles: ['Legal Contact'] })],
    });
    getLiveKeyContactAddressesWithCompanyEmail.mockResolvedValue(null);
    const res = buildRes();

    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '90d' }), res, vi.fn());

    expect(statuses(res)).toMatchObject({ 'live-has': 'has', 'live-kc-has': 'unconfirmed' });
  });

  it('serves the roster without statuses when the keys read failed', async () => {
    getCompanyEmailKeys.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '90d' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(Object.values(statuses(res)).every((status) => status === undefined)).toBe(true);
  });
});

describe('OrgLensPeopleController per-person key contacts', () => {
  const controller = new OrgLensPeopleController();
  const personKeyReq = (personKey: string, query: Record<string, string> = {}): Request =>
    ({ params: { orgUid: ORG_UID, personKey }, query, path: '/test' }) as unknown as Request;
  const PERSON_KEY = 'k'.repeat(32);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unsafe person key before any lookup', async () => {
    for (const personKey of ['a/b', "x' OR '1'='1", 'abc', 'k'.repeat(129)]) {
      const next = vi.fn();
      await controller.getPersonKeyContacts(personKeyReq(personKey), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    }
    expect(getPersonKeyContactsIdentity).not.toHaveBeenCalled();
    expect(getKeyContactsForPerson).not.toHaveBeenCalled();
  });

  it('rejects an unsafe username before any lookup', async () => {
    for (const username of ['a/b', "x' OR '1'='1", 'u'.repeat(257)]) {
      const next = vi.fn();
      await controller.getPersonKeyContactsByUsername(buildReq(username), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    }
    expect(getKeyContactsForPerson).not.toHaveBeenCalled();
  });

  // An identity in the URL is an identity in the request log, so the client sends none: the service assembles it.
  it('matches on the identity the service assembles, ignoring a client-supplied username', async () => {
    const identity = { username: 'roster-name', emails: ['first.person@vendor-corp.example'], emailsStatus: 'resolved' };
    getPersonKeyContactsIdentity.mockResolvedValue(identity);
    getKeyContactsForPerson.mockResolvedValue({ assignments: [{ role: 'Billing Contact' }], status: 'resolved' });
    const res = buildRes();
    const next = vi.fn();

    await controller.getPersonKeyContacts(personKeyReq(PERSON_KEY, { username: 'client-supplied' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getPersonKeyContactsIdentity).toHaveBeenCalledWith(expect.anything(), ORG_UID, PERSON_KEY);
    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, identity);
    expect(res.json).toHaveBeenCalledWith({ assignments: [{ role: 'Billing Contact' }], status: 'resolved' });
  });

  it('identifies a by-username read on the username plus any resolved addresses', async () => {
    getCompanyEmailsByUsername.mockResolvedValue({ companyEmails: ['first.person@vendor-corp.example'], companyEmailsStatus: 'resolved' });
    getKeyContactsForPerson.mockResolvedValue({ assignments: [], status: 'resolved' });

    await controller.getPersonKeyContactsByUsername(buildReq('jdoe'), buildRes(), vi.fn());

    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, {
      username: 'jdoe',
      emails: ['first.person@vendor-corp.example'],
      emailsStatus: 'resolved',
    });
  });

  it('still looks a username up when its address lookup fails, and says the answer is retryable', async () => {
    getCompanyEmailsByUsername.mockResolvedValue({ companyEmails: [], companyEmailsStatus: 'failed' });
    getKeyContactsForPerson.mockResolvedValue({ assignments: [], status: 'failed' });
    const res = buildRes();

    await controller.getPersonKeyContactsByUsername(buildReq('jdoe'), res, vi.fn());

    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, { username: 'jdoe', emails: [], emailsStatus: 'failed' });
    expect(res.json).toHaveBeenCalledWith({ assignments: [], status: 'failed' });
  });
});

describe('OrgLensPeopleController detail range (lfx-self-serve#4482)', () => {
  const controller = new OrgLensPeopleController();
  const DETAIL = { personKey: 'person-one', boardSeats: [], committeeSeats: [], code: [], totalCommits: 0, events: [], training: [] };

  function detailReq(query: Record<string, string>): Request {
    return { params: { orgUid: ORG_UID, personKey: 'person-one', username: 'jdoe' }, query, path: '/test' } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getEmployeeDetail.mockResolvedValue(DETAIL);
    getEmployeeDetailByUsername.mockResolvedValue(DETAIL);
  });

  it('forwards the range the Maintainer pills follow, for a person key and for a username', async () => {
    await controller.getEmployeeDetail(detailReq({ range: '90d' }), buildRes(), vi.fn());
    await controller.getEmployeeDetailByUsername(detailReq({ range: 'all' }), buildRes(), vi.fn());

    expect(getEmployeeDetail).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'person-one', '90d', null, 'include', 'all');
    expect(getEmployeeDetailByUsername).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'jdoe', 'all', null, 'include', 'all');
  });

  it('defaults to the Org Lens default range, the past 2 years, when the opener sends no range', async () => {
    await controller.getEmployeeDetail(detailReq({}), buildRes(), vi.fn());
    await controller.getEmployeeDetailByUsername(detailReq({}), buildRes(), vi.fn());

    expect(getEmployeeDetail).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'person-one', '730d', null, 'include', 'all');
    expect(getEmployeeDetailByUsername).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'jdoe', '730d', null, 'include', 'all');
  });

  it("forwards the opener's code filters with its range, for a person key and for a username (lfx-self-serve#4404)", async () => {
    const query = { range: '730d', projectScope: 'non_lf', commitScope: 'merged', metric: 'commits' };
    await controller.getEmployeeDetail(detailReq(query), buildRes(), vi.fn());
    await controller.getEmployeeDetailByUsername(detailReq(query), buildRes(), vi.fn());

    const filters = { projectScope: 'non_lf', commitScope: 'merged', metric: 'commits' };
    expect(getEmployeeDetail).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'person-one', '730d', filters, 'exclude', 'insights');
    expect(getEmployeeDetailByUsername).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'jdoe', '730d', filters, 'exclude', 'insights');
  });

  it('fills the code filters an opener leaves out with their defaults once it sends any', async () => {
    await controller.getEmployeeDetail(detailReq({ projectScope: 'all' }), buildRes(), vi.fn());

    expect(getEmployeeDetail).toHaveBeenCalledWith(
      expect.anything(),
      ORG_UID,
      'person-one',
      '730d',
      {
        projectScope: 'all',
        commitScope: 'all',
        metric: 'code',
      },
      'exclude',
      'insights'
    );
  });

  // lfx-self-serve#4685
  it("forwards the opener's Team members pick with its code filters, and counts everyone for a code-free open", async () => {
    await controller.getEmployeeDetail(detailReq({ projectScope: 'lf', teamMembers: 'include' }), buildRes(), vi.fn());
    expect(getEmployeeDetail).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'person-one', '730d', expect.any(Object), 'include', 'insights');

    await controller.getEmployeeDetail(detailReq({ teamMembers: 'exclude' }), buildRes(), vi.fn());
    expect(getEmployeeDetail).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'person-one', '730d', null, 'include', 'all');
  });

  it('rejects an unknown teamMembers with code filters with a 400 before any read', async () => {
    const next = vi.fn();
    await controller.getEmployeeDetail(detailReq({ projectScope: 'lf', teamMembers: 'none' }), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(getEmployeeDetail).not.toHaveBeenCalled();
  });

  it('rejects an unknown code filter with a 400 before any read', async () => {
    const next = vi.fn();
    await controller.getEmployeeDetail(detailReq({ projectScope: 'everything' }), buildRes(), next);
    await controller.getEmployeeDetail(detailReq({ commitScope: 'squashed' }), buildRes(), next);
    await controller.getEmployeeDetailByUsername(detailReq({ metric: 'lines' }), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(3);
    for (const [error] of next.mock.calls) {
      expect(error).toBeInstanceOf(ServiceValidationError);
      expect(error).toMatchObject({ statusCode: 400 });
    }
    expect(getEmployeeDetail).not.toHaveBeenCalled();
    expect(getEmployeeDetailByUsername).not.toHaveBeenCalled();
  });

  it('rejects an unknown range with a 400 before any read', async () => {
    const next = vi.fn();
    await controller.getEmployeeDetail(detailReq({ range: 'forever' }), buildRes(), next);
    await controller.getEmployeeDetailByUsername(detailReq({ range: 'forever' }), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
    for (const [error] of next.mock.calls) {
      expect(error).toBeInstanceOf(ServiceValidationError);
      expect(error).toMatchObject({ statusCode: 400 });
    }
    expect(getEmployeeDetail).not.toHaveBeenCalled();
    expect(getEmployeeDetailByUsername).not.toHaveBeenCalled();
  });
});

describe('OrgLensPeopleController organization scope (lfx-self-serve-ops#1219)', () => {
  const controller = new OrgLensPeopleController();
  const DETAIL = { personKey: 'person-one', boardSeats: [], committeeSeats: [], code: [], totalCommits: 0, events: [], training: [] };
  const detailReq = (query: Record<string, string>): Request =>
    ({ params: { orgUid: ORG_UID, personKey: 'person-one', username: 'jdoe' }, query, path: '/test' }) as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(EMPTY_ROSTER);
    getFormerEmployees.mockResolvedValue(EMPTY_ROSTER);
    getLive.mockResolvedValue(EMPTY_ROSTER);
    getContributors.mockResolvedValue({ contributors: [], projects: [], foundationOptions: [], stats: { maintainerRoles: 0 } });
    getEmployeeDetail.mockResolvedValue(DETAIL);
    getEmployeeDetailByUsername.mockResolvedValue(DETAIL);
  });

  it('reads the Insights organization by default and passes orgScope=all through to every People read', async () => {
    for (const orgScope of ['insights', 'all'] as const) {
      vi.clearAllMocks();
      const query: Record<string, string> = orgScope === 'insights' ? {} : { orgScope };
      await controller.getAllEmployees(buildRosterReq({ range: '30d', ...query }), buildRes(), vi.fn());
      await controller.getAllEmployees(buildRosterReq({ live: 'true', range: '30d', ...query }), buildRes(), vi.fn());
      await controller.getFormerEmployees(buildRosterReq({ ...query }), buildRes(), vi.fn());
      await controller.getContributors(buildRosterReq({ ...query }), buildRes(), vi.fn());
      await controller.getEmployeeDetail(detailReq({ projectScope: 'lf', ...query }), buildRes(), vi.fn());
      await controller.getEmployeeDetailByUsername(detailReq({ projectScope: 'lf', ...query }), buildRes(), vi.fn());

      expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '30d', DEFAULT_FILTERS, 'exclude', orgScope);
      expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, '30d', DEFAULT_FILTERS, 'exclude', orgScope);
      expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'exclude', orgScope);
      expect(getContributors).toHaveBeenCalledWith(ORG_UID, '730d', DEFAULT_FILTERS, 'all', 'exclude', orgScope);
      expect(getEmployeeDetail).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'person-one', '730d', expect.any(Object), 'exclude', orgScope);
      expect(getEmployeeDetailByUsername).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'jdoe', '730d', expect.any(Object), 'exclude', orgScope);
    }
  });

  it('counts every organization for a code-free detail open, ignoring its orgScope', async () => {
    await controller.getEmployeeDetail(detailReq({ orgScope: 'insights' }), buildRes(), vi.fn());
    await controller.getEmployeeDetailByUsername(detailReq({ orgScope: 'bogus' }), buildRes(), vi.fn());

    expect(getEmployeeDetail).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'person-one', '730d', null, 'include', 'all');
    expect(getEmployeeDetailByUsername).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'jdoe', '730d', null, 'include', 'all');
  });

  it.each(['Insights', 'everyone', 'lf'])('rejects orgScope=%s with a 400 naming the field before any read', async (orgScope) => {
    for (const [read, req] of [
      [controller.getAllEmployees, buildRosterReq({ range: '30d', orgScope })],
      [controller.getAllEmployees, buildRosterReq({ live: 'true', range: '30d', orgScope })],
      [controller.getFormerEmployees, buildRosterReq({ orgScope })],
      [controller.getContributors, buildRosterReq({ orgScope })],
      [controller.getEmployeeDetail, detailReq({ projectScope: 'lf', orgScope })],
      [controller.getEmployeeDetailByUsername, detailReq({ projectScope: 'lf', orgScope })],
    ] as const) {
      const next = vi.fn();
      await read.call(controller, req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
      expect((next.mock.calls[0][0] as Error).message).toContain('orgScope');
    }
    expect(getAllEmployees).not.toHaveBeenCalled();
    expect(getLive).not.toHaveBeenCalled();
    expect(getFormerEmployees).not.toHaveBeenCalled();
    expect(getContributors).not.toHaveBeenCalled();
    expect(getEmployeeDetail).not.toHaveBeenCalled();
    expect(getEmployeeDetailByUsername).not.toHaveBeenCalled();
  });
});

describe('OrgLensPeopleController Trainees outside-learner keys (lfx-self-serve#4287)', () => {
  const controller = new OrgLensPeopleController();
  // The opaque per-response key the Trainees response gives a learner outside the people list.
  const outsideReq = (): Request =>
    ({ params: { orgUid: ORG_UID, personKey: `${ORG_TRAINEE_OUTSIDE_KEY_PREFIX}1` }, query: {}, path: '/test' }) as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects the opaque key with a 400 on the detail, company-email and key-contact endpoints before any read', async () => {
    const next = vi.fn();
    await controller.getEmployeeDetail(outsideReq(), buildRes(), next);
    await controller.getCompanyEmails(outsideReq(), buildRes(), next);
    await controller.getPersonKeyContacts(outsideReq(), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(3);
    for (const [error] of next.mock.calls) {
      expect(error).toBeInstanceOf(ServiceValidationError);
      expect(error).toMatchObject({ statusCode: 400 });
    }
    expect(getEmployeeDetail).not.toHaveBeenCalled();
    expect(getCompanyEmails).not.toHaveBeenCalled();
    expect(getPersonKeyContactsIdentity).not.toHaveBeenCalled();
    expect(getKeyContactsForPerson).not.toHaveBeenCalled();
  });
});

describe('OrgLensPeopleController trainees access qualification', () => {
  const controller = new OrgLensPeopleController();
  const EMPTY_TRAINEES = { accountId: ORG_UID, timeRange: '730d', trainees: [], details: [], outsideLearners: [], asOf: null };

  beforeEach(() => {
    vi.clearAllMocks();
    getTrainees.mockResolvedValue(EMPTY_TRAINEES);
  });

  it.each(['org-grant', 'auditor-entitlement'])('passes the %s read qualification to the service with the range', async (qualification) => {
    assertOrgLensRead.mockResolvedValue(qualification);
    const next = vi.fn();

    await controller.getTrainees(buildRosterReq({ range: '90d' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(assertOrgLensRead).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'get_org_lens_people_trainees');
    expect(getTrainees).toHaveBeenCalledWith(ORG_UID, '90d', qualification);
  });

  it('reads nothing for a caller whose read access is denied', async () => {
    const denied = new Error('forbidden');
    assertOrgLensRead.mockRejectedValue(denied);
    const next = vi.fn();

    await controller.getTrainees(buildRosterReq({}), buildRes(), next);

    expect(next).toHaveBeenCalledWith(denied);
    expect(getTrainees).not.toHaveBeenCalled();
  });
});
