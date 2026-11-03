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

import { ServiceValidationError } from '../errors';
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

/** The range's pairs, as the filter-options statement reads them: one carrying every value the specs filter by. */
const OPTIONS_ROWS = [
  {
    FOUNDATION_ID: 'f-1',
    FOUNDATION_NAME: 'Foundation One',
    PROJECT_ID: 'p-1',
    PROJECT_NAME: 'Project One',
    COURSE_NAME: 'Course A',
    COURSE_LEVEL: 'Beginner',
    COURSE_FORMAT: 'E-Learning',
  },
];

function mockGroups(optionRows: Record<string, unknown>[] = []): void {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT DISTINCT FOUNDATION_ID')) return { rows: optionRows };
    return { rows: sql.includes('AS GROUP_KEY') ? GROUP_ROWS : [TOTALS] };
  });
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

    const options = await service.getFilterOptions(ACCOUNT, '90d', 'org-grant');

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

    const response = await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

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

    const response = await service.getGroups(
      REQ,
      ACCOUNT,
      QUERY,
      {
        groupBy: 'course',
        tab: 'certifications',
        searchQuery: 'course a',
        pageSize: 1,
        offset: 0,
      },
      'org-grant'
    );

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

    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'foundation', tab: 'trainings' }, 'org-grant');

    for (const [sql] of execute.mock.calls as [string][]) expect(sql).toContain("WHERE COALESCE(PRODUCT_TYPE, '') <> 'Certification'");
  });

  it('sorts and pages in memory over the cached set', async () => {
    mockGroups();

    const response = await service.getGroups(
      REQ,
      ACCOUNT,
      QUERY,
      {
        groupBy: 'course',
        tab: 'certifications',
        sortField: 'label',
        sortOrder: 'ASC',
        pageSize: 2,
        offset: 1,
      },
      'org-grant'
    );

    expect(response.data.map((row) => row.label)).toEqual(['Course B', 'No course name']);
    expect(response.total).toBe(3);
  });

  it('binds filters, and caches the full set per filter signature, group-by and tab', async () => {
    mockGroups();
    const query = { ...QUERY, level: 'Beginner' };
    mockGroups(OPTIONS_ROWS);

    await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'level', tab: 'trainings' }, 'org-grant');

    const rowsCall = execute.mock.calls.find(([sql]) => (sql as string).includes('AS GROUP_KEY'))!;
    expect(rowsCall[1]).toEqual([ACCOUNT, 'Beginner']);
    const keys = withOrgCache.mock.calls.map(([, key]) => key);
    expect(keys).toContain(`training-groups:v1:${orgTrainingFiltersSignature(query)}:level:trainings`);
    expect(keys).not.toContain(`training-groups:v1:${orgTrainingFiltersSignature(QUERY)}:level:trainings`);
  });
});

