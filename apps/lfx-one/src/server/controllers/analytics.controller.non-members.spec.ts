// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrgs, getPeople } = vi.hoisted(() => ({ getOrgs: vi.fn(), getPeople: vi.fn() }));

vi.mock('../services/health-metrics-non-members.service', () => ({
  HealthMetricsNonMembersService: class {
    public getOrgs = getOrgs;
    public getPeople = getPeople;
  },
  // The views carry the four L2 periods; a fourth completed year has no columns.
  isSupportedNonMembersRange: (range: string) => ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'].includes(range),
}));
// The controller constructs seven unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {}, isSupportedEventsRange: () => true }));
vi.mock('../services/health-metrics-members.service', () => ({ HealthMetricsMembersService: class {}, isSupportedMembersRange: () => true }));
vi.mock('../services/org-involvement.service', () => ({ OrgInvolvementService: class {} }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import {
  HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_SEARCH_LENGTH,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_UNMEASURED,
} from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

import { logger } from '../services/logger.service';

function call(
  queryParams: Record<string, string>,
  handler: 'getNonMembersOrgs' | 'getNonMembersPeople' = 'getNonMembersOrgs'
): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller[handler](req, res, next) };
}

function rejectedField(next: NextFunction): string | undefined {
  const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
  return error?.validationErrors?.[0]?.field;
}

describe('AnalyticsController.getNonMembersOrgs', () => {
  const valid = { foundationSlug: 'acme' };

  beforeEach(() => {
    getOrgs.mockReset();
    getOrgs.mockResolvedValue(HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED);
  });

  it('defaults to the running year, every organization and the first page, and returns the response', async () => {
    const { res, next, promise } = call(valid);
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getOrgs).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'YTD',
      filter: 'all',
      search: '',
      offset: 0,
      pageSize: HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE,
    });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED);
  });

  it('passes the period, filter, trimmed search and page', async () => {
    const longSearch = `  ${'a'.repeat(HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH + 10)}  `;
    await call({ ...valid, range: 'COMPLETED_YEAR', filter: 'high-fit', search: longSearch, offset: '20', pageSize: '25' }).promise;

    expect(getOrgs).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'COMPLETED_YEAR',
      filter: 'high-fit',
      search: 'a'.repeat(HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH),
      offset: 20,
      pageSize: 25,
    });
  });

  it('falls back to the default page size past the cap', async () => {
    await call({ ...valid, pageSize: String(HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE + 1) }).promise;

    expect(getOrgs).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ pageSize: HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE }));
  });

  it.each([
    [{ foundationSlug: '' }, 'foundationSlug'],
    [{ ...valid, foundationSlug: 'Acme Corp' }, 'foundationSlug'],
    [{ ...valid, range: 'LAST_WEEK' }, 'range'],
    [{ ...valid, range: 'COMPLETED_YEAR_4' }, 'range'],
    [{ ...valid, filter: 'medium-fit' }, 'filter'],
  ])('rejects %o on %s', async (query, field) => {
    const { next, promise } = call(query);
    await promise;

    expect(rejectedField(next)).toBe(field);
    expect(getOrgs).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getOrgs.mockRejectedValue(failure);

    const { next, promise } = call(valid);
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getNonMembersPeople', () => {
  const valid = { foundationSlug: 'acme' };
  const people = (query: Record<string, string>) => call(query, 'getNonMembersPeople');

  beforeEach(() => {
    vi.mocked(logger.success).mockClear();
    getPeople.mockReset();
    getPeople.mockResolvedValue({ ...HEALTH_METRICS_NON_MEMBERS_PEOPLE_UNMEASURED, totalRecords: 3, scopeTotal: 214 });
  });

  it('defaults to the running year and the first page, and returns the response', async () => {
    const { res, next, promise } = people(valid);
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getPeople).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'YTD',
      search: '',
      offset: 0,
      pageSize: HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE,
    });
    expect(res.json).toHaveBeenCalledWith({ ...HEALTH_METRICS_NON_MEMBERS_PEOPLE_UNMEASURED, totalRecords: 3, scopeTotal: 214 });
  });

  it('passes the period, trimmed search and page', async () => {
    const longSearch = `  ${'a'.repeat(HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_SEARCH_LENGTH + 10)}  `;
    await people({ ...valid, range: 'COMPLETED_YEAR_3', search: longSearch, offset: '20', pageSize: '25' }).promise;

    expect(getPeople).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      range: 'COMPLETED_YEAR_3',
      search: 'a'.repeat(HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_SEARCH_LENGTH),
      offset: 20,
      pageSize: 25,
    });
  });

  it('falls back to the default page size past the cap', async () => {
    await people({ ...valid, pageSize: String(HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE + 1) }).promise;

    expect(getPeople).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ pageSize: HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE }));
  });

  it('logs counts only, never the search text', async () => {
    await people({ ...valid, search: 'Jane Doe' }).promise;

    const metadata = vi.mocked(logger.success).mock.calls[0]?.[3];
    expect(metadata).toEqual({ foundation_slug: 'acme', range: 'YTD', has_search: true, total_records: 3, scope_total: 214 });
    expect(JSON.stringify(metadata)).not.toContain('Jane');
  });

  it.each([
    [{ foundationSlug: '' }, 'foundationSlug'],
    [{ ...valid, foundationSlug: 'Acme Corp' }, 'foundationSlug'],
    [{ ...valid, range: 'LAST_WEEK' }, 'range'],
    [{ ...valid, range: 'COMPLETED_YEAR_4' }, 'range'],
  ])('rejects %o on %s', async (query, field) => {
    const { next, promise } = people(query);
    await promise;

    expect(rejectedField(next)).toBe(field);
    expect(getPeople).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getPeople.mockRejectedValue(failure);

    const { next, promise } = people(valid);
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
