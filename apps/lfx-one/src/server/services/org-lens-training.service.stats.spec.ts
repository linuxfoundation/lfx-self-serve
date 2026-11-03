// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange, OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
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
const NO_FILTERS = { foundation: null, project: null, course: null, level: null, format: null };
const QUERY: OrgTrainingStatsQuery = { range: '730d', ...NO_FILTERS };

interface StatsRows {
  pairs?: Record<string, unknown>[];
  outside?: Record<string, unknown>[];
  asOf?: Record<string, unknown>[];
  roster?: Record<string, unknown>[];
}

/** Answers each stats statement by the relation it reads, like Snowflake would for one account. */
function mockStatsRows(rows: StatsRows): void {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('ORG_TRAINING_ROSTER_MEMBERS')) return { rows: rows.roster ?? [] };
    if (sql.includes('AS AS_OF')) return { rows: rows.asOf ?? [] };
    if (sql.includes('NOT IS_ON_PEOPLE_LIST')) return { rows: rows.outside ?? [] };
    return { rows: rows.pairs ?? [] };
  });
}

function pairsCall(): [string, string[]] {
  const call = execute.mock.calls.find(([sql]) => (sql as string).includes('rows_in_range AS'));
  if (!call) throw new Error('no pairs statement');
  return call as [string, string[]];
}

function outsideCalls(): number {
  return execute.mock.calls.filter(([sql]) => (sql as string).includes('NOT IS_ON_PEOPLE_LIST')).length;
}

const PAIR_ROW = {
  PEOPLE: 10,
  COURSES_TAKEN: 20,
  CERTIFICATIONS: 5,
  CERTIFIED_PEOPLE: 4,
  TRAININGS_COMPLETED: 6,
  COURSES_IN_PROGRESS: 9,
  PEOPLE_IN_TRAINING: 7,
};

let service: OrgLensTrainingService;

