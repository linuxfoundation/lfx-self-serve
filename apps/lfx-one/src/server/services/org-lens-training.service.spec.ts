// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_ORG_TRAINING_GROUP_EMPLOYEES, MAX_ORG_TRAINING_FILTER_VALUE_LENGTH } from '@lfx-one/shared/constants';
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

/** The distinct raw values of the all-time rows, as the known-values statement reads them: every value the specs filter by. */
const KNOWN_ROWS = [
  { FILTER_KEY: 'foundation', FILTER_VALUE: 'f-1' },
  { FILTER_KEY: 'project', FILTER_VALUE: 'p-1' },
  { FILTER_KEY: 'course', FILTER_VALUE: 'Course A' },
  { FILTER_KEY: 'level', FILTER_VALUE: 'Beginner' },
  { FILTER_KEY: 'format', FILTER_VALUE: 'E-Learning' },
];

const isKnownValuesSql = (sql: string): boolean => sql.includes('AS FILTER_KEY');

function mockGroups(knownRows: Record<string, unknown>[] = []): void {
  execute.mockImplementation(async (sql: string) => {
    if (isKnownValuesSql(sql)) return { rows: knownRows };
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

describe('OrgLensTrainingService — filter option values', () => {
  it('normalizes option values like a URL value: trimmed, capped at the filter value length, merged and never blank', async () => {
    const longName = 'L'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH + 50);
    const row = (overrides: Record<string, unknown>): Record<string, unknown> => ({
      FOUNDATION_ID: null,
      FOUNDATION_NAME: null,
      PROJECT_ID: null,
      PROJECT_NAME: null,
      COURSE_NAME: null,
      COURSE_LEVEL: null,
      COURSE_FORMAT: null,
      ...overrides,
    });
    execute.mockResolvedValue({
      rows: [
        row({ COURSE_NAME: '  Course A  ', COURSE_LEVEL: ' Beginner', COURSE_FORMAT: '   ' }),
        row({ COURSE_NAME: 'Course A', COURSE_LEVEL: 'Beginner' }),
        // Spaces only, as the SQL TRIM: a tab is part of the value in both.
        row({ COURSE_NAME: '\tTabbed' }),
        row({ COURSE_NAME: longName, FOUNDATION_ID: ' f-1 ', FOUNDATION_NAME: 'Foundation One' }),
        // A space lands on the cut: the offered value is trimmed again, so requesting it matches the pair.
        row({ COURSE_NAME: `${'x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH - 1)} suffix` }),
      ],
    });

    const options = await service.getFilterOptions(ACCOUNT, '730d', 'org-grant');

    expect(options.courses.map((o) => o.value)).toEqual([
      '\tTabbed',
      'Course A',
      longName.slice(0, MAX_ORG_TRAINING_FILTER_VALUE_LENGTH),
      'x'.repeat(MAX_ORG_TRAINING_FILTER_VALUE_LENGTH - 1),
    ]);
    expect(options.levels).toEqual([{ label: 'Beginner', value: 'Beginner' }]);
    expect(options.formats).toEqual([]);
    expect(options.foundations).toEqual([{ label: 'Foundation One', value: 'f-1' }]);
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

  it('reads only people-list rows: every statement resolves its pairs from the people-list CTE and none counts outside rows', async () => {
    mockGroups();

    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    const sqls = execute.mock.calls.map(([sql]) => sql as string);
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) {
      expect(sql).toContain('AND IS_ON_PEOPLE_LIST');
      expect(sql).not.toContain('NOT IS_ON_PEOPLE_LIST');
      expect(sql).toMatch(/FROM f\s+WHERE/);
    }
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
    mockGroups(KNOWN_ROWS);

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
  function mockDrawer(count: { TOTAL: number; GROUP_LABEL: string | null }, names: Record<string, unknown>[], knownRows: Record<string, unknown>[] = []): void {
    execute.mockImplementation(async (sql: string) => {
      if (isKnownValuesSql(sql)) return { rows: knownRows };
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
    expect(namesSql).toContain(`LIMIT ${MAX_ORG_TRAINING_GROUP_EMPLOYEES}`);
    expect(namesBinds).toEqual([ACCOUNT, ACCOUNT, 'Course A']);
  });

  it('keeps the drawer on people-list rows: no statement reads outside rows', async () => {
    mockDrawer({ TOTAL: 1, GROUP_LABEL: 'Course A' }, []);

    await service.getGroupEmployees(
      REQ,
      ACCOUNT,
      QUERY,
      { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
      'org-grant'
    );

    const [[countSql], [namesSql]] = drawerCalls();
    for (const sql of [countSql, namesSql]) {
      expect(sql).toContain('AND IS_ON_PEOPLE_LIST');
      expect(sql).not.toContain('NOT IS_ON_PEOPLE_LIST');
    }
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

describe('OrgLensTrainingService — a filter value the organization never carries', () => {
  const unknownFilters: [string, Partial<OrgTrainingStatsQuery>][] = [
    ['foundation', { foundation: 'f-unknown' }],
    ['project', { project: 'p-unknown' }],
    ['course', { course: 'Unknown course' }],
    ['level', { level: 'Unknown level' }],
    ['format', { format: 'Unknown format' }],
  ];
  const ZERO_TOTALS = { people: 0, coursesTaken: 0, completed: 0, inProgress: 0 };

  /** Known values, groups, and the live roster row (null: the org has no LF Education client). */
  function mockUnknownFilterWarehouse(roster: Record<string, unknown> | null, asOf: string | null = '2026-10-30T09:48:21.094Z'): void {
    execute.mockImplementation(async (sql: string) => {
      if (isKnownValuesSql(sql)) return { rows: KNOWN_ROWS };
      if (sql.includes('MAX(DBT_RUN_AT)')) return { rows: [{ AS_OF: asOf }] };
      if (sql.includes('ORG_TRAINING_ROSTER_MEMBERS')) return { rows: roster ? [roster] : [] };
      if (sql.includes('AS GROUP_KEY')) return { rows: GROUP_ROWS };
      return { rows: [] };
    });
  }

  it.each(unknownFilters)(
    'answers an unknown %s with zero payloads, never an error, and reaches no stats/groups cache key or statement',
    async (_name, filter) => {
      mockUnknownFilterWarehouse({ ROSTER_MEMBERS: 40, AS_OF_TS: '2026-10-29T23:00:00.000Z' });
      const query = { ...QUERY, ...filter };

      const stats = await service.getTrainingStats(ACCOUNT, query, 'org-grant');
      const groups = await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');
      const drawer = await service.getGroupEmployees(
        REQ,
        ACCOUNT,
        query,
        { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
        'org-grant'
      );

      expect(stats).toEqual({
        range: '730d',
        asOf: '2026-10-30T09:48:21.094Z',
        rosterMembers: 40,
        rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
        peopleWithTrainingActivity: 0,
        learnersOutsidePeopleList: null,
        coursesTaken: 0,
        certifications: 0,
        certifiedPeople: 0,
        trainingsCompleted: 0,
        completionRatePct: 0,
        coursesInProgress: 0,
        peopleInTraining: 0,
      });
      expect(groups).toEqual({ data: [], total: 0, totals: ZERO_TOTALS });
      expect(drawer).toEqual({
        groupBy: 'course',
        groupValue: 'Course A',
        label: 'No course name',
        tab: 'certifications',
        status: 'completed',
        total: 0,
        data: [],
      });

      // Only the known-values entry and the unfiltered stats entry (the roster's) were read; no key or statement holds the unknown value.
      const keys = withOrgCache.mock.calls.map(([, key]) => key as string);
      expect(new Set(keys)).toEqual(new Set(['training-filter-known:v1', `training-stats:v6:${orgTrainingFiltersSignature(QUERY)}`]));
      for (const [sql, binds] of execute.mock.calls as [string, unknown[]][]) {
        expect(binds).not.toContain(Object.values(filter)[0]);
        expect(sql.includes('AS GROUP_KEY')).toBe(false);
      }
    }
  );

  it('keeps a null roster for an unknown filter on an org without a roster row', async () => {
    mockUnknownFilterWarehouse(null);

    const stats = await service.getTrainingStats(ACCOUNT, { ...QUERY, level: 'Unknown level' }, 'org-grant');

    expect(stats.rosterMembers).toBeNull();
    expect(stats.rosterMembersAsOf).toBeNull();
    expect(stats.asOf).toBe('2026-10-30T09:48:21.094Z');
    expect(stats.coursesTaken).toBe(0);
  });

  it('carries the unfiltered as-of into the zero payload, and keeps it null only when the unfiltered read has none', async () => {
    mockUnknownFilterWarehouse({ ROSTER_MEMBERS: 40, AS_OF_TS: '2026-10-29T23:00:00.000Z' }, '2026-11-02T08:00:00.000Z');
    const withAsOf = await service.getTrainingStats(ACCOUNT, { ...QUERY, level: 'Unknown level' }, 'org-grant');
    expect(withAsOf.asOf).toBe('2026-11-02T08:00:00.000Z');
    expect(withAsOf.coursesTaken).toBe(0);

    withOrgCache.mockClear();
    mockUnknownFilterWarehouse({ ROSTER_MEMBERS: 40, AS_OF_TS: '2026-10-29T23:00:00.000Z' }, null);
    const withoutAsOf = await service.getTrainingStats(ACCOUNT, { ...QUERY, level: 'Unknown level' }, 'org-grant');
    expect(withoutAsOf.asOf).toBeNull();
  });

  it('does not share the zero groups payload between responses', async () => {
    mockGroups(KNOWN_ROWS);
    const query = { ...QUERY, level: 'Unknown level' };

    const first = await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');
    first.totals.people = 99;
    first.data.push({ key: 'x', label: 'x', people: 1, coursesTaken: 1, completed: 1, inProgress: 0, level: null, foundation: null, logoUrl: null });
    const second = await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(second).toEqual({ data: [], total: 0, totals: ZERO_TOTALS });
  });

  it('serves an auditor-entitlement caller the same zeros without touching the shared cache', async () => {
    mockUnknownFilterWarehouse({ ROSTER_MEMBERS: 40, AS_OF_TS: '2026-10-29T23:00:00.000Z' });

    const stats = await service.getTrainingStats(ACCOUNT, { ...QUERY, course: 'Unknown course' }, 'auditor-entitlement');

    expect(stats.coursesTaken).toBe(0);
    expect(stats.rosterMembers).toBe(40);
    expect(withOrgCache).not.toHaveBeenCalled();
  });

  it('accepts every known value and keeps it in the cache key', async () => {
    mockGroups(KNOWN_ROWS);
    const query: OrgTrainingStatsQuery = { range: '730d', foundation: 'f-1', project: 'p-1', course: 'Course A', level: 'Beginner', format: 'E-Learning' };

    await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(withOrgCache.mock.calls.map(([, key]) => key)).toContain(`training-groups:v1:${orgTrainingFiltersSignature(query)}:course:certifications`);
  });

  it('compares a request value with the known values the way the URL normalizes it (trimmed), so a padded warehouse value is not unknown', async () => {
    mockGroups([{ FILTER_KEY: 'course', FILTER_VALUE: '  Course A  ' }]);

    const groups = await service.getGroups(REQ, ACCOUNT, { ...QUERY, course: 'Course A' }, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(groups.data.length).toBeGreaterThan(0);
  });

  it('reads the known values from the raw rows of all time, not from resolved pairs or a range', async () => {
    mockGroups(KNOWN_ROWS);

    await service.getTrainingStats(ACCOUNT, { ...QUERY, range: '30d', level: 'Beginner' }, 'org-grant');

    const knownCall = (execute.mock.calls as [string, unknown[]][]).find(([sql]) => isKnownValuesSql(sql))!;
    expect(knownCall[0]).toContain('FROM rows_in_range');
    expect(knownCall[0]).not.toMatch(/FROM f\b/);
    expect(knownCall[0]).not.toContain('DATEADD');
    expect(knownCall[1]).toEqual([ACCOUNT]);
  });

  it('serves data, not zeros, for a value some raw row carries even when the pair resolves to another value all-time (30d Beginner, all-time Intermediate)', async () => {
    // The dropdown of the 30d range offers `Beginner` (an in-range row says so); the all-time pair resolves to `Intermediate`.
    // The known set holds the raw row values, so it still contains `Beginner`.
    execute.mockImplementation(async (sql: string) => {
      if (isKnownValuesSql(sql)) {
        return {
          rows: [
            { FILTER_KEY: 'level', FILTER_VALUE: 'Beginner' },
            { FILTER_KEY: 'level', FILTER_VALUE: 'Intermediate' },
          ],
        };
      }
      if (sql.includes('AS COURSES_IN_PROGRESS')) {
        return {
          rows: [
            { PEOPLE: 2, COURSES_TAKEN: 3, CERTIFICATIONS: 1, CERTIFIED_PEOPLE: 1, TRAININGS_COMPLETED: 1, COURSES_IN_PROGRESS: 1, PEOPLE_IN_TRAINING: 1 },
          ],
        };
      }
      return { rows: [] };
    });

    const stats = await service.getTrainingStats(ACCOUNT, { ...QUERY, range: '30d', level: 'Beginner' }, 'org-grant');

    expect(stats).toMatchObject({ range: '30d', peopleWithTrainingActivity: 2, coursesTaken: 3 });
  });

  describe('a tab-prefixed value is one legal value on every path', () => {
    const TABBED = '\tTabbed';
    const TABBED_GROUP = { GROUP_KEY: TABBED, GROUP_LABEL: TABBED, PEOPLE: 2, COURSES_TAKEN: 3, COMPLETED: 1, IN_PROGRESS: 2, LEVEL: null, FOUNDATION: null };
    const STATS_ROW = {
      PEOPLE: 2,
      COURSES_TAKEN: 3,
      CERTIFICATIONS: 1,
      CERTIFIED_PEOPLE: 1,
      TRAININGS_COMPLETED: 0,
      COURSES_IN_PROGRESS: 2,
      PEOPLE_IN_TRAINING: 2,
    };

    function mockTabbedWarehouse(): void {
      execute.mockImplementation(async (sql: string) => {
        if (isKnownValuesSql(sql)) return { rows: [{ FILTER_KEY: 'course', FILTER_VALUE: TABBED }] };
        if (sql.includes('AS COURSES_IN_PROGRESS')) return { rows: [STATS_ROW] };
        if (sql.includes('AS GROUP_KEY')) return { rows: [TABBED_GROUP] };
        if (sql.includes('COUNT(*) AS TOTAL')) return { rows: [{ TOTAL: 1, GROUP_LABEL: TABBED }] };
        if (sql.includes('CONTACT_ID')) return { rows: [{ CONTACT_ID: 'k-1', NAME: 'Person One', JOB_TITLE: null }] };
        return { rows: [TOTALS] };
      });
    }
    const query = { ...QUERY, course: TABBED };

    it('serves stats, groups and the drawer for it, not zero payloads', async () => {
      mockTabbedWarehouse();

      const stats = await service.getTrainingStats(ACCOUNT, query, 'org-grant');
      const groups = await service.getGroups(REQ, ACCOUNT, query, { groupBy: 'course', tab: 'certifications' }, 'org-grant');
      const drawer = await service.getGroupEmployees(
        REQ,
        ACCOUNT,
        query,
        { groupBy: 'course', groupValue: TABBED, tab: 'certifications', status: 'completed' },
        'org-grant'
      );

      expect(stats).toMatchObject({ coursesTaken: 3, peopleWithTrainingActivity: 2 });
      expect(groups.data.map((row) => row.key)).toEqual([TABBED]);
      expect(drawer).toMatchObject({ groupValue: TABBED, total: 1 });
      expect(drawer.data).toHaveLength(1);
    });

    it('never offers a value holding another control character, so every offered option can be requested', async () => {
      const rows = [
        { FILTER_KEY: 'course', FILTER_VALUE: TABBED },
        { FILTER_KEY: 'course', FILTER_VALUE: 'Line\nBreak' },
      ];
      execute.mockImplementation(async (sql: string) =>
        isKnownValuesSql(sql) ? { rows } : { rows: sql.includes('AS COURSES_IN_PROGRESS') ? [STATS_ROW] : [TOTALS] }
      );

      const tabbed = await service.getTrainingStats(ACCOUNT, query, 'org-grant');
      const broken = await service.getTrainingStats(ACCOUNT, { ...QUERY, course: 'Line\nBreak' }, 'org-grant');

      expect(tabbed.coursesTaken).toBe(3);
      expect(broken.coursesTaken).toBe(0);
    });
  });

  it('reads no known values when no filter is set', async () => {
    mockGroups();

    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(withOrgCache.mock.calls.map(([, key]) => key as string).some((key) => key.startsWith('training-filter-known'))).toBe(false);
  });

  it('still rejects a group value that is not a group of the table', async () => {
    mockGroups(KNOWN_ROWS);

    const error = await service
      .getGroupEmployees(
        REQ,
        ACCOUNT,
        { ...QUERY, level: 'Beginner' },
        { groupBy: 'course', groupValue: 'Nope', tab: 'certifications', status: 'completed' },
        'org-grant'
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(JSON.stringify((error as ServiceValidationError).toResponse())).toContain('groupValue is not a group of this table');
  });
});

describe('OrgLensTrainingService — a filter valid for the organization but with no rows in the selected range', () => {
  const NO_ROWS_RANGE = '30d' as const;
  const ZERO_TOTALS = { PEOPLE: 0, COURSES_TAKEN: 0, COMPLETED: 0, IN_PROGRESS: 0 };
  const validFilters: [string, Partial<OrgTrainingStatsQuery>][] = [
    ['foundation', { foundation: 'f-1' }],
    ['project', { project: 'p-1' }],
    ['course', { course: 'Course A' }],
    ['level', { level: 'Beginner' }],
    ['format', { format: 'E-Learning' }],
  ];

  /**
   * The known values carry every value of KNOWN_ROWS; every range-limited statement (a DATEADD window) finds no pair:
   * aggregates answer one zero row and the grouped statement answers no row, as the warehouse does.
   */
  function mockNoRowsInRange(): void {
    execute.mockImplementation(async (sql: string) => {
      if (isKnownValuesSql(sql)) return { rows: KNOWN_ROWS };
      if (sql.includes('AS GROUP_KEY')) return { rows: [] };
      if (sql.includes('AS COURSES_IN_PROGRESS')) {
        return {
          rows: [
            { PEOPLE: 0, COURSES_TAKEN: 0, CERTIFICATIONS: 0, CERTIFIED_PEOPLE: 0, TRAININGS_COMPLETED: 0, COURSES_IN_PROGRESS: 0, PEOPLE_IN_TRAINING: 0 },
          ],
        };
      }
      if (sql.includes('COUNT(*) AS TOTAL')) return { rows: [{ TOTAL: 0, GROUP_LABEL: null }] };
      if (sql.includes('COUNT(DISTINCT PERSON_KEY) AS PEOPLE') && !sql.includes('AS COURSES_TAKEN')) return { rows: [{ PEOPLE: 0 }] };
      if (sql.includes('AS COURSES_TAKEN')) return { rows: [ZERO_TOTALS] };
      return { rows: [] };
    });
  }

  const rangeQuery = (filter: Partial<OrgTrainingStatsQuery>): OrgTrainingStatsQuery => ({ ...QUERY, range: NO_ROWS_RANGE, ...filter });

  it.each(validFilters)('stats: serves zeros with a normal payload for a known %s with no rows in range, not a 400', async (_name, filter) => {
    mockNoRowsInRange();

    const stats = await service.getTrainingStats(ACCOUNT, rangeQuery(filter), 'org-grant');

    expect(stats).toMatchObject({
      range: NO_ROWS_RANGE,
      peopleWithTrainingActivity: 0,
      learnersOutsidePeopleList: null,
      coursesTaken: 0,
      certifications: 0,
      certifiedPeople: 0,
      trainingsCompleted: 0,
      completionRatePct: 0,
      coursesInProgress: 0,
      peopleInTraining: 0,
    });
  });

  it.each(validFilters)('groups: serves an empty table with zero totals for a known %s with no rows in range, not a 400', async (_name, filter) => {
    mockNoRowsInRange();

    for (const tab of ['certifications', 'trainings'] as const) {
      const response = await service.getGroups(REQ, ACCOUNT, rangeQuery(filter), { groupBy: 'course', tab }, 'org-grant');

      expect(response).toEqual({ data: [], total: 0, totals: { people: 0, coursesTaken: 0, completed: 0, inProgress: 0 } });
    }
  });

  it.each(validFilters)(
    'group employees: a known %s with no rows in range passes the filter check; the (absent) group is what the 400 names, never the filter',
    async (_name, filter) => {
      mockNoRowsInRange();

      const error = await service
        .getGroupEmployees(
          REQ,
          ACCOUNT,
          rangeQuery(filter),
          { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
          'org-grant'
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceValidationError);
      const body = JSON.stringify((error as ServiceValidationError).toResponse());
      expect(body).toContain('groupValue is not a group of this table');
      expect(body).not.toContain('is not an option');
    }
  );

  it('group employees: serves an empty drawer with a zero total when the group exists but none of its pairs is a current employee', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (isKnownValuesSql(sql)) return { rows: KNOWN_ROWS };
      if (sql.includes('AS GROUP_KEY')) return { rows: GROUP_ROWS };
      if (sql.includes('COUNT(*) AS TOTAL')) return { rows: [{ TOTAL: 0, GROUP_LABEL: null }] };
      if (sql.includes('CONTACT_ID')) return { rows: [] };
      return { rows: [TOTALS] };
    });

    const response = await service.getGroupEmployees(
      REQ,
      ACCOUNT,
      rangeQuery({ level: 'Beginner' }),
      { groupBy: 'course', groupValue: 'Course A', tab: 'certifications', status: 'completed' },
      'org-grant'
    );

    expect(response).toMatchObject({ groupBy: 'course', groupValue: 'Course A', total: 0, data: [] });
  });

  it('still answers an unknown value in the same range with zeros, so only the known values decide', async () => {
    mockNoRowsInRange();

    const stats = await service.getTrainingStats(ACCOUNT, rangeQuery({ level: 'Unknown level' }), 'org-grant');
    const groups = await service.getGroups(REQ, ACCOUNT, rangeQuery({ level: 'Unknown level' }), { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(stats.coursesTaken).toBe(0);
    expect(groups.total).toBe(0);
  });
});

describe('OrgLensTrainingService — access qualification and the shared caches', () => {
  it('serves an auditor-entitlement caller directly: nothing is read from or stored in the shared cache', async () => {
    mockGroups(KNOWN_ROWS);
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
    mockGroups(KNOWN_ROWS);

    await service.getFilterOptions(ACCOUNT, '730d', 'org-grant');
    await service.getGroups(REQ, ACCOUNT, QUERY, { groupBy: 'course', tab: 'certifications' }, 'org-grant');

    expect(withOrgCache).toHaveBeenCalledTimes(2);
  });
});
