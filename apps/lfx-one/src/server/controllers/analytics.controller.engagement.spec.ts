// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGroupAttendance, getMeetingParticipation, getNonMemberParticipation, getOrgParticipation, getRepresentatives } = vi.hoisted(() => ({
  getGroupAttendance: vi.fn(),
  getMeetingParticipation: vi.fn(),
  getNonMemberParticipation: vi.fn(),
  getOrgParticipation: vi.fn(),
  getRepresentatives: vi.fn(),
}));

vi.mock('../services/health-metrics-engagement.service', async () => {
  // The range guard is real — a rename of the view's period columns must fail this suite too.
  const actual = await vi.importActual<typeof import('../services/health-metrics-engagement.service')>('../services/health-metrics-engagement.service');
  return {
    isSupportedEngagementRange: actual.isSupportedEngagementRange,
    HealthMetricsEngagementService: class {
      public getGroupAttendance = getGroupAttendance;
      public getMeetingParticipation = getMeetingParticipation;
      public getNonMemberParticipation = getNonMemberParticipation;
      public getOrgParticipation = getOrgParticipation;
      public getRepresentatives = getRepresentatives;
    },
  };
});
// The controller constructs five unrelated domain services; none of them are exercised here.
vi.mock('../services/health-metrics-events.service', () => ({ HealthMetricsEventsService: class {} }));
vi.mock('../services/org-involvement.service', () => ({ OrgInvolvementService: class {} }));
vi.mock('../services/organization.service', () => ({ OrganizationService: class {} }));
vi.mock('../services/project.service', () => ({ ProjectService: class {} }));
vi.mock('../services/user.service', () => ({ UserService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which re-exports Angular-dependent
// utils that cannot load in this server-only runtime. Delegate to the real implementation instead of
// stubbing, so a change to period resolution still fails this suite.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/marketing-impact.utils');
  return { resolvePeriodRange: actual.resolvePeriodRange };
});

import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED,
} from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { AnalyticsController } from './analytics.controller';

function call(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getEngagementGroupAttendance(req, res, next) };
}

/** The error handed to `next()`, which is how every failure leaves this controller. */
function rejectedField(next: NextFunction): string | undefined {
  const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError | undefined;
  return error?.validationErrors?.[0]?.field;
}

describe('AnalyticsController.getEngagementGroupAttendance', () => {
  beforeEach(() => {
    getGroupAttendance.mockReset();
    getGroupAttendance.mockResolvedValue(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED);
  });

  it('defaults the optional params and passes a fully-resolved query to the service', async () => {
    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getGroupAttendance).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      projectSlug: null,
      groupType: 'all',
      range: 'YTD',
      page: 1,
      size: 25,
    });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_UNMEASURED);
  });

  it('forwards every supplied param, coercing page and size to numbers', async () => {
    const { promise } = call({ foundationSlug: 'acme', projectSlug: 'acme-core', groupType: 'wg', range: 'COMPLETED_YEAR', page: '3', size: '50' });
    await promise;

    expect(getGroupAttendance).toHaveBeenCalledWith(expect.anything(), {
      foundationSlug: 'acme',
      projectSlug: 'acme-core',
      groupType: 'wg',
      range: 'COMPLETED_YEAR',
      page: 3,
      size: 50,
    });
  });

  it('requires a foundation slug, since that is what scopes an ED to their own data', async () => {
    const { next, promise } = call({});
    await promise;

    expect(getGroupAttendance).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it.each([
    ['foundationSlug', { foundationSlug: 'Acme Corp' }],
    ['projectSlug', { foundationSlug: 'acme', projectSlug: "core' OR 1=1" }],
  ])('rejects a %s that is not a slug', async (field, queryParams) => {
    const { next, promise } = call(queryParams);
    await promise;

    expect(getGroupAttendance).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe(field);
  });

  it('rejects a group type outside the four design cuts', async () => {
    const { next, promise } = call({ foundationSlug: 'acme', groupType: 'board' });
    await promise;

    expect(getGroupAttendance).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('groupType');
  });

  it('rejects an unknown range, and the one range this view has no columns for', async () => {
    const unknown = call({ foundationSlug: 'acme', range: 'LAST_WEEK' });
    await unknown.promise;
    expect(rejectedField(unknown.next)).toBe('range');

    const unsupported = call({ foundationSlug: 'acme', range: 'COMPLETED_YEAR_4' });
    await unsupported.promise;
    expect(rejectedField(unsupported.next)).toBe('range');

    expect(getGroupAttendance).not.toHaveBeenCalled();
  });

  it('hands a service failure to the error middleware rather than answering with a body', async () => {
    getGroupAttendance.mockRejectedValue(new Error('snowflake down'));

    const { res, next, promise } = call({ foundationSlug: 'acme' });
    await promise;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowflake down' }));
  });
});

function callParticipation(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getEngagementMeetingParticipation(req, res, next) };
}

