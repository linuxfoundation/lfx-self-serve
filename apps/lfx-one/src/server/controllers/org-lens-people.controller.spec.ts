// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllEmployees, getFormerEmployees, getLive, getCompanyEmails, getEmployeeDetailByUsername, logger } = vi.hoisted(() => ({
  getAllEmployees: vi.fn(),
  getFormerEmployees: vi.fn(),
  getLive: vi.fn(),
  getCompanyEmails: vi.fn(),
  getEmployeeDetailByUsername: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// The utils barrel pulls Angular into this plain-Node run; the real username allowlist is what runs here.
// vi.mock factories are hoisted above static imports, so the real module can only load via import().
vi.mock('@lfx-one/shared/utils', async () => ({ ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')) }));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../services/org-lens-people.service', () => ({
  OrgLensPeopleService: class {
    public getAllEmployees = getAllEmployees;
    public getFormerEmployees = getFormerEmployees;
    public getCompanyEmails = getCompanyEmails;
    public getEmployeeDetailByUsername = getEmployeeDetailByUsername;
  },
}));
vi.mock('../services/org-people-board-members.service', () => ({ OrgPeopleBoardMembersService: class {} }));
vi.mock('../services/org-people-committee-members.service', () => ({ OrgPeopleCommitteeMembersService: class {} }));
vi.mock('../services/org-people-contributors.service', () => ({ OrgPeopleContributorsService: class {} }));
vi.mock('../services/org-people-directory.service', () => ({
  OrgPeopleDirectoryService: class {
    public getLive = getLive;
  },
}));
vi.mock('../services/org-people-event-attendees.service', () => ({ OrgPeopleEventAttendeesService: class {} }));
vi.mock('../services/org-people-key-contacts.service', () => ({ OrgPeopleKeyContactsService: class {} }));
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

function buildRosterReq(query: Record<string, string>): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

const EMPTY_ROSTER = { accountId: ORG_UID, rows: [], stats: { activeInOss: 0 }, foundations: [] };

describe('OrgLensPeopleController All Employees time range (lfx-self-serve#4163)', () => {
  const controller = new OrgLensPeopleController();

  beforeEach(() => {
    vi.clearAllMocks();
    getAllEmployees.mockResolvedValue(EMPTY_ROSTER);
    getFormerEmployees.mockResolvedValue(EMPTY_ROSTER);
    getLive.mockResolvedValue(EMPTY_ROSTER);
  });

  it('defaults a missing range to 12mo on every roster read', async () => {
    await controller.getAllEmployees(buildRosterReq({}), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ live: 'true' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({}), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '12mo');
    expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, '12mo');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '12mo');
  });

  it('passes a valid range through to the stored, live and former reads', async () => {
    await controller.getAllEmployees(buildRosterReq({ range: '30d' }), buildRes(), vi.fn());
    await controller.getAllEmployees(buildRosterReq({ live: 'true', range: 'all' }), buildRes(), vi.fn());
    await controller.getFormerEmployees(buildRosterReq({ range: '90d' }), buildRes(), vi.fn());

    expect(getAllEmployees).toHaveBeenCalledWith(ORG_UID, '30d');
    expect(getLive).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'all');
    expect(getFormerEmployees).toHaveBeenCalledWith(ORG_UID, '90d');
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
