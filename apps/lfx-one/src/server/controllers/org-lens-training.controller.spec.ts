// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_ORG_TRAINING_FILTER_VALUE_LENGTH, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assertOrgLensRead, getTrainingStats, getFilterOptions, getGroups, getGroupEmployees, logger } = vi.hoisted(() => ({
  assertOrgLensRead: vi.fn(),
  getTrainingStats: vi.fn(),
  getFilterOptions: vi.fn(),
  getGroups: vi.fn(),
  getGroupEmployees: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real pagination parsing and the real view-state parser are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-training-view-state.utils')),
}));
vi.mock('../services/org-lens-training.service', () => ({
  OrgLensTrainingService: class {
    public getTrainingStats = getTrainingStats;
    public getFilterOptions = getFilterOptions;
    public getGroups = getGroups;
    public getGroupEmployees = getGroupEmployees;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ assertOrgLensRead }));

import { ServiceValidationError } from '../errors';
import { OrgLensTrainingController } from './org-lens-training.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(query: Record<string, unknown>): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('OrgLensTrainingController', () => {
  const controller = new OrgLensTrainingController();

  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgLensRead.mockResolvedValue('org-grant');
    getTrainingStats.mockResolvedValue({ rosterMembers: null, peopleWithTrainingActivity: 0, coursesTaken: 0 });
    getFilterOptions.mockResolvedValue({ courses: [] });
    getGroups.mockResolvedValue({ data: [], total: 0, totals: {} });
    getGroupEmployees.mockResolvedValue({ total: 0 });
  });

  it('stats: parses range and filters like the URL util, defaulting an unknown range and trimming blanks', async () => {
    const next = vi.fn();

    await controller.getTrainingStats(buildReq({ range: 'bogus', foundation: ' f-1 ', course: '', level: 'Beginner' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getTrainingStats).toHaveBeenCalledWith(
      ORG_UID,
      { range: '730d', foundation: 'f-1', project: null, course: null, level: 'Beginner', format: null },
      'org-grant'
    );
  });

  it('forwards how the caller qualified, so the service can keep an entitlement-only caller off the shared caches', async () => {
    assertOrgLensRead.mockResolvedValue('auditor-entitlement');

    await controller.getTrainingStats(buildReq({}), buildRes(), vi.fn());
    await controller.getFilterOptions(buildReq({}), buildRes(), vi.fn());
    await controller.getGroups(buildReq({}), buildRes(), vi.fn());
    await controller.getGroupEmployees(buildReq({ groupValue: 'x', status: 'completed' }), buildRes(), vi.fn());

    expect(getTrainingStats.mock.calls[0][2]).toBe('auditor-entitlement');
    expect(getFilterOptions.mock.calls[0][2]).toBe('auditor-entitlement');
    expect(getGroups.mock.calls[0][4]).toBe('auditor-entitlement');
    expect(getGroupEmployees.mock.calls[0][4]).toBe('auditor-entitlement');
  });

  it('stops before the service when the read gate denies', async () => {
    assertOrgLensRead.mockRejectedValue(new Error('denied'));
    const next = vi.fn();

    await controller.getTrainingStats(buildReq({}), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getTrainingStats).not.toHaveBeenCalled();
  });

  it('stats: forwards an allow-listed range', async () => {
    await controller.getTrainingStats(buildReq({ range: 'all' }), buildRes(), vi.fn());

    expect(getTrainingStats.mock.calls[0][1]).toMatchObject({ range: 'all' });
  });

  it('stats: rejects a malformed org uid', async () => {
    const next = vi.fn();

    await controller.getTrainingStats({ params: { orgUid: '' }, query: {}, path: '/test' } as unknown as Request, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getTrainingStats).not.toHaveBeenCalled();
  });

  it('filter-options: passes only the range', async () => {
    await controller.getFilterOptions(buildReq({ range: '90d', course: 'ignored' }), buildRes(), vi.fn());

    expect(getFilterOptions).toHaveBeenCalledWith(ORG_UID, '90d', 'org-grant');
  });

  describe('groups', () => {
    it('allow-lists groupBy, tab, sort field and order, and defaults the rest', async () => {
      const next = vi.fn();

      await controller.getGroups(buildReq({ groupBy: 'drop table', sortField: 'COURSE_NAME; --', sortOrder: 'sideways', search: 'abc' }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(getGroups.mock.calls[0][3]).toMatchObject({
        groupBy: 'course',
        tab: 'certifications',
        sortField: 'completed',
        sortOrder: 'DESC',
        searchQuery: 'abc',
        pageSize: 10,
        offset: 0,
      });
    });

    it('rejects an unknown tab', async () => {
      const next = vi.fn();

      await controller.getGroups(buildReq({ tab: 'other' }), buildRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(getGroups).not.toHaveBeenCalled();
    });

    it('caps an oversized offset and truncates a fractional one before the service', async () => {
      await controller.getGroups(buildReq({ offset: '9999999999999999999999999', pageSize: '100' }), buildRes(), vi.fn());
      await controller.getGroups(buildReq({ offset: '0.5', pageSize: '100' }), buildRes(), vi.fn());

      expect(getGroups.mock.calls[0][3]).toMatchObject({ offset: MAX_SNOWFLAKE_PAGINATION_PAGE * 100, pageSize: 100 });
      expect(getGroups.mock.calls[1][3]).toMatchObject({ offset: 0, pageSize: 100 });
    });
  });

  describe('group employees', () => {
    it('forwards a valid cell, accepting the empty group value', async () => {
      const next = vi.fn();

      await controller.getGroupEmployees(
        buildReq({ groupBy: 'format', groupValue: '', tab: 'trainings', status: 'in-progress', level: 'Beginner' }),
        buildRes(),
        next
      );

      expect(next).not.toHaveBeenCalled();
      expect(getGroupEmployees.mock.calls[0][3]).toEqual({ groupBy: 'format', groupValue: '', tab: 'trainings', status: 'in-progress' });
      expect(getGroupEmployees.mock.calls[0][2]).toMatchObject({ level: 'Beginner' });
    });

    it('forwards a groupValue at the cap and rejects one over it, never cutting it', async () => {
      const next = vi.fn();

      await controller.getGroupEmployees(buildReq({ groupValue: 'x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH), status: 'completed' }), buildRes(), next);
      expect(next).not.toHaveBeenCalled();
      expect(getGroupEmployees.mock.calls[0][3].groupValue).toHaveLength(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH);

      await controller.getGroupEmployees(buildReq({ groupValue: 'x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH + 1), status: 'completed' }), buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(getGroupEmployees).toHaveBeenCalledTimes(1);
    });

    it('rejects a groupValue that is not one string or is over the cap, and leaves any other string to the service, which accepts only a real group key', async () => {
      const next = vi.fn();

      await controller.getGroupEmployees(buildReq({ groupValue: ['a', 'b'], status: 'completed' }), buildRes(), next);
      await controller.getGroupEmployees(buildReq({ groupValue: 'x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH + 1), status: 'completed' }), buildRes(), next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(next.mock.calls.every(([e]) => e instanceof ServiceValidationError)).toBe(true);
      expect(getGroupEmployees).not.toHaveBeenCalled();

      await controller.getGroupEmployees(buildReq({ groupValue: '\tTabbed', status: 'completed' }), buildRes(), vi.fn());
      expect(getGroupEmployees).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['status missing', { groupValue: 'x' }],
      ['status unknown', { groupValue: 'x', status: 'certified' }],
      ['groupValue missing', { status: 'completed' }],
      ['tab unknown', { groupValue: 'x', status: 'completed', tab: 'nope' }],
    ])('rejects %s', async (_name, query) => {
      const next = vi.fn();

      await controller.getGroupEmployees(buildReq(query), buildRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(getGroupEmployees).not.toHaveBeenCalled();
    });
  });

  describe('malformed filter values', () => {
    const params = ['foundation', 'trainingProject', 'course', 'level', 'format'];

    it.each(params)('rejects a %s that is over the length cap, holds a control character, or is not one string, before any service call', async (param) => {
      const next = vi.fn();
      const bad = ['x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH + 1), 'a\nb', ['a', 'b']];

      for (const value of bad) {
        await controller.getTrainingStats(buildReq({ [param]: value }), buildRes(), next);
        await controller.getGroups(buildReq({ [param]: value }), buildRes(), next);
        await controller.getGroupEmployees(buildReq({ [param]: value, groupValue: 'x', status: 'completed' }), buildRes(), next);
      }

      expect(next).toHaveBeenCalledTimes(bad.length * 3);
      expect(next.mock.calls.every(([e]) => e instanceof ServiceValidationError)).toBe(true);
      expect(getTrainingStats).not.toHaveBeenCalled();
      expect(getGroups).not.toHaveBeenCalled();
      expect(getGroupEmployees).not.toHaveBeenCalled();
    });

    it('accepts a tab-prefixed filter value on stats, groups and the drawer, as the dropdown offers it', async () => {
      const next = vi.fn();

      await controller.getTrainingStats(buildReq({ course: '\tTabbed' }), buildRes(), next);
      await controller.getGroups(buildReq({ course: '\tTabbed' }), buildRes(), next);
      await controller.getGroupEmployees(buildReq({ course: '\tTabbed', groupValue: '\tTabbed', status: 'completed' }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(getTrainingStats).toHaveBeenCalledWith(ORG_UID, expect.objectContaining({ course: '\tTabbed' }), 'org-grant');
    });

    it('accepts a value at the cap, and trims surrounding whitespace before measuring it', async () => {
      const next = vi.fn();

      await controller.getTrainingStats(buildReq({ course: 'x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH) }), buildRes(), next);
      await controller.getTrainingStats(buildReq({ course: `  ${'y'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH)}  ` }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(getTrainingStats.mock.calls[1][1].course).toBe('y'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH));
    });
  });

  describe('a filter value the service answers with zeros', () => {
    const ZERO_STATS = { range: '30d', rosterMembers: null, peopleWithTrainingActivity: 0, coursesTaken: 0 };
    const ZERO_GROUPS = { data: [], total: 0, totals: { people: 0, coursesTaken: 0, completed: 0, inProgress: 0 } };
    const ZERO_DRAWER = { groupBy: 'course', groupValue: 'x', label: 'x', tab: 'certifications', status: 'completed', total: 0, data: [] };

    it('sends the zero payloads as a normal response, never turned into an error', async () => {
      getTrainingStats.mockResolvedValue(ZERO_STATS);
      getGroups.mockResolvedValue(ZERO_GROUPS);
      getGroupEmployees.mockResolvedValue(ZERO_DRAWER);
      const next = vi.fn();
      const [statsRes, groupsRes, drawerRes] = [buildRes(), buildRes(), buildRes()];

      await controller.getTrainingStats(buildReq({ range: '30d', level: 'Beginner' }), statsRes, next);
      await controller.getGroups(buildReq({ range: '30d', level: 'Beginner' }), groupsRes, next);
      await controller.getGroupEmployees(buildReq({ range: '30d', level: 'Beginner', groupValue: 'x', status: 'completed' }), drawerRes, next);

      expect(next).not.toHaveBeenCalled();
      expect(statsRes.json).toHaveBeenCalledWith(ZERO_STATS);
      expect(groupsRes.json).toHaveBeenCalledWith(ZERO_GROUPS);
      expect(drawerRes.json).toHaveBeenCalledWith(ZERO_DRAWER);
    });

    it('forwards an unknown (well-formed) filter value to the service, which answers it with zeros', async () => {
      const next = vi.fn();

      await controller.getTrainingStats(buildReq({ level: 'Unknown' }), buildRes(), next);
      await controller.getGroups(buildReq({ level: 'Unknown' }), buildRes(), next);
      await controller.getGroupEmployees(buildReq({ level: 'Unknown', groupValue: 'x', status: 'completed' }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(getTrainingStats.mock.calls[0][1]).toMatchObject({ level: 'Unknown' });
    });
  });
});