describe('OrgLensTrainingService — group drawer', () => {
  /** The table's groups (Course A, and the none group) plus the drawer's own count and names statements. */
  function mockDrawer(
    count: { TOTAL: number; GROUP_LABEL: string | null },
    names: Record<string, unknown>[],
    optionRows: Record<string, unknown>[] = []
  ): void {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT FOUNDATION_ID')) return { rows: optionRows };
      if (sql.includes('AS GROUP_KEY')) return { rows: GROUP_ROWS };
      if (sql.includes('COUNT(*) AS TOTAL')) return { rows: [count] };
      if (sql.includes('CONTACT_ID')) return { rows: names };
      return { rows: [TOTALS] };
    });
  }
  const drawerCalls = (): [string, string[]][] =>
    (execute.mock.calls as [string, string[]][]).filter(([sql]) => sql.includes('COUNT(*) AS TOTAL') || sql.includes('CONTACT_ID'));

  it('counts pairs and lists current employees of the cell, binding the group value', async () => {
    mockDrawer({ TOTAL: 7, GROUP_LABEL: 'Course A' }, [{ CONTACT_ID: 'k-1', NAME: 'Person One', JOB_TITLE: null }]);

    const response = await service.getGroupEmployees(
      REQ,
      ACCOUNT,
      QUERY,
      { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
      'org-grant'
    );

    expect(response).toMatchObject({ groupBy: 'course', groupValue: 'Course A', label: 'Course A', total: 7, status: 'completed' });
    expect(response.data).toEqual([{ contactId: 'k-1', name: 'Person One', jobTitle: null }]);
    const [[countSql, countBinds], [namesSql, namesBinds]] = drawerCalls();
    expect(countSql).toContain("COALESCE(COURSE_NAME, '') = ?");
    expect(countSql).toContain('IS_CERTIFIED');
    expect(countBinds).toEqual([ACCOUNT, 'Course A']);
    expect(namesSql).toContain(`LIMIT ${MAX_ORG_CERT_EMPLOYEES}`);
    expect(namesBinds).toEqual([ACCOUNT, ACCOUNT, 'Course A']);
  });

  it('names the roster from the all-time, all-projects ranges row of current employees, as People › Trainees does', async () => {
    mockDrawer({ TOTAL: 1, GROUP_LABEL: 'Course A' }, []);

    await service.getGroupEmployees(
      REQ,
      ACCOUNT,
      QUERY,
      { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
      'org-grant'
    );

    const [, [namesSql]] = drawerCalls();
    expect(namesSql).toContain('ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES p');
    expect(namesSql).toMatch(/p\.TIME_RANGE = 'all'\s+AND p\.PROJECT_SCOPE = 'all'\s+AND p\.IS_FORMER = FALSE\s+AND p\.PERSON_KEY = f\.PERSON_KEY/);
    // No training query joins the 12-month ORG_PEOPLE_ALL roster: it would drop members the counts include.
    for (const [sql] of execute.mock.calls as [string][]) expect(sql).not.toMatch(/ORG_PEOPLE_ALL\b(?!_RANGES)/);
  });

  it('reads in-progress cells as enrolled pairs and labels the none group', async () => {
    mockDrawer({ TOTAL: 2, GROUP_LABEL: null }, []);

    const response = await service.getGroupEmployees(
      REQ,
      ACCOUNT,
      QUERY,
      { groupBy: 'course', groupValue: '', tab: 'trainings', status: 'in-progress' },
      'org-grant'
    );

    expect(response.label).toBe('No course name');
    expect(response.total).toBe(2);
    expect(drawerCalls()[0][0]).toContain('NOT IS_CERTIFIED');
    const key = withOrgCache.mock.calls.map(([, k]) => k as string).find((k) => k.startsWith('training-group-employees:'))!;
    expect(key).toMatch(/^training-group-employees:v1:[A-Za-z0-9_-]+:course:[A-Za-z0-9_-]+:trainings:in-progress$/);
  });

  it('rejects a group value that is not a group of the table, before any drawer cache key or statement', async () => {
    mockDrawer({ TOTAL: 1, GROUP_LABEL: null }, []);

    await expect(
      service.getGroupEmployees(
        REQ,
        ACCOUNT,
        QUERY,
        { groupBy: 'course', groupValue: "Nope' OR 1=1 --", tab: 'certifications', status: 'completed' },
        'org-grant'
      )
    ).rejects.toBeInstanceOf(ServiceValidationError);

    expect(drawerCalls()).toHaveLength(0);
    expect(withOrgCache.mock.calls.some(([, key]) => (key as string).startsWith('training-group-employees:'))).toBe(false);
  });
});

