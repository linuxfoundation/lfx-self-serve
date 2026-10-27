// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCompanyEmails, getCompanyEmailsByUsername, getEmployeeDetailByUsername, getKeyContactsForPerson, resolveUsernameByPersonKey, logger } = vi.hoisted(
  () => ({
    getCompanyEmails: vi.fn(),
    getCompanyEmailsByUsername: vi.fn(),
    getEmployeeDetailByUsername: vi.fn(),
    getKeyContactsForPerson: vi.fn(),
    resolveUsernameByPersonKey: vi.fn(),
    logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
  })
);

// The utils barrel pulls Angular into this plain-Node run; the real username allowlist is what runs here.
// vi.mock factories are hoisted above static imports, so the real module can only load via import().
vi.mock('@lfx-one/shared/utils', async () => ({ ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')) }));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../services/org-lens-people.service', () => ({
  OrgLensPeopleService: class {
    public getCompanyEmails = getCompanyEmails;
    public getCompanyEmailsByUsername = getCompanyEmailsByUsername;
    public getEmployeeDetailByUsername = getEmployeeDetailByUsername;
    public resolveUsernameByPersonKey = resolveUsernameByPersonKey;
  },
}));
vi.mock('../services/org-people-board-members.service', () => ({ OrgPeopleBoardMembersService: class {} }));
vi.mock('../services/org-people-committee-members.service', () => ({ OrgPeopleCommitteeMembersService: class {} }));
vi.mock('../services/org-people-contributors.service', () => ({ OrgPeopleContributorsService: class {} }));
vi.mock('../services/org-people-directory.service', () => ({ OrgPeopleDirectoryService: class {} }));
vi.mock('../services/org-people-event-attendees.service', () => ({ OrgPeopleEventAttendeesService: class {} }));
vi.mock('../services/org-people-key-contacts.service', () => ({
  OrgPeopleKeyContactsService: class {
    public getKeyContactsForPerson = getKeyContactsForPerson;
  },
}));
vi.mock('../services/org-people-trainees.service', () => ({ OrgPeopleTraineesService: class {} }));

import { ServiceValidationError } from '../errors';
import { OrgLensPeopleController } from './org-lens-people.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(username: string): Request {
  return { params: { orgUid: ORG_UID, username }, query: {}, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

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
    expect(getCompanyEmails).not.toHaveBeenCalled();
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

  // An identity in the URL is an identity in the request log, so the client sends none.
  it('ignores a client-supplied username and uses the roster one instead', async () => {
    getCompanyEmails.mockResolvedValue({ companyEmails: [], companyEmailsStatus: 'resolved' });
    resolveUsernameByPersonKey.mockResolvedValue('roster-name');
    getKeyContactsForPerson.mockResolvedValue({ assignments: [], status: 'resolved' });

    await controller.getPersonKeyContacts(personKeyReq(PERSON_KEY, { username: 'client-supplied' }), buildRes(), vi.fn());

    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, {
      username: 'roster-name',
      emails: [],
      emailsStatus: 'resolved',
    });
  });

  it('identifies a person key by its resolved addresses, with no username when the roster carries none', async () => {
    getCompanyEmails.mockResolvedValue({ companyEmails: ['first.person@vendor-corp.example'], companyEmailsStatus: 'resolved' });
    resolveUsernameByPersonKey.mockResolvedValue(null);
    getKeyContactsForPerson.mockResolvedValue({ assignments: [{ role: 'Billing Contact' }], status: 'resolved' });
    const res = buildRes();
    const next = vi.fn();

    await controller.getPersonKeyContacts(personKeyReq(PERSON_KEY), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, {
      username: null,
      emails: ['first.person@vendor-corp.example'],
      emailsStatus: 'resolved',
    });
    expect(res.json).toHaveBeenCalledWith({ assignments: [{ role: 'Billing Contact' }], status: 'resolved' });
  });

  it("passes the roster's username through as the stronger key", async () => {
    getCompanyEmails.mockResolvedValue({ companyEmails: ['first.person@vendor-corp.example'], companyEmailsStatus: 'resolved' });
    resolveUsernameByPersonKey.mockResolvedValue('jdoe');
    getKeyContactsForPerson.mockResolvedValue({ assignments: [], status: 'resolved' });

    await controller.getPersonKeyContacts(personKeyReq(PERSON_KEY), buildRes(), vi.fn());

    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, {
      username: 'jdoe',
      emails: ['first.person@vendor-corp.example'],
      emailsStatus: 'resolved',
    });
  });

  // The address status decides what an unmatched identity may claim, so it must reach the service intact
  // rather than being flattened into an empty address list.
  it.each(['unavailable', 'failed'])('forwards a %s address status instead of passing addresses it does not have', async (companyEmailsStatus) => {
    getCompanyEmails.mockResolvedValue({ companyEmails: [], companyEmailsStatus });
    resolveUsernameByPersonKey.mockResolvedValue(null);
    getKeyContactsForPerson.mockResolvedValue({ assignments: [], status: companyEmailsStatus === 'failed' ? 'failed' : 'unidentified' });

    await controller.getPersonKeyContacts(personKeyReq(PERSON_KEY), buildRes(), vi.fn());

    expect(getKeyContactsForPerson).toHaveBeenCalledWith(expect.anything(), ORG_UID, { username: null, emails: [], emailsStatus: companyEmailsStatus });
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
