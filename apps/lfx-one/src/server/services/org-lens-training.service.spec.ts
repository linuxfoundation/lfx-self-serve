// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_ORG_CERT_EMPLOYEES } from '@lfx-one/shared/constants';
import type { OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, withOrgCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withOrgCache: vi.fn(),
}));

// The service and this spec import `@lfx-one/shared/utils`, whose barrel pulls Angular; only the view-state and range utils are needed.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-training-view-state.utils')),
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn() } }));

import { orgTrainingFiltersSignature } from '../../../../../packages/shared/src/utils/org-training-view-state.utils';
import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensTrainingService } from './org-lens-training.service';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
const REQ = {} as Request;
const QUERY: OrgTrainingStatsQuery = { range: '730d', foundation: null, project: null, course: null, level: null, format: null };

const GROUP_ROWS = [
  {
    GROUP_KEY: 'Course A',
    GROUP_LABEL: 'Course A',
    PEOPLE: 4,
    COURSES_TAKEN: 6,
    COMPLETED: 3,
    IN_PROGRESS: 3,
    LEVEL: 'Beginner',
    FOUNDATION: 'Foundation One',
  },
  { GROUP_KEY: 'Course B', GROUP_LABEL: 'Course B', PEOPLE: 2, COURSES_TAKEN: 2, COMPLETED: 2, IN_PROGRESS: 0, LEVEL: null, FOUNDATION: null },
  { GROUP_KEY: '', GROUP_LABEL: null, PEOPLE: 1, COURSES_TAKEN: 1, COMPLETED: 0, IN_PROGRESS: 1, LEVEL: null, FOUNDATION: null },
];
const TOTALS = { PEOPLE: 6, COURSES_TAKEN: 9, COMPLETED: 5, IN_PROGRESS: 4 };

function mockGroups(): void {
  execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('AS GROUP_KEY') ? GROUP_ROWS : [TOTALS] }));
}

let service: OrgLensTrainingService;

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ rows: [] });
  withOrgCache.mockImplementation(async (_account: string, _key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
  service = new OrgLensTrainingService();
});

describe('OrgLensTrainingService — filter options', () => {
  it('builds sorted options from the unfiltered pairs of the range and caches per range', async () => {
    execute.mockResolvedValue({
      rows: [
        {
          FOUNDATION_ID: 'f-2',
          FOUNDATION_NAME: 'Zeta',
          PROJECT_ID: 'p-1',
          PROJECT_NAME: 'Proj',
          COURSE_NAME: 'B course',
          COURSE_LEVEL: 'Beginner',
          COURSE_FORMAT: null,
        },
        {
          FOUNDATION_ID: 'f-1',
          FOUNDATION_NAME: 'Alpha',
          PROJECT_ID: null,
          PROJECT_NAME: null,
          COURSE_NAME: 'A course',
          COURSE_LEVEL: null,
          COURSE_FORMAT: 'E-Learning',
        },
      ],
    });

    const options = await service.getFilterOptions(ACCOUNT, '90d');

    expect(options.foundations).toEqual([
      { label: 'Alpha', value: 'f-1' },
      { label: 'Zeta', value: 'f-2' },
    ]);
    expect(options.courses.map((o) => o.value)).toEqual(['A course', 'B course']);
    expect(options.levels).toEqual([{ label: 'Beginner', value: 'Beginner' }]);
    expect(options.formats).toEqual([{ label: 'E-Learning', value: 'E-Learning' }]);
    expect(withOrgCache.mock.calls[0][1]).toBe('training-filter-options:v1:90d');
    expect(execute.mock.calls[0][1]).toEqual([ACCOUNT]);
    expect(execute.mock.calls[0][0]).toContain('DATEADD(day, -90, CURRENT_DATE())');
  });
});

