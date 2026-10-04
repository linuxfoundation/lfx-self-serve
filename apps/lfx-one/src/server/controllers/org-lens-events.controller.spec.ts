// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_EVENTS_PAGE_SIZE, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrgEvents, logger } = vi.hoisted(() => ({
  getOrgEvents: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real pagination parsing is what runs here.
vi.mock('@lfx-one/shared/utils', () => ({}));
vi.mock('../services/org-lens-events.service', () => ({
  OrgLensEventsService: class {
    public getOrgEvents = getOrgEvents;
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