describe('AnalyticsController.getEngagementMeetingParticipation', () => {
  beforeEach(() => {
    getMeetingParticipation.mockReset();
    getMeetingParticipation.mockResolvedValue(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED);
  });

  it('defaults the range and answers with the service response', async () => {
    const { res, promise } = callParticipation({ foundationSlug: 'acme' });
    await promise;

    expect(getMeetingParticipation).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme', range: 'YTD' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_UNMEASURED);
  });

  it('forwards a supported range', async () => {
    const { promise } = callParticipation({ foundationSlug: 'acme', range: 'COMPLETED_YEAR' });
    await promise;

    expect(getMeetingParticipation).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme', range: 'COMPLETED_YEAR' });
  });

  it('requires a foundation slug, since that is what scopes an ED to their own data', async () => {
    const { next, promise } = callParticipation({});
    await promise;

    expect(getMeetingParticipation).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('rejects a foundation slug that is not a slug', async () => {
    const { next, promise } = callParticipation({ foundationSlug: "acme' OR 1=1" });
    await promise;

    expect(getMeetingParticipation).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('rejects an unknown range, and the one range this view has no columns for', async () => {
    const unknown = callParticipation({ foundationSlug: 'acme', range: 'LAST_WEEK' });
    await unknown.promise;
    expect(rejectedField(unknown.next)).toBe('range');

    const unsupported = callParticipation({ foundationSlug: 'acme', range: 'COMPLETED_YEAR_4' });
    await unsupported.promise;
    expect(rejectedField(unsupported.next)).toBe('range');

    expect(getMeetingParticipation).not.toHaveBeenCalled();
  });

  it('hands a service failure to the error middleware rather than answering with a body', async () => {
    getMeetingParticipation.mockRejectedValue(new Error('snowflake down'));

    const { res, next, promise } = callParticipation({ foundationSlug: 'acme' });
    await promise;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowflake down' }));
  });
});

function callOrgs(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getEngagementOrgParticipation(req, res, next) };
}

describe('AnalyticsController.getEngagementOrgParticipation', () => {
  beforeEach(() => {
    getOrgParticipation.mockReset();
    getOrgParticipation.mockResolvedValue(HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED);
  });

  // Every period ships in one read, so a range on the wire would be a param the service ignores.
  it('takes the foundation alone and answers with the service response', async () => {
    const { res, next, promise } = callOrgs({ foundationSlug: 'acme', range: 'COMPLETED_YEAR' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getOrgParticipation).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_ENGAGEMENT_ORG_UNMEASURED);
  });

  it('requires a foundation slug, since that is what scopes an ED to their own data', async () => {
    const { next, promise } = callOrgs({});
    await promise;

    expect(getOrgParticipation).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('rejects a foundation slug that is not a slug', async () => {
    const { next, promise } = callOrgs({ foundationSlug: "acme' OR 1=1" });
    await promise;

    expect(getOrgParticipation).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('hands a service failure to the error middleware rather than answering with a body', async () => {
    getOrgParticipation.mockRejectedValue(new Error('snowflake down'));

    const { res, next, promise } = callOrgs({ foundationSlug: 'acme' });
    await promise;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowflake down' }));
  });
});

function callNonMembers(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getEngagementNonMemberParticipation(req, res, next) };
}

describe('AnalyticsController.getEngagementNonMemberParticipation', () => {
  beforeEach(() => {
    getNonMemberParticipation.mockReset();
    getNonMemberParticipation.mockResolvedValue(HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED);
  });

  // The view carries no project key, so a project on the wire would be a param the service ignores.
  it('takes the foundation alone and answers with the service response', async () => {
    const { res, next, promise } = callNonMembers({ foundationSlug: 'acme', projectSlug: 'acme-core' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getNonMemberParticipation).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_UNMEASURED);
  });

  it('requires a foundation slug, since that is what scopes an ED to their own data', async () => {
    const { next, promise } = callNonMembers({});
    await promise;

    expect(getNonMemberParticipation).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('rejects a foundation slug that is not a slug', async () => {
    const { next, promise } = callNonMembers({ foundationSlug: "acme' OR 1=1" });
    await promise;

    expect(getNonMemberParticipation).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('hands a service failure to the error middleware rather than answering with a body', async () => {
    getNonMemberParticipation.mockRejectedValue(new Error('snowflake down'));

    const { res, next, promise } = callNonMembers({ foundationSlug: 'acme' });
    await promise;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowflake down' }));
  });
});

function callReps(queryParams: Record<string, string>): { res: Response; next: NextFunction; promise: Promise<void> } {
  const controller = new AnalyticsController();
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  const req = { query: queryParams } as unknown as Request;

  return { res, next, promise: controller.getEngagementRepresentatives(req, res, next) };
}

describe('AnalyticsController.getEngagementRepresentatives', () => {
  beforeEach(() => {
    getRepresentatives.mockReset();
    getRepresentatives.mockResolvedValue(HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED);
  });

  // Scope is expressed by the caption columns rather than a project key, so a project on the wire
  // would be a param the service ignores.
  it('takes the foundation alone and answers with the service response', async () => {
    const { res, next, promise } = callReps({ foundationSlug: 'acme', projectSlug: 'acme-core' });
    await promise;

    expect(next).not.toHaveBeenCalled();
    expect(getRepresentatives).toHaveBeenCalledWith(expect.anything(), { foundationSlug: 'acme' });
    expect(res.json).toHaveBeenCalledWith(HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_UNMEASURED);
  });

  it('requires a foundation slug, since that is what scopes an ED to their own data', async () => {
    const { next, promise } = callReps({});
    await promise;

    expect(getRepresentatives).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('rejects a foundation slug that is not a slug', async () => {
    const { next, promise } = callReps({ foundationSlug: "acme' OR 1=1" });
    await promise;

    expect(getRepresentatives).not.toHaveBeenCalled();
    expect(rejectedField(next)).toBe('foundationSlug');
  });

  it('hands a service failure to the error middleware rather than answering with a body', async () => {
    getRepresentatives.mockRejectedValue(new Error('snowflake down'));

    const { res, next, promise } = callReps({ foundationSlug: 'acme' });
    await promise;

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowflake down' }));
  });
});
