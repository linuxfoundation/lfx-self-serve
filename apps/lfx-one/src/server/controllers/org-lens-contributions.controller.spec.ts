// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getContributions, logger } = vi.hoisted(() => ({
  getContributions: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real page parsing is what runs here.
vi.mock('@lfx-one/shared/utils', () => ({}));
vi.mock('../services/org-contributions.service', () => ({
  OrgContributionsService: class {
    public getContributions = getContributions;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { OrgLensContributionsController } from './org-lens-contributions.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(query: Record<string, unknown>): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('OrgLensContributionsController pagination', () => {
  const controller = new OrgLensContributionsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getContributions.mockResolvedValue({ repositories: [], totalRecords: 0 });
  });

  it.each([
    ['9999999999999999999999999', MAX_SNOWFLAKE_PAGINATION_PAGE],
    ['2.7', 2],
    ['0', 1],
    ['abc', 1],
  ])('bounds page=%s to %s before the service', async (page, expected) => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ page }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ page: expected });
  });
});
