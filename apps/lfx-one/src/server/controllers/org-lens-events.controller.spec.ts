// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_EVENTS_PAGE_SIZE, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrgEvents, getOrgEventsSummary, getOrgEventFoundations, getEventAttendees, getEventSpeakers, logger } = vi.hoisted(() => ({
  getOrgEvents: vi.fn(),
  getOrgEventsSummary: vi.fn(),
  getOrgEventFoundations: vi.fn(),
  getEventAttendees: vi.fn(),
  getEventSpeakers: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
const family = vi.hoisted(() => ({
  resolveOrgLensRollUp: vi.fn(),
  familyScope: vi.fn(),
  getFamilyOrgEvents: vi.fn(),
  getFamilyOrgEventsSummary: vi.fn(),
  getFamilyOrgEventFoundations: vi.fn(),
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real pagination and Events-filter parsing is what runs here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-events-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('../services/org-lens-events.service', () => ({
  OrgLensEventsService: class {
    public getOrgEvents = getOrgEvents;
    public getOrgEventsSummary = getOrgEventsSummary;
    public getOrgEventFoundations = getOrgEventFoundations;
    public getEventAttendees = getEventAttendees;
    public getEventSpeakers = getEventSpeakers;
    public familyScope = family.familyScope;
    public getFamilyOrgEvents = family.getFamilyOrgEvents;
    public getFamilyOrgEventsSummary = family.getFamilyOrgEventsSummary;
    public getFamilyOrgEventFoundations = family.getFamilyOrgEventFoundations;
  },
}));
vi.mock('../helpers/org-lens-roll-up.helper', () => ({ resolveOrgLensRollUp: family.resolveOrgLensRollUp }));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: () => 'user@example.com' }));

import { OrgLensEventsController } from './org-lens-events.controller';

const ACCOUNT_ID = '001410000000000AAA';

