// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTrainingStats, getFilterOptions, getGroups, getGroupEmployees, logger } = vi.hoisted(() => ({
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
    getTrainingStats.mockResolvedValue({ rosterMembers: null, peopleWithTrainingActivity: 0, coursesTaken: 0 });
    getFilterOptions.mockResolvedValue({ courses: [] });
    getGroups.mockResolvedValue({ data: [], total: 0, totals: {} });
    getGroupEmployees.mockResolvedValue({ total: 0 });
  });

  it('stats: parses range and filters like the URL util, defaulting an unknown range and trimming blanks', async () => {
    const next = vi.fn();

    await controller.getTrainingStats(buildReq({ range: 'bogus', foundation: ' f-1 ', course: '', level: 'Beginner' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getTrainingStats).toHaveBeenCalledWith(ORG_UID, { range: '730d', foundation: 'f-1', project: null, course: null, level: 'Beginner', format: null });
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

    expect(getFilterOptions).toHaveBeenCalledWith(ORG_UID, '90d');
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
});