describe('OrgLensTrainingService — request filter validation', () => {
  const unknownFilters: [string, Partial<OrgTrainingStatsQuery>][] = [
    ['foundation', { foundation: 'f-unknown' }],
    ['project', { project: 'p-unknown' }],
    ['course', { course: 'Unknown course' }],
    ['level', { level: 'Unknown level' }],
    ['format', { format: 'Unknown format' }],
  ];

  it.each(unknownFilters)('rejects an unknown %s with a validation error and never reaches a stats/groups cache key or SQL', async (_name, filter) => {
    mockGroups(OPTIONS_ROWS);
    const query = { ...QUERY, ...filter };

    await expect(service.getTrainingStats(ACCOUNT, query, 'org-grant')).rejects.toBeInstanceOf(ServiceValidationError);
    await expect(service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant')).rejects.toBeInstanceOf(
      ServiceValidationError
    );
    await expect(
      service.getGroupEmployees(REQ, ACCOUNT, query, { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' }, 'org-grant')
    ).rejects.toBeInstanceOf(ServiceValidationError);

    // Only the all-time options were read (their key carries the range, never a filter value); no key or statement holds the value.
    const keys = withOrgCache.mock.calls.map(([, key]) => key as string);
    expect(new Set(keys)).toEqual(new Set(['training-filter-options:v1:all']));
    for (const [sql, binds] of execute.mock.calls as [string, unknown[]][]) {
      expect(sql).toContain('SELECT DISTINCT FOUNDATION_ID');
      expect(binds).toEqual([ACCOUNT]);
    }
  });

  it('names the request parameter in the error, `trainingProject` for the project', async () => {
    mockGroups(OPTIONS_ROWS);

    const error = await service.getTrainingStats(ACCOUNT, { ...QUERY, project: 'p-unknown' }, 'org-grant').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(JSON.stringify((error as ServiceValidationError).toResponse())).toContain('trainingProject');
  });

  it('accepts every option of the range and keeps a validated filter in the cache key', async () => {
    mockGroups(OPTIONS_ROWS);
    const query: OrgTrainingStatsQuery = { range: '730d', foundation: 'f-1', project: 'p-1', course: 'Course A', level: 'Beginner', format: 'E-Learning' };

    await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(withOrgCache.mock.calls.map(([, key]) => key)).toContain(`training-groups:v1:${orgTrainingFiltersSignature(query)}:course:certifications`);
  });

  it('validates against the all-time options, so a valid value with no rows in the selected range is not a 400', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT FOUNDATION_ID')) return { rows: /DATEADD/.test(sql) ? [] : OPTIONS_ROWS };
      return { rows: sql.includes('AS GROUP_KEY') ? [] : [{ PEOPLE: 0, COURSES_TAKEN: 0, COMPLETED: 0, IN_PROGRESS: 0 }] };
    });
    const query: OrgTrainingStatsQuery = { ...QUERY, range: '30d', level: 'Beginner' };

    const response = await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(response.data).toEqual([]);
    expect(withOrgCache.mock.calls.map(([, key]) => key)).toContain('training-filter-options:v1:all');
    expect(withOrgCache.mock.calls.map(([, key]) => key)).not.toContain('training-filter-options:v1:30d');
  });

  it('reads no options when no filter is set', async () => {
    mockGroups();

    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(withOrgCache.mock.calls.map(([, key]) => key as string).some((key) => key.startsWith('training-filter-options'))).toBe(false);
  });
});

describe('OrgLensTrainingService — access qualification and the shared caches', () => {
  it('serves an auditor-entitlement caller directly: nothing is read from or stored in the shared cache', async () => {
    mockGroups(OPTIONS_ROWS);
    const query = { ...QUERY, level: 'Beginner' };

    await service.getFilterOptions(ACCOUNT, '730d', 'auditor-entitlement');
    await service.getTrainingStats(ACCOUNT, query, 'auditor-entitlement');
    await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'auditor-entitlement');
    await service.getGroupEmployees(
      REQ,
      ACCOUNT,
      query,
      { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
      'auditor-entitlement'
    );

    expect(withOrgCache).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it('serves an org-grant caller through the shared cache', async () => {
    mockGroups(OPTIONS_ROWS);

    await service.getFilterOptions(ACCOUNT, '730d', 'org-grant');
    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(withOrgCache).toHaveBeenCalledTimes(2);
  });
});