beforeEach(() => {
  vi.clearAllMocks();
  withOrgCache.mockImplementation(async (_account: string, _key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
  service = new OrgLensTrainingService();
});

describe('OrgLensTrainingService — stats over person-course pairs', () => {
  it('maps the pair counts, roster and as-of, and keeps the identity coursesTaken = certifications + trainingsCompleted + coursesInProgress', async () => {
    mockStatsRows({
      pairs: [PAIR_ROW],
      outside: [{ PEOPLE: 3 }],
      asOf: [{ AS_OF: new Date('2026-10-30T09:48:21.094Z') }],
      roster: [{ ROSTER_MEMBERS: 40, AS_OF_TS: new Date('2026-10-29T23:00:00.000Z') }],
    });

    const stats = await service.getTrainingStats(ACCOUNT, QUERY);

    expect(stats).toEqual({
      range: '730d',
      asOf: '2026-10-30T09:48:21.094Z',
      rosterMembers: 40,
      rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
      peopleWithTrainingActivity: 13,
      learnersOutsidePeopleList: 3,
      coursesTaken: 20,
      certifications: 5,
      certifiedPeople: 4,
      trainingsCompleted: 6,
      completionRatePct: 55,
      coursesInProgress: 9,
      peopleInTraining: 7,
    });
    expect(stats.certifications + stats.trainingsCompleted + stats.coursesInProgress).toBe(stats.coursesTaken);
  });

  it('splits certified pairs by product type and counts in progress as enrolled pairs without a certificate in range', async () => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT, QUERY);

    const [sql] = pairsCall();
    expect(sql).toMatch(/COUNT_IF\(IS_CERTIFIED AND PRODUCT_TYPE = 'Certification'\)\s+AS CERTIFICATIONS/);
    expect(sql).toMatch(/COUNT_IF\(IS_CERTIFIED AND COALESCE\(PRODUCT_TYPE, ''\) <> 'Certification'\)\s+AS TRAININGS_COMPLETED/);
    expect(sql).toMatch(/COUNT_IF\(NOT IS_CERTIFIED\)\s+AS COURSES_IN_PROGRESS/);
    // Certified wins inside the range only: one pair per (person, course), certified when any row in range is a certificate.
    expect(sql).toContain("BOOLOR_AGG(STATUS = 'Certified')");
    expect(sql).toContain('GROUP BY PERSON_KEY, COURSE_KEY');
  });

  it.each([
    ['30d', 30],
    ['90d', 90],
    ['365d', 365],
    ['730d', 730],
  ] as const)('windows ACTIVITY_TS to the last %s', async (range, days) => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT, { ...QUERY, range });

    expect(pairsCall()[0]).toContain(`AND ACTIVITY_TS >= DATEADD(day, -${days}, CURRENT_DATE())`);
  });

  it('applies no date predicate for all time', async () => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT, { ...QUERY, range: 'all' });

    expect(pairsCall()[0]).not.toContain('DATEADD');
  });

  it('binds every filter as a param, never inlined, in a fixed order', async () => {
    mockStatsRows({});
    const hostile = "x' OR 1=1 --";

    await service.getTrainingStats(ACCOUNT, { range: '90d', foundation: 'f-1', project: 'p-1', course: hostile, level: 'Beginner', format: 'E-Learning' });

    const [sql, binds] = pairsCall();
    expect(binds).toEqual([ACCOUNT, 'f-1', 'p-1', hostile, 'Beginner', 'E-Learning']);
    expect(sql).not.toContain(hostile);
    expect(sql).toContain('AND FOUNDATION_ID = ?');
    expect(sql).toContain('AND PROJECT_ID = ?');
    expect(sql).toContain('AND COURSE_NAME = ?');
    expect(sql).toContain('AND COURSE_LEVEL = ?');
    expect(sql).toContain('AND COURSE_FORMAT = ?');
  });

  it('counts learners outside the people list only when no filter is set', async () => {
    mockStatsRows({ pairs: [PAIR_ROW], outside: [{ PEOPLE: 3 }] });

    const unfiltered = await service.getTrainingStats(ACCOUNT, QUERY);
    expect(unfiltered.learnersOutsidePeopleList).toBe(3);
    expect(unfiltered.peopleWithTrainingActivity).toBe(13);
    expect(outsideCalls()).toBe(1);

    execute.mockClear();
    mockStatsRows({ pairs: [PAIR_ROW], outside: [{ PEOPLE: 3 }] });
    const filtered = await service.getTrainingStats(ACCOUNT, { ...QUERY, level: 'Beginner' });
    expect(filtered.learnersOutsidePeopleList).toBe(0);
    expect(filtered.peopleWithTrainingActivity).toBe(10);
    expect(outsideCalls()).toBe(0);
  });

  it('reads the outside learners without people-list rows of the same key, in the same range', async () => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT, { ...QUERY, range: '90d' });

    const sql = execute.mock.calls.map(([statement]) => statement as string).find((statement) => statement.includes('NOT IS_ON_PEOPLE_LIST'))!;
    expect(sql).toContain('PERSON_KEY NOT IN (');
    expect(sql.match(/AND ACTIVITY_TS >= DATEADD\(day, -90, CURRENT_DATE\(\)\)/g)).toHaveLength(2);
  });

  it('reports no roster (null, not zero) without a training client row, and a roster of zero as zero', async () => {
    mockStatsRows({ pairs: [PAIR_ROW], roster: [] });
    const none = await service.getTrainingStats(ACCOUNT, QUERY);
    expect(none.rosterMembers).toBeNull();
    expect(none.rosterMembersAsOf).toBeNull();

    mockStatsRows({ roster: [{ ROSTER_MEMBERS: 0, AS_OF_TS: '2026-10-29 23:00:00.000' }] });
    const zero = await service.getTrainingStats(ACCOUNT, QUERY);
    expect(zero.rosterMembers).toBe(0);
    expect(zero.rosterMembersAsOf).toBe('2026-10-29T23:00:00.000Z');
  });

  it('returns zeros and no as-of time for an org without training rows', async () => {
    mockStatsRows({});

    const stats = await service.getTrainingStats(ACCOUNT, QUERY);

    expect(stats).toMatchObject({ asOf: null, peopleWithTrainingActivity: 0, coursesTaken: 0, completionRatePct: 0, coursesInProgress: 0 });
  });

  it('scopes every statement to the account', async () => {
    mockStatsRows({});

    await service.getTrainingStats(ACCOUNT, QUERY);

    for (const [sql, binds] of execute.mock.calls as [string, string[]][]) {
      expect(sql).toContain('ACCOUNT_ID = ?');
      expect(binds.every((bind) => bind === ACCOUNT)).toBe(true);
    }
  });

  it('caches per range and filter set under v5, and rejects a stored entry of the old shape', async () => {
    mockStatsRows({});
    const keyOf = async (query: OrgTrainingStatsQuery): Promise<string> => {
      withOrgCache.mockClear();
      await service.getTrainingStats(ACCOUNT, query);
      return withOrgCache.mock.calls[0][1] as string;
    };

    const base = await keyOf(QUERY);
    const keys = new Set([
      base,
      await keyOf({ ...QUERY, range: '30d' as OrgLensTimeRange }),
      await keyOf({ ...QUERY, course: 'A' }),
      await keyOf({ ...QUERY, course: 'B' }),
      await keyOf({ ...QUERY, format: 'A' }),
    ]);

    expect(base).toBe(`training-stats:v5:${orgTrainingFiltersSignature(QUERY)}`);
    expect(keys.size).toBe(5);
    expect(base).toMatch(/^training-stats:v5:[A-Za-z0-9_-]+$/);
    const accept = withOrgCache.mock.calls[0][4] as (value: unknown) => boolean;
    expect(accept({ certRows: [], trainingRows: [], activityRows: [], rosterRows: [] })).toBe(false);
    expect(accept({ range: '730d', coursesTaken: 0, coursesInProgress: 0 })).toBe(true);
  });
});

describe('OrgLensTrainingService — Training and Trainees read the same numbers', () => {
  it('emits identical SQL and binds for the same query, whichever page asks', async () => {
    mockStatsRows({ pairs: [PAIR_ROW] });
    const query: OrgTrainingStatsQuery = { range: '365d', foundation: 'f-1', project: null, course: 'Course A', level: null, format: 'E-Learning' };

    // Training page and People › Trainees both call getTrainingStats with the query their URL parses to.
    const training = await service.getTrainingStats(ACCOUNT, { ...query });
    const trainingCalls = execute.mock.calls.map((call) => [...call]);
    execute.mockClear();
    const trainees = await new OrgLensTrainingService().getTrainingStats(ACCOUNT, { ...query });

    expect(trainees).toEqual(training);
    expect(execute.mock.calls).toEqual(trainingCalls);
  });
});
