// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CONTRIBUTIONS_MAX_FILTER_VALUES, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getContributions, getOrgScope, logger } = vi.hoisted(() => ({
  getContributions: vi.fn(),
  getOrgScope: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real commit-filter parsers stand in for the barrel (vi.mock factories are hoisted, so the module loads dynamically).
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-commit-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-team-members.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-scope.utils')),
}));
vi.mock('../services/org-contributions.service', () => ({
  OrgContributionsService: class {
    public getContributions = getContributions;
    public getOrgScope = getOrgScope;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { ServiceValidationError } from '../errors';
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

describe('OrgLensContributionsController filter lists', () => {
  const controller = new OrgLensContributionsController();
  const csv = (count: number) => Array.from({ length: count }, (_, i) => `value-${i}`).join(',');

  beforeEach(() => {
    vi.clearAllMocks();
    getContributions.mockResolvedValue({ repositories: [], totalRecords: 0 });
  });

  it.each(['projects', 'employees'])('rejects more than the cap of %s values with a 400 before the service', async (field) => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ [field]: csv(CONTRIBUTIONS_MAX_FILTER_VALUES + 1) }), buildRes(), next);

    expect(getContributions).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it.each(['projects', 'employees'])('accepts exactly the cap of %s values', async (field) => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ [field]: csv(CONTRIBUTIONS_MAX_FILTER_VALUES) }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1][field]).toHaveLength(CONTRIBUTIONS_MAX_FILTER_VALUES);
  });

  it('dedupes values before applying the cap', async () => {
    const next = vi.fn();
    const repeated = Array.from({ length: CONTRIBUTIONS_MAX_FILTER_VALUES * 2 }, () => 'same-project').join(',');

    await controller.getContributions(buildReq({ projects: `${repeated}, other ,,` }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ projects: ['same-project', 'other'] });
  });

  // lfx-self-serve#4559 — one foundation id, matched exactly as on People → Contributors.
  it.each([
    [{ foundation: ' f-cncf ' }, 'f-cncf'],
    [{ foundation: 'f'.repeat(255) }, 'f'.repeat(255)],
    [{}, ''],
    [{ foundation: '' }, ''],
    [{ foundation: ['f-cncf', 'f-lfai'] }, ''],
  ])('reads foundation from %o as %j', async (params, expected) => {
    const next = vi.fn();

    await controller.getContributions(buildReq(params), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ foundation: expected });
  });

  it('rejects a foundation longer than 255 characters with a 400 before the service', async () => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ foundation: 'f'.repeat(256) }), buildRes(), next);

    expect(getContributions).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});

describe('OrgLensContributionsController commit filters', () => {
  const controller = new OrgLensContributionsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getContributions.mockResolvedValue({ repositories: [], totalRecords: 0 });
  });

  it('passes the defaults to the service when the params are missing: LF and non-LF projects, all code contributions (lfx-self-serve#4694, #4559)', async () => {
    const next = vi.fn();

    await controller.getContributions(buildReq({}), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ projectScope: 'all', commitScope: 'all', metric: 'code' });
  });

  it.each([[{ projectScope: 'non_lf', commitScope: 'merged', metric: 'code' }], [{ projectScope: 'lf', commitScope: 'all', metric: 'commits' }]])(
    'passes valid values through: %o',
    async (query) => {
      const next = vi.fn();

      await controller.getContributions(buildReq(query), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(getContributions.mock.calls[0][1]).toMatchObject(query);
    }
  );

  it.each([
    ['projectScope', 'foundation'],
    ['commitScope', 'main'],
    ['metric', 'activities'],
  ])('rejects %s=%s with a 400 before the service', async (field, value) => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ [field]: value }), buildRes(), next);

    expect(getContributions).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});

describe('OrgLensContributionsController range', () => {
  const controller = new OrgLensContributionsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getContributions.mockResolvedValue({ repositories: [], totalRecords: 0 });
  });

  it('defaults a missing range to Past 2 years', async () => {
    await controller.getContributions(buildReq({}), buildRes(), vi.fn());

    expect(getContributions.mock.calls[0][1]).toMatchObject({ dateRange: '730d' });
  });

  it.each(['30d', '90d', '365d', '730d', 'all'])('passes range=%s through', async (range) => {
    await controller.getContributions(buildReq({ range }), buildRes(), vi.fn());

    expect(getContributions.mock.calls[0][1]).toMatchObject({ dateRange: range });
  });

  it('reads the legacy 12mo, still sent by tabs opened before the new ranges, as 365d', async () => {
    await controller.getContributions(buildReq({ range: '12mo' }), buildRes(), vi.fn());

    expect(getContributions.mock.calls[0][1]).toMatchObject({ dateRange: '365d' });
  });

  it.each(['12m', '2y', 'ALL'])('rejects the unknown range=%s with a 400', async (range) => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ range }), buildRes(), next);

    expect(getContributions).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});

describe('OrgLensContributionsController team members', () => {
  const controller = new OrgLensContributionsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getContributions.mockResolvedValue({ repositories: [], totalRecords: 0 });
  });

  it('defaults a missing teamMembers to exclude', async () => {
    const next = vi.fn();

    await controller.getContributions(buildReq({}), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ teamMembers: 'exclude' });
  });

  it('passes teamMembers=include through to the service', async () => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ teamMembers: 'include' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ teamMembers: 'include' });
  });

  it('rejects an unknown teamMembers with a 400 before the service', async () => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ teamMembers: 'only' }), buildRes(), next);

    expect(getContributions).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});

describe('OrgLensContributionsController organization scope (lfx-self-serve-ops#1219)', () => {
  const controller = new OrgLensContributionsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getContributions.mockResolvedValue({ repositories: [], totalRecords: 0 });
  });

  it('defaults a missing orgScope to insights and passes orgScope=all through', async () => {
    const next = vi.fn();

    await controller.getContributions(buildReq({}), buildRes(), next);
    await controller.getContributions(buildReq({ orgScope: 'all' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getContributions.mock.calls[0][1]).toMatchObject({ orgScope: 'insights' });
    expect(getContributions.mock.calls[1][1]).toMatchObject({ orgScope: 'all' });
  });

  it.each(['Insights', 'everyone', 'lf'])('rejects orgScope=%s with a 400 before the service', async (orgScope) => {
    const next = vi.fn();

    await controller.getContributions(buildReq({ orgScope }), buildRes(), next);

    expect(getContributions).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect((next.mock.calls[0][0] as Error).message).toContain('orgScope');
  });

  it("answers GET /lens/org-scope with the account's scope, uncached", async () => {
    const scope = {
      accountId: ORG_UID,
      hasInsightsOrg: true,
      insightsOrgId: 'insights-org-1',
      insightsOrgName: 'Example Org',
      insightsOrgSlug: 'example-org',
      relatedOrgCount: 3,
    };
    getOrgScope.mockResolvedValue(scope);
    const res = buildRes();
    const next = vi.fn();

    await controller.getOrgScope(buildReq({}), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getOrgScope).toHaveBeenCalledWith(ORG_UID);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(scope);
  });

  it('rejects an invalid org uid before reading the scope', async () => {
    const next = vi.fn();

    await controller.getOrgScope({ params: { orgUid: 'not-an-org' }, query: {}, path: '/test' } as unknown as Request, buildRes(), next);

    expect(getOrgScope).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });
});