function buildReq(query: Record<string, unknown>): Request {
  return { params: { accountId: ACCOUNT_ID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('OrgLensEventsController pagination', () => {
  const controller = new OrgLensEventsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getOrgEvents.mockResolvedValue({ data: [], total: 0 });
  });

  it('caps an oversized offset and truncates a fractional one before the service', async () => {
    const next = vi.fn();

    await controller.getOrgEvents(buildReq({ offset: '9999999999999999999999999', pageSize: String(MAX_EVENTS_PAGE_SIZE) }), buildRes(), next);
    await controller.getOrgEvents(buildReq({ offset: '0.5', pageSize: String(MAX_EVENTS_PAGE_SIZE) }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getOrgEvents.mock.calls[0][2]).toMatchObject({ offset: MAX_SNOWFLAKE_PAGINATION_PAGE * MAX_EVENTS_PAGE_SIZE, pageSize: MAX_EVENTS_PAGE_SIZE });
    expect(getOrgEvents.mock.calls[1][2]).toMatchObject({ offset: 0, pageSize: MAX_EVENTS_PAGE_SIZE });
  });
});

describe('OrgLensEventsController filters', () => {
  const controller = new OrgLensEventsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getOrgEvents.mockResolvedValue({ data: [], total: 0 });
    getOrgEventsSummary.mockResolvedValue({});
    getOrgEventFoundations.mockResolvedValue({ data: [] });
    getEventAttendees.mockResolvedValue({ total: 0 });
  });

  it('passes the defaults when no filter is sent', async () => {
    await controller.getOrgEvents(buildReq({}), buildRes(), vi.fn());

    expect(getOrgEvents.mock.calls[0][2]).toMatchObject({
      participation: 'all',
      eventScope: 'activity',
      foundation: '',
      range: '730d',
    });
  });

  it('passes each filter to the list, the summary, the foundations and the drawer', async () => {
    const query = { participation: 'attended', eventScope: 'all', foundation: 'foundation-one', range: '90d' };

    await controller.getOrgEvents(buildReq(query), buildRes(), vi.fn());
    await controller.getOrgEventsSummary(buildReq(query), buildRes(), vi.fn());
    await controller.getOrgEventFoundations(buildReq(query), buildRes(), vi.fn());
    await controller.getEventAttendees(
      { ...buildReq(query), params: { accountId: ACCOUNT_ID, eventId: 'event-one' } } as unknown as Request,
      buildRes(),
      vi.fn()
    );

    expect(getOrgEvents.mock.calls[0][2]).toMatchObject({
      participation: 'attended',
      eventScope: 'all',
      foundation: 'foundation-one',
      range: '90d',
    });
    expect(getOrgEventsSummary.mock.calls[0][2]).toEqual({
      participation: 'attended',
      scope: 'all',
      foundation: 'foundation-one',
      range: '90d',
    });
    expect(getOrgEventFoundations.mock.calls[0][2]).toEqual({ scope: 'all' });
    expect(getEventAttendees.mock.calls[0][3]).toMatchObject({ participation: 'attended' });
  });

  it.each([{ participation: 'maybe' }, { eventScope: 'some' }, { range: '5d' }])('rejects %o with a 400 before any read', async (query) => {
    const next = vi.fn();

    await controller.getOrgEvents(buildReq(query), buildRes(), next);
    await controller.getOrgEventsSummary(buildReq(query), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
    for (const [error] of next.mock.calls) {
      expect(error).toMatchObject({ statusCode: 400 });
    }
    expect(getOrgEvents).not.toHaveBeenCalled();
    expect(getOrgEventsSummary).not.toHaveBeenCalled();
  });
});

describe('OrgLensEventsController family roll-up', () => {
  const controller = new OrgLensEventsController();
  const ROLL_UP = `family-${ACCOUNT_ID}`;
  const SUBSIDIARY = '001410000000001AAA';
  const GATE_SCOPE = {
    rollUpKey: ROLL_UP,
    rootUid: ACCOUNT_ID,
    members: [
      { uid: ACCOUNT_ID, accountId: ACCOUNT_ID, name: 'Parent Co', logoUrl: null },
      { uid: SUBSIDIARY, accountId: SUBSIDIARY, name: 'Subsidiary Co', logoUrl: null },
    ],
    complete: true,
    excludedCount: 0,
  };
  const SERVED = { rollUpKey: ROLL_UP };

  function rollUpReq(query: Record<string, unknown> = {}, eventId?: string): Request {
    return { params: { accountId: ROLL_UP, ...(eventId ? { eventId } : {}) }, query, path: '/test' } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    family.resolveOrgLensRollUp.mockResolvedValue(GATE_SCOPE);
    family.familyScope.mockReturnValue(SERVED);
    family.getFamilyOrgEvents.mockResolvedValue({ data: [], total: 0 });
    family.getFamilyOrgEventsSummary.mockResolvedValue({});
    family.getFamilyOrgEventFoundations.mockResolvedValue({ data: [] });
    getEventAttendees.mockResolvedValue({ total: 0 });
    getEventSpeakers.mockResolvedValue({ acceptedCount: 0, submittedCount: 0 });
  });

  it('serves every Events read for a family roll-up key through the roll-up gate', async () => {
    const next = vi.fn();

    await controller.getOrgEvents(rollUpReq(), buildRes(), next);
    await controller.getOrgEventsSummary(rollUpReq(), buildRes(), next);
    await controller.getOrgEventFoundations(rollUpReq(), buildRes(), next);
    await controller.getEventAttendees(rollUpReq({ company: SUBSIDIARY }, 'event-one'), buildRes(), next);
    await controller.getEventSpeakers(rollUpReq({ company: SUBSIDIARY }, 'event-one'), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(family.resolveOrgLensRollUp).toHaveBeenCalledTimes(5);
    expect(family.familyScope).toHaveBeenCalledWith(GATE_SCOPE, undefined);
    expect(family.getFamilyOrgEvents.mock.calls[0][1]).toBe(SERVED);
    expect(family.getFamilyOrgEventsSummary.mock.calls[0][1]).toBe(SERVED);
    expect(family.getFamilyOrgEventFoundations.mock.calls[0][1]).toBe(SERVED);
    expect(getOrgEvents).not.toHaveBeenCalled();
    expect(getOrgEventsSummary).not.toHaveBeenCalled();
  });

  it('reads a roll-up drawer as the single-organization drawer of the company it names', async () => {
    const next = vi.fn();

    await controller.getEventAttendees(rollUpReq({ company: SUBSIDIARY }, 'event-one'), buildRes(), next);
    await controller.getEventSpeakers(rollUpReq({ company: SUBSIDIARY, searchQuery: 'ada' }, 'event-one'), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(family.familyScope).toHaveBeenCalledWith(GATE_SCOPE, SUBSIDIARY);
    expect(getEventAttendees.mock.calls[0].slice(1, 3)).toEqual([SUBSIDIARY, 'event-one']);
    expect(getEventSpeakers.mock.calls[0].slice(1)).toEqual([SUBSIDIARY, 'event-one', 'ada']);
  });

  it.each([
    ['attendees', (req: Request, next: NextFunction) => controller.getEventAttendees(req, buildRes(), next)],
    ['speakers', (req: Request, next: NextFunction) => controller.getEventSpeakers(req, buildRes(), next)],
  ])('refuses a roll-up %s drawer that names no company, before the gate', async (_drawer, read) => {
    const next = vi.fn();

    await read(rollUpReq({}, 'event-one'), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(family.resolveOrgLensRollUp).not.toHaveBeenCalled();
    expect(getEventAttendees).not.toHaveBeenCalled();
    expect(getEventSpeakers).not.toHaveBeenCalled();
  });

  it('refuses a roll-up drawer for a company outside the roll-up', async () => {
    const next = vi.fn();

    await controller.getEventSpeakers(rollUpReq({ company: '001410000000009AAA' }, 'event-one'), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(getEventSpeakers).not.toHaveBeenCalled();
  });

  it('narrows the read to the organization the Company filter names', async () => {
    await controller.getOrgEventsSummary(rollUpReq({ company: SUBSIDIARY }), buildRes(), vi.fn());

    expect(family.familyScope).toHaveBeenCalledWith(GATE_SCOPE, SUBSIDIARY);
  });

  it('refuses a company outside the roll-up with a 400 before any read', async () => {
    const next = vi.fn();

    await controller.getOrgEvents(rollUpReq({ company: '001410000000009AAA' }), buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(family.getFamilyOrgEvents).not.toHaveBeenCalled();
  });

  it('refuses an address that is neither an account id nor a roll-up key, before the gate', async () => {
    const next = vi.fn();

    await controller.getOrgEventsSummary({ params: { accountId: 'family-' }, query: {}, path: '/test' } as unknown as Request, buildRes(), next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect(family.resolveOrgLensRollUp).not.toHaveBeenCalled();
  });
});
