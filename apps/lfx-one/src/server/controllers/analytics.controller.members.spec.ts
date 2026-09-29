// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTiers, getBridge, getMovements } = vi.hoisted(() => ({ getTiers: vi.fn(), getBridge: vi.fn(), getMovements: vi.fn() }));

vi.mock('../services/health-metrics-members.service', () => ({
  HealthMetricsMembersService: class {
    public getTiers = getTiers;
    public getBridge = getBridge;
    public getMovements = getMovements;
  },
}));
// The controller constructs six unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-engagement.service', () => ({ HealthMetricsEngagementService: class {}, isSupportedEngagementRange: () => true }));
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {}, isSupportedEventsRange: () => true }));
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
  HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED,
  HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_MOVEMENTS_UNMEASURED,
  HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED,
} from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

type Handler = 'getMembersTiers' | 'getMembersBridge' | 'getMembersMovements';

function call(queryParams: Record<string, string>, handler: Handler = 'getMembersTiers'): { res: Response; next: NextFunction; promise: Promise<void> } {
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

describe('AnalyticsController.getMembersTiers', () => {
  beforeEach(() => {
    getTiers.mockReset();
    getTiers.mockResolvedValue(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getTiers).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED);
  });

  it.each([{}, { foundationSlug: 'Acme Corp' }])('rejects a missing or malformed foundation (%o)', async (query) => {
    const { next, promise } = call(query as Record<string, string>);
    await promise;

    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
    expect(error?.validationErrors?.[0]?.field).toBe('foundationSlug');
    expect(getTiers).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getTiers.mockRejectedValue(failure);

    const { next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getMembersBridge', () => {
  beforeEach(() => {
    getBridge.mockReset();
    getBridge.mockResolvedValue(HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED);
  });

  it('passes the foundation to the service and returns its response', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' }, 'getMembersBridge');
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getBridge).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED);
  });

  it('rejects a malformed foundation', async () => {
    const { next, promise } = call({ foundationSlug: 'Acme Corp' }, 'getMembersBridge');
    await promise;

    expect(rejectedField(next)).toBe('foundationSlug');
    expect(getBridge).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getBridge.mockRejectedValue(failure);

    const { next, promise } = call({ foundationSlug: 'acme' }, 'getMembersBridge');
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('AnalyticsController.getMembersMovements', () => {
  const valid = { foundationSlug: 'acme', year: '2025', movementType: 'upgrade' };

  beforeEach(() => {
    getMovements.mockReset();
    getMovements.mockResolvedValue(HEALTH_METRICS_MEMBERS_MOVEMENTS_UNMEASURED);
  });

  it('passes the parsed query, defaulting the page, and returns the response', async () => {
    const { res, next, promise } = call(valid, 'getMembersMovements');
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getMovements).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      year: 2025,
      movementType: 'upgrade',
      offset: 0,
      pageSize: HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE,
    });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_MEMBERS_MOVEMENTS_UNMEASURED);
  });

  it('accepts a page within the cap and falls back past it', async () => {
    await call({ ...valid, offset: '50', pageSize: '50' }, 'getMembersMovements').promise;
    expect(getMovements).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ offset: 50, pageSize: 50 }));

    await call({ ...valid, pageSize: String(HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE + 1) }, 'getMembersMovements').promise;
    expect(getMovements).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ pageSize: HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE }));
  });

  it.each([
    [{ ...valid, foundationSlug: 'Acme Corp' }, 'foundationSlug'],
    [{ ...valid, year: '' }, 'year'],
    [{ ...valid, year: '25' }, 'year'],
    [{ ...valid, year: '2025.5' }, 'year'],
    [{ ...valid, movementType: 'churned' }, 'movementType'],
    [{ ...valid, movementType: '' }, 'movementType'],
  ])('rejects %o on %s', async (query, field) => {
    const { next, promise } = call(query, 'getMembersMovements');
    await promise;

    expect(rejectedField(next)).toBe(field);
    expect(getMovements).not.toHaveBeenCalled();
  });

  it('hands a service failure to next()', async () => {
    const failure = new Error('warehouse down');
    getMovements.mockRejectedValue(failure);

    const { next, promise } = call(valid, 'getMembersMovements');
    await promise;

    expect(next).toHaveBeenCalledWith(failure);
  });
});
