// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_EVENTS_PAGE_SIZE, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrgEvents, getOrgEventsSummary, getOrgEventFoundations, getEventAttendees, logger } = vi.hoisted(() => ({
  getOrgEvents: vi.fn(),
  getOrgEventsSummary: vi.fn(),
  getOrgEventFoundations: vi.fn(),
  getEventAttendees: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
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
  },
}));
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