describe('OrgLensTrainingService — group-by table', () => {
  it('maps rows, labels the none group, and defaults to completed descending', async () => {
    mockGroups();

    const response = await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' });

    expect(response.data.map((row) => row.key)).toEqual(['Course A', 'Course B', '']);
    expect(response.data.find((row) => row.key === '')?.label).toBe('No course name');
    expect(response.data.find((row) => row.key === 'Course A')).toMatchObject({
      level: 'Beginner',
      foundation: 'Foundation One',
      logoUrl: null,
      completed: 3,
      inProgress: 3,
    });
    expect(response.total).toBe(3);
  });

  it('returns totals over the whole tab set that equal the stat tiles, whatever the search and page', async () => {
    mockGroups();

    const response = await service.getGroups(REQ, ACCOUNT, QUERY, {
      groupBy: 'course',
      tab: 'certifications',
      searchQuery: 'course a',
      pageSize: 1,
      offset: 0,
    });

    expect(response.data.map((row) => row.key)).toEqual(['Course A']);
    expect(response.total).toBe(1);
    expect(response.totals).toEqual({ people: 6, coursesTaken: 9, completed: 5, inProgress: 4 });
    // Totals and rows read the same filtered pairs and the same tab predicate as the stats' split.
    const sqls = execute.mock.calls.map(([sql]) => sql as string);
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) expect(sql).toContain("WHERE PRODUCT_TYPE = 'Certification'");
  });

  it('splits the trainings tab by the complement of the certification product type', async () => {
    mockGroups();

    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'foundation', tab: 'trainings' });

    for (const [sql] of execute.mock.calls as [string][]) expect(sql).toContain("WHERE COALESCE(PRODUCT_TYPE, '') <> 'Certification'");
  });

  it('sorts and pages in memory over the cached set', async () => {
    mockGroups();

    const response = await service.getGroups(REQ, ACCOUNT, QUERY, {
      groupBy: 'course',
      tab: 'certifications',
      sortField: 'label',
      sortOrder: 'ASC',
      pageSize: 2,
      offset: 1,
    });

    expect(response.data.map((row) => row.label)).toEqual(['Course B', 'No course name']);
    expect(response.total).toBe(3);
  });

  it('binds filters, and caches the full set per filter signature, group-by and tab', async () => {
    mockGroups();
    const query = { ...QUERY, level: 'Beginner' };

    await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'level', tab: 'trainings' });

    expect(execute.mock.calls[0][1]).toEqual([ACCOUNT, 'Beginner']);
    expect(withOrgCache.mock.calls[0][1]).toBe(`training-groups:v1:${orgTrainingFiltersSignature(query)}:level:trainings`);
    expect(withOrgCache.mock.calls[0][1]).not.toBe(`training-groups:v1:${orgTrainingFiltersSignature(QUERY)}:level:trainings`);
  });
});

describe('OrgLensTrainingService — group drawer', () => {
  it('counts pairs and lists current employees of the cell, binding the group value', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) AS TOTAL')) return { rows: [{ TOTAL: 7, GROUP_LABEL: 'Course A' }] };
      return { rows: [{ CONTACT_ID: 'k-1', NAME: 'Person One', JOB_TITLE: null }] };
    });

    const response = await service.getGroupEmployees(REQ, ACCOUNT, QUERY, {
      groupBy: 'course',
      groupValue: 'Course A',
      tab: 'certifications',
      status: 'completed',
    });

    expect(response).toMatchObject({ groupBy: 'course', groupValue: 'Course A', label: 'Course A', total: 7, status: 'completed' });
    expect(response.data).toEqual([{ contactId: 'k-1', name: 'Person One', jobTitle: null }]);
    const [countSql, countBinds] = execute.mock.calls[0] as [string, string[]];
    expect(countSql).toContain("COALESCE(COURSE_NAME, '') = ?");
    expect(countSql).toContain('IS_CERTIFIED');
    expect(countBinds).toEqual([ACCOUNT, 'Course A']);
    const [namesSql, namesBinds] = execute.mock.calls[1] as [string, string[]];
    expect(namesSql).toContain('ORG_PEOPLE_ALL');
    expect(namesSql).toContain(`LIMIT ${MAX_ORG_CERT_EMPLOYEES}`);
    expect(namesBinds).toEqual([ACCOUNT, ACCOUNT, 'Course A']);
  });

  it('reads in-progress cells as enrolled pairs and labels the none group', async () => {
    execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('COUNT(*) AS TOTAL') ? [{ TOTAL: 2, GROUP_LABEL: null }] : [] }));

    const response = await service.getGroupEmployees(REQ, ACCOUNT, QUERY, { groupBy: 'format', groupValue: '', tab: 'trainings', status: 'in-progress' });

    expect(response.label).toBe('No format');
    expect(response.total).toBe(2);
    expect((execute.mock.calls[0] as [string])[0]).toContain('NOT IS_CERTIFIED');
    expect(withOrgCache.mock.calls[0][1]).toMatch(/^training-group-employees:v1:[A-Za-z0-9_-]+:format:[A-Za-z0-9_-]+:trainings:in-progress$/);
  });
});
