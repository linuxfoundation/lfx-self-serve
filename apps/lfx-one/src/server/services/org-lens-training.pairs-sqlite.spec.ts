// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { OrgTraineesResponse, OrgTrainingStats, OrgTrainingStatsQuery, OrgTrainingTabId } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-training-view-state.utils')),
  ...(await import('../../../../../packages/shared/src/utils/compact-cache.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-trainee-pairs.utils')),
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache: vi.fn(), withOrgCompactCache: vi.fn() }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn() } }));

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { countOrgTraineePairs, mostRecentOrgTraineePair } from '../../../../../packages/shared/src/utils/org-trainee-pairs.utils';
import { matchesOrgTrainingFilters } from '../../../../../packages/shared/src/utils/org-training-view-state.utils';
import { OrgLensTrainingService } from './org-lens-training.service';
import { OrgPeopleTraineesService } from './org-people-trainees.service';
import { withOrgCache } from './valkey.service';

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: (string | number | null)[]): unknown;
    all(...values: (string | number | null)[]): Record<string, unknown>[];
  };
  close(): void;
}

// node:sqlite needs Node >= 22.13; this app's Node typings predate the module, hence the local shape.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => SqlDatabase };

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;
const OTHER_ACCOUNT = 'other-account';

function toSqlite(sql: string): string {
  return sql
    .replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '')
    .replaceAll('IFF(', 'IIF(')
    .replaceAll('BOOLOR_AGG(', 'MAX(')
    .replace(/DATEADD\(day, -(\d+), TO_DATE\((\(SELECT MAX\(DBT_RUN_AT\) FROM \w+ WHERE ACCOUNT_ID = \?\))\)\)/g, "date($2, '-$1 days')");
}

interface PairRow {
  range: string;
  account: string;
  person: string;
  course: string;
  onList: boolean;
  certified: boolean;
  tab: OrgTrainingTabId;
  courseName: string | null;
  level: string | null;
  format: string | null;
  projectId: string | null;
  foundationId: string | null;
}

const CKA = {
  course: 'cka',
  tab: 'certifications',
  courseName: 'Kubernetes Admin',
  level: 'Intermediate',
  format: 'Exam',
  projectId: 'proj-b',
  foundationId: 'f-a',
} as const;
const CKS = {
  course: 'cks',
  tab: 'certifications',
  courseName: 'Kubernetes Security',
  level: 'Advanced',
  format: 'Exam',
  projectId: 'proj-b',
  foundationId: 'f-a',
} as const;
const INTRO = {
  course: 'intro',
  tab: 'trainings',
  courseName: 'Intro to K8s',
  level: 'Beginner',
  format: 'E-Learning',
  projectId: 'proj-a',
  foundationId: 'f-a',
} as const;
const WEB = { course: 'web', tab: 'trainings', courseName: 'Web Basics', level: 'Advanced', format: null, projectId: 'proj-c', foundationId: 'f-c' } as const;

const pair = (
  range: string,
  person: string,
  course: typeof CKA | typeof CKS | typeof INTRO | typeof WEB,
  certified: boolean,
  extra: Partial<PairRow> = {}
): PairRow => ({
  range,
  account: ACCOUNT,
  person,
  onList: true,
  certified,
  ...course,
  ...extra,
});

const PAIRS: PairRow[] = [
  pair('all', 'p1', CKA, true),
  pair('all', 'p1', INTRO, false),
  pair('all', 'p2', CKA, true),
  pair('all', 'p2', INTRO, true),
  pair('all', 'p3', CKS, false),
  pair('all', 'p3', WEB, true),
  pair('all', 'p4', INTRO, false, { onList: false }),
  pair('all', 'p5', INTRO, true, { onList: false }),
  pair('all', 'p1', CKA, true, { account: OTHER_ACCOUNT }),
  pair('all', 'p9', INTRO, false, { account: OTHER_ACCOUNT }),
  pair('30d', 'p1', CKA, true),
  pair('30d', 'p3', CKS, false),
  pair('30d', 'p4', INTRO, false, { onList: false }),
];

const NONE = { foundation: null, project: null, course: null, level: null, format: null };
const query = (filters: Partial<OrgTrainingStatsQuery>): OrgTrainingStatsQuery => ({ range: 'all', ...NONE, ...filters });

type Counts = Pick<
  OrgTrainingStats,
  'coursesTaken' | 'certifications' | 'trainingsCompleted' | 'coursesInProgress' | 'peopleWithTrainingActivity' | 'certifiedPeople' | 'peopleInTraining'
>;

const pick = (stats: OrgTrainingStats): Counts => ({
  coursesTaken: stats.coursesTaken,
  certifications: stats.certifications,
  trainingsCompleted: stats.trainingsCompleted,
  coursesInProgress: stats.coursesInProgress,
  peopleWithTrainingActivity: stats.peopleWithTrainingActivity,
  certifiedPeople: stats.certifiedPeople,
  peopleInTraining: stats.peopleInTraining,
});

let database: SqlDatabase;
let service: OrgLensTrainingService;

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE ORG_PEOPLE_TRAINING_PAIRS (
      TIME_RANGE TEXT, ACCOUNT_ID TEXT, PERSON_KEY TEXT, COURSE_KEY TEXT, PAIR_KEY TEXT, IS_ON_PEOPLE_LIST INTEGER, IS_CERTIFIED INTEGER,
      TRAINING_TAB TEXT, COURSE_NAME TEXT, COURSE_LEVEL TEXT, COURSE_FORMAT TEXT, PROJECT_ID TEXT, PROJECT_NAME TEXT,
      FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT, DBT_RUN_AT TEXT
    );
    CREATE TABLE ORG_TRAINING_ROSTER_MEMBERS (ACCOUNT_ID TEXT, ROSTER_MEMBERS INTEGER, AS_OF_TS TEXT);
    CREATE TABLE ORG_PEOPLE_ALL_RANGES (ACCOUNT_ID TEXT, TIME_RANGE TEXT, PROJECT_SCOPE TEXT, IS_FORMER INTEGER, PERSON_KEY TEXT, NAME TEXT, TITLE TEXT);
  `);
  const insert = database.prepare('INSERT INTO ORG_PEOPLE_TRAINING_PAIRS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const p of PAIRS) {
    insert.run(
      p.range,
      p.account,
      p.person,
      p.course,
      `${p.person}|${p.course}`,
      p.onList ? 1 : 0,
      p.certified ? 1 : 0,
      p.tab,
      p.courseName,
      p.level,
      p.format,
      p.projectId,
      p.projectId && `Project ${p.projectId}`,
      p.foundationId,
      p.foundationId && `Foundation ${p.foundationId}`,
      '2026-11-25 04:15:00'
    );
  }
  const person = database.prepare('INSERT INTO ORG_PEOPLE_ALL_RANGES VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const key of ['p1', 'p2', 'p3']) person.run(ACCOUNT, 'all', 'all', 0, key, `Person ${key}`, null);

  vi.clearAllMocks();
  execute.mockImplementation(async (sql: string, binds: string[]) => ({
    rows: database
      .prepare(toSqlite(sql))
      .all(...binds)
      .map((result) => Object.fromEntries(Object.entries(result).map(([column, value]) => [column.toUpperCase(), value]))),
  }));
  service = new OrgLensTrainingService();
});

afterEach(() => {
  database.close();
});

describe('Training reads run against SQLite over warehouse-resolved pairs', () => {
  it.each<[string, OrgTrainingStatsQuery, number, number, number, number, number, number, number]>([
    ['all time, no filter', query({}), 6, 2, 2, 2, 3, 2, 2],
    ['30 days: only the pairs the model lists for that range', query({ range: '30d' }), 2, 1, 0, 1, 2, 1, 1],
    ['level Advanced', query({ level: 'Advanced' }), 2, 0, 1, 1, 1, 0, 1],
    ['foundation f-a', query({ foundation: 'f-a' }), 5, 2, 1, 2, 3, 2, 2],
    ['project proj-b + format Exam', query({ project: 'proj-b', format: 'Exam' }), 3, 2, 0, 1, 3, 2, 1],
    ['course Web Basics', query({ course: 'Web Basics' }), 1, 0, 1, 0, 1, 0, 0],
    ['a combination no pair carries', query({ foundation: 'f-c', level: 'Beginner' }), 0, 0, 0, 0, 0, 0, 0],
  ])('%s: stats count the distinct keys of the listed pairs', async (_label, q, taken, certs, trainings, inProgress, people, certifiedPeople, inTraining) => {
    const stats = await service.getTrainingStats(ACCOUNT, q, 'auditor-entitlement');

    expect(pick(stats)).toEqual({
      coursesTaken: taken,
      certifications: certs,
      trainingsCompleted: trainings,
      coursesInProgress: inProgress,
      peopleWithTrainingActivity: people,
      certifiedPeople,
      peopleInTraining: inTraining,
    });
    expect(stats.coursesTaken).toBe(stats.certifications + stats.trainingsCompleted + stats.coursesInProgress);
  });

  it.each([query({}), query({ range: '30d' }), query({ foundation: 'f-a' }), query({ level: 'Advanced' }), query({ project: 'proj-b', format: 'Exam' })])(
    'classifies every pair into the same tab in the stats and the group-by totals (%o)',
    async (q) => {
      const stats = await service.getTrainingStats(ACCOUNT, q, 'auditor-entitlement');
      const certifications = await service.getGroups({} as never, ACCOUNT, q, { groupBy: 'course', tab: 'certifications' }, 'auditor-entitlement');
      const trainings = await service.getGroups({} as never, ACCOUNT, q, { groupBy: 'foundation', tab: 'trainings' }, 'auditor-entitlement');

      expect(certifications.totals.completed).toBe(stats.certifications);
      expect(trainings.totals.completed).toBe(stats.trainingsCompleted);
      expect(certifications.totals.inProgress + trainings.totals.inProgress).toBe(stats.coursesInProgress);
      expect(certifications.totals.coursesTaken + trainings.totals.coursesTaken).toBe(stats.coursesTaken);
    }
  );

  it('counts the learners off the people list as their own number, only while no filter is set, per range', async () => {
    const all = await service.getTrainingStats(ACCOUNT, query({}), 'auditor-entitlement');
    const recent = await service.getTrainingStats(ACCOUNT, query({ range: '30d' }), 'auditor-entitlement');
    const filtered = await service.getTrainingStats(ACCOUNT, query({ level: 'Beginner' }), 'auditor-entitlement');

    expect(all.learnersOutsidePeopleList).toBe(2);
    expect(recent.learnersOutsidePeopleList).toBe(1);
    expect(filtered.learnersOutsidePeopleList).toBeNull();
    expect(all.peopleWithTrainingActivity).toBe(3);
  });

  it('builds one table row per group value of the tab, from that group pairs only', async () => {
    const response = await service.getGroups({} as never, ACCOUNT, query({}), { groupBy: 'course', tab: 'trainings' }, 'auditor-entitlement');

    expect(response.data.map(({ key, people, coursesTaken, completed, inProgress }) => ({ key, people, coursesTaken, completed, inProgress }))).toEqual([
      { key: 'Intro to K8s', people: 2, coursesTaken: 2, completed: 1, inProgress: 1 },
      { key: 'Web Basics', people: 1, coursesTaken: 1, completed: 1, inProgress: 0 },
    ]);
    expect(response.totals).toEqual({ people: 3, coursesTaken: 3, completed: 2, inProgress: 1 });
  });

  it('counts a drawer cell from its pairs and names the current employees holding them', async () => {
    const drawer = await service.getGroupEmployees(
      {} as never,
      ACCOUNT,
      query({}),
      { groupBy: 'course', groupValue: 'Kubernetes Admin', tab: 'certifications', status: 'completed' },
      'auditor-entitlement'
    );

    expect(drawer.total).toBe(2);
    expect(drawer.data.map((employee) => employee.contactId)).toEqual(['p1', 'p2']);
  });

  it('offers the options of the range and accepts a value a pair carries only in a narrower range', async () => {
    database
      .prepare('INSERT INTO ORG_PEOPLE_TRAINING_PAIRS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        '30d',
        ACCOUNT,
        'p2',
        'intro',
        'p2|intro',
        1,
        0,
        'trainings',
        'Intro to K8s',
        'Starter',
        'E-Learning',
        'proj-a',
        'Project proj-a',
        'f-a',
        'Foundation f-a',
        '2026-11-25 04:15:00'
      );

    const recent = await service.getFilterOptions(ACCOUNT, '30d', 'auditor-entitlement');
    const stats = await service.getTrainingStats(ACCOUNT, query({ range: '30d', level: 'Starter' }), 'auditor-entitlement');
    const unknown = await service.getTrainingStats(ACCOUNT, query({ level: 'Expert' }), 'auditor-entitlement');

    expect(recent.levels.map((option) => option.value)).toEqual(['Advanced', 'Intermediate', 'Starter']);
    expect(stats.coursesTaken).toBe(1);
    expect(unknown.coursesTaken).toBe(0);
    expect(execute.mock.calls.some(([, binds]) => (binds as string[]).includes('Expert'))).toBe(false);
  });

  it('counts a pair once when the table repeats it in the same account and range', async () => {
    const read = async () => ({
      stats: pick(await service.getTrainingStats(ACCOUNT, query({}), 'auditor-entitlement')),
      certifications: await service.getGroups({} as never, ACCOUNT, query({}), { groupBy: 'course', tab: 'certifications' }, 'auditor-entitlement'),
      trainings: await service.getGroups({} as never, ACCOUNT, query({}), { groupBy: 'course', tab: 'trainings' }, 'auditor-entitlement'),
      drawer: (
        await service.getGroupEmployees(
          {} as never,
          ACCOUNT,
          query({}),
          { groupBy: 'course', groupValue: 'Kubernetes Admin', tab: 'certifications', status: 'completed' },
          'auditor-entitlement'
        )
      ).total,
    });
    const before = await read();
    const insert = database.prepare('INSERT INTO ORG_PEOPLE_TRAINING_PAIRS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run(
      'all',
      ACCOUNT,
      'p1',
      'cka',
      'p1|cka',
      1,
      1,
      'certifications',
      'Kubernetes Admin',
      'Intermediate',
      'Exam',
      'proj-b',
      'Project proj-b',
      'f-a',
      'Foundation f-a',
      '2026-11-25 04:15:00'
    );
    insert.run(
      'all',
      ACCOUNT,
      'p1',
      'intro',
      'p1|intro',
      1,
      0,
      'trainings',
      'Intro to K8s',
      'Beginner',
      'E-Learning',
      'proj-a',
      'Project proj-a',
      'f-a',
      'Foundation f-a',
      '2026-11-25 04:15:00'
    );

    expect(await read()).toEqual(before);
    expect(before.drawer).toBe(2);
  });

  it('reads the as-of time of the pairs and nothing of another organization', async () => {
    const stats = await service.getTrainingStats(OTHER_ACCOUNT, query({}), 'auditor-entitlement');

    expect(stats.asOf).toBe('2026-11-25T04:15:00.000Z');
    expect(pick(stats)).toEqual({
      coursesTaken: 2,
      certifications: 1,
      trainingsCompleted: 0,
      coursesInProgress: 1,
      peopleWithTrainingActivity: 2,
      certifiedPeople: 1,
      peopleInTraining: 1,
    });
  });
});

describe('a family roll-up over two accounts that share a person', () => {
  // OTHER_ACCOUNT lists p1 with the Kubernetes Admin certificate ACCOUNT also lists, and its own learner p9. Adding the two
  // companies' numbers would count p1 and that pair twice.
  const req = {} as Request;
  const family = (company?: string) =>
    service.familyScope(
      {
        rollUpKey: 'family-001TOP',
        rootUid: '001TOP',
        members: [ACCOUNT, OTHER_ACCOUNT].map((accountId) => ({
          uid: accountId,
          accountId,
          name: accountId === ACCOUNT ? 'Acme' : 'Acme Labs',
          logoUrl: null,
        })),
        complete: true,
        excludedCount: 0,
      },
      company
    );
  // p3's Kubernetes Security pair: enrolled at ACCOUNT (the base fixture), certified at OTHER_ACCOUNT.
  const certifyP3AtOtherAccount = () =>
    database
      .prepare('INSERT INTO ORG_PEOPLE_TRAINING_PAIRS VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'all',
        OTHER_ACCOUNT,
        'p3',
        'cks',
        'p3|cks',
        1,
        1,
        'certifications',
        'Kubernetes Security',
        'Advanced',
        'Exam',
        'proj-b',
        'Project proj-b',
        'f-a',
        'Foundation f-a',
        '2026-11-25 04:15:00'
      );

  beforeEach(() => {
    vi.mocked(withOrgCache).mockImplementation(async (_org, _key, _ttl, fetcher) => fetcher());
  });

  it('counts each person and each person-and-course pair once across the family, and its outside learners once', async () => {
    const stats = await service.getFamilyTrainingStats(req, family(), query({}));

    expect(pick(stats)).toEqual({
      coursesTaken: 7,
      certifications: 2,
      trainingsCompleted: 2,
      coursesInProgress: 3,
      peopleWithTrainingActivity: 4,
      certifiedPeople: 2,
      peopleInTraining: 3,
    });
    expect(stats.learnersOutsidePeopleList).toBe(2);
    expect(stats.organizations).toEqual([
      { accountId: ACCOUNT, name: 'Acme' },
      { accountId: OTHER_ACCOUNT, name: 'Acme Labs' },
    ]);
    expect(stats.rollUp).toEqual({ complete: true, excludedCount: 0 });
  });

  it('counts a pair certified at one company and enrolled at another once, as certified, and its person as not in training', async () => {
    const singleBefore = pick(await service.getTrainingStats(ACCOUNT, query({}), 'auditor-entitlement'));
    certifyP3AtOtherAccount();

    const course = await service.getFamilyTrainingStats(req, family(), query({ course: 'Kubernetes Security' }));
    expect(pick(course)).toEqual({
      coursesTaken: 1,
      certifications: 1,
      trainingsCompleted: 0,
      coursesInProgress: 0,
      peopleWithTrainingActivity: 1,
      certifiedPeople: 1,
      peopleInTraining: 0,
    });

    const all = await service.getFamilyTrainingStats(req, family(), query({}));
    expect(pick(all)).toEqual({
      coursesTaken: 7,
      certifications: 3,
      trainingsCompleted: 2,
      coursesInProgress: 2,
      peopleWithTrainingActivity: 4,
      certifiedPeople: 3,
      peopleInTraining: 2,
    });
    expect(all.coursesTaken).toBe(all.certifications + all.trainingsCompleted + all.coursesInProgress);
    expect(pick(await service.getTrainingStats(ACCOUNT, query({}), 'auditor-entitlement'))).toEqual(singleBefore);
  });

  it('serves one row per group value and company, while the totals count each pair once over the tab and equal the stat tiles', async () => {
    certifyP3AtOtherAccount();
    const stats = await service.getFamilyTrainingStats(req, family(), query({}));
    const certifications = await service.getFamilyGroups(req, family(), query({}), {
      groupBy: 'course',
      tab: 'certifications',
      sortField: 'people',
      sortOrder: 'DESC',
    });
    const trainings = await service.getFamilyGroups(req, family(), query({}), { groupBy: 'course', tab: 'trainings' });

    expect(certifications.data.map((row) => [row.label, row.organization?.name, row.people, row.coursesTaken, row.completed, row.inProgress])).toEqual([
      ['Kubernetes Admin', 'Acme', 2, 2, 2, 0],
      ['Kubernetes Admin', 'Acme Labs', 1, 1, 1, 0],
      ['Kubernetes Security', 'Acme', 1, 1, 0, 1],
      ['Kubernetes Security', 'Acme Labs', 1, 1, 1, 0],
    ]);
    expect(certifications.total).toBe(4);
    expect(certifications.totals).toEqual({ people: 3, coursesTaken: 3, completed: 3, inProgress: 0 });
    expect(certifications.totals.completed).toBe(stats.certifications);
    expect(trainings.totals.completed).toBe(stats.trainingsCompleted);
    expect(certifications.totals.inProgress + trainings.totals.inProgress).toBe(stats.coursesInProgress);
    expect(certifications.totals.coursesTaken + trainings.totals.coursesTaken).toBe(stats.coursesTaken);
  });

  it('adds up the companies roster members, and has none when no company has a training program', async () => {
    expect((await service.getFamilyTrainingStats(req, family(), query({}))).rosterMembers).toBeNull();

    database.prepare('INSERT INTO ORG_TRAINING_ROSTER_MEMBERS VALUES (?, ?, ?)').run(ACCOUNT, 40, '2026-10-29 23:00:00');
    database.prepare('INSERT INTO ORG_TRAINING_ROSTER_MEMBERS VALUES (?, ?, ?)').run(OTHER_ACCOUNT, 5, '2026-10-30 23:00:00');

    expect((await service.getFamilyTrainingStats(req, family(), query({}))).rosterMembers).toBe(45);
    expect((await service.getTrainingStats(ACCOUNT, query({}), 'auditor-entitlement')).rosterMembers).toBe(40);
  });

  it('offers every value a served company carries, and answers a value none carries with zeros', async () => {
    database.prepare("UPDATE ORG_PEOPLE_TRAINING_PAIRS SET COURSE_LEVEL = 'Expert' WHERE ACCOUNT_ID = ? AND PAIR_KEY = 'p9|intro'").run(OTHER_ACCOUNT);

    const options = await service.getFamilyFilterOptions(req, family(), 'all');
    expect(options.levels.map((option) => option.value)).toEqual(['Advanced', 'Beginner', 'Expert', 'Intermediate']);
    expect(pick(await service.getFamilyTrainingStats(req, family(), query({ level: 'Expert' }))).coursesTaken).toBe(1);
    expect(pick(await service.getFamilyTrainingStats(req, family(), query({ level: 'Starter' }))).coursesTaken).toBe(0);
  });

  // p1|cka resolves to Intermediate / proj-b in ACCOUNT and to Beginner / proj-a in OTHER_ACCOUNT, where it is certified.
  it.each<[string, Partial<OrgTrainingStatsQuery>]>([
    ['level Beginner', { level: 'Beginner' }],
    ['project proj-a', { project: 'proj-a' }],
  ])('with %s, counts the pair one company resolves into the filter in the totals and stat tiles its row shows', async (_label, filters) => {
    database
      .prepare("UPDATE ORG_PEOPLE_TRAINING_PAIRS SET COURSE_LEVEL = 'Beginner', PROJECT_ID = 'proj-a' WHERE ACCOUNT_ID = ? AND PAIR_KEY = 'p1|cka'")
      .run(OTHER_ACCOUNT);
    const scope = family();
    const stats = await service.getFamilyTrainingStats(req, scope, query(filters));
    const certifications = await service.getFamilyGroups(req, scope, query(filters), { groupBy: 'course', tab: 'certifications' });
    const trainings = await service.getFamilyGroups(req, scope, query(filters), { groupBy: 'course', tab: 'trainings' });

    expect(certifications.data.map((row) => [row.label, row.organization?.name, row.people, row.coursesTaken, row.completed, row.inProgress])).toEqual([
      ['Kubernetes Admin', 'Acme Labs', 1, 1, 1, 0],
    ]);
    expect(certifications.totals).toEqual({ people: 1, coursesTaken: 1, completed: 1, inProgress: 0 });
    expect(trainings.totals).toEqual({ people: 3, coursesTaken: 3, completed: 1, inProgress: 2 });
    expect([stats.coursesTaken, stats.certifications, stats.trainingsCompleted, stats.coursesInProgress]).toEqual([4, 1, 1, 2]);
    expect([stats.peopleWithTrainingActivity, stats.certifiedPeople, stats.peopleInTraining]).toEqual([3, 1, 2]);
    expect(certifications.totals.completed).toBe(stats.certifications);
    expect(trainings.totals.completed).toBe(stats.trainingsCompleted);
    expect(certifications.totals.coursesTaken + trainings.totals.coursesTaken).toBe(stats.coursesTaken);
  });

  it('narrows every figure to one company under the Company filter, which then equals its single-organization figures', async () => {
    const narrowed = family(OTHER_ACCOUNT);
    expect(narrowed.members.map((member) => member.accountId)).toEqual([OTHER_ACCOUNT]);

    const stats = await service.getFamilyTrainingStats(req, narrowed, query({}));
    const single = await service.getTrainingStats(OTHER_ACCOUNT, query({}), 'auditor-entitlement');
    expect({ ...stats, organizations: undefined, rollUp: undefined }).toEqual({ ...single, organizations: undefined, rollUp: undefined });
    expect(stats.organizations).toHaveLength(2);
  });
});

describe('People › Trainees over the same pairs as the stats', () => {
  const TRAINEES_ACCOUNT = 'trainees-account';
  const BUILT = '2026-11-25 04:15:00';
  const MIXED = { course: 'cert-mixed', courseName: 'Mixed Type Exam', level: 'Intermediate', format: 'Exam', projectId: 'proj-b', foundationId: 'f-a' };
  const COURSES = { 'cert-mixed': MIXED, intro: INTRO, web: WEB } as const;
  const TYPES = { 'cert-mixed': ['Certification', 'certifications'], intro: ['Training', 'trainings'], web: ['Training', 'trainings'] } as const;

  const TRAINEE_PAIRS: [string, string, keyof typeof COURSES, boolean, boolean, string][] = [
    ['all', 't1', 'cert-mixed', true, true, '2026-10-26 10:00:00'],
    ['all', 't1', 'intro', true, false, '2026-08-01 09:00:00'],
    ['all', 't2', 'intro', true, true, '2026-11-20 10:00:00'],
    ['all', 't2', 'web', true, false, '2026-11-20 10:00:00'],
    ['all', 't-gone', 'web', true, false, '2026-11-21 09:00:00'],
    ['all', 'o1', 'intro', false, false, '2026-11-22 09:00:00'],
    ['all', 't2-elsewhere', 'web', false, false, '2026-11-22 09:00:00'],
    ['30d', 't1', 'cert-mixed', true, true, '2026-10-26 10:00:00'],
    ['30d', 't2', 'intro', true, true, '2026-11-20 10:00:00'],
    ['30d', 't2', 'web', true, false, '2026-11-20 10:00:00'],
    ['30d', 't-gone', 'web', true, false, '2026-11-21 09:00:00'],
    ['30d', 'o1', 'intro', false, false, '2026-11-22 09:00:00'],
  ];
  const TRAINING_ROWS: [string, keyof typeof COURSES, boolean, string, string, string][] = [
    ['t1', 'cert-mixed', true, 'Enrolled', '2026-09-01 09:00:00', 'Training'],
    ['t1', 'cert-mixed', true, 'Certified', '2026-10-26 10:00:00', 'Certification'],
    ['t1', 'intro', true, 'Enrolled', '2026-08-01 09:00:00', 'Training'],
    ['t2', 'intro', true, 'Enrolled', '2026-08-01 09:00:00', 'Training'],
    ['t2', 'intro', true, 'Certified', '2026-11-20 10:00:00', 'Training'],
    ['t2', 'web', true, 'Enrolled', '2026-11-20 10:00:00', 'Training'],
    ['t-gone', 'web', true, 'Enrolled', '2026-11-21 09:00:00', 'Training'],
    ['o1', 'intro', false, 'Enrolled', '2026-11-22 09:00:00', 'Training'],
  ];

  let trainees: OrgPeopleTraineesService;

  beforeEach(() => {
    database.exec(`
      ALTER TABLE ORG_PEOPLE_TRAINING_PAIRS ADD COLUMN PRODUCT_TYPE TEXT;
      ALTER TABLE ORG_PEOPLE_TRAINING_PAIRS ADD COLUMN LAST_ACTIVITY_TS TEXT;
      ALTER TABLE ORG_PEOPLE_ALL_RANGES ADD COLUMN LFID TEXT;
      ALTER TABLE ORG_PEOPLE_ALL_RANGES ADD COLUMN CDP_MEMBER_ID TEXT;
      ALTER TABLE ORG_PEOPLE_ALL_RANGES ADD COLUMN EMAIL TEXT;
      CREATE TABLE ORG_PEOPLE_TRAINING (
        ACCOUNT_ID TEXT, PERSON_KEY TEXT, IS_ON_PEOPLE_LIST INTEGER, COURSE_ID TEXT, COURSE_OR_CERT_ID TEXT, STATUS TEXT, ACTIVITY_TS TEXT, PRODUCT_TYPE TEXT
      );
      CREATE TABLE ORG_TRAINING_OUTSIDE_LEARNERS (ACCOUNT_ID TEXT, PERSON_KEY TEXT, LEARNER_NAME TEXT);
    `);
    const insertPair = database.prepare(`
      INSERT INTO ORG_PEOPLE_TRAINING_PAIRS (
        TIME_RANGE, ACCOUNT_ID, PERSON_KEY, COURSE_KEY, PAIR_KEY, IS_ON_PEOPLE_LIST, IS_CERTIFIED, TRAINING_TAB, COURSE_NAME, COURSE_LEVEL,
        COURSE_FORMAT, PROJECT_ID, PROJECT_NAME, FOUNDATION_ID, FOUNDATION_NAME, DBT_RUN_AT, PRODUCT_TYPE, LAST_ACTIVITY_TS
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [range, person, course, onList, certified, lastActivity] of TRAINEE_PAIRS) {
      const c = COURSES[course];
      const [productType, tab] = TYPES[course];
      insertPair.run(
        range,
        TRAINEES_ACCOUNT,
        person,
        course,
        `${person}|${course}`,
        onList ? 1 : 0,
        certified ? 1 : 0,
        tab,
        c.courseName,
        c.level,
        c.format,
        c.projectId,
        c.projectId && `Project ${c.projectId}`,
        c.foundationId,
        c.foundationId && `Foundation ${c.foundationId}`,
        BUILT,
        productType,
        lastActivity
      );
    }
    const insertRow = database.prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [person, course, onList, status, date, productType] of TRAINING_ROWS) {
      insertRow.run(TRAINEES_ACCOUNT, person, onList ? 1 : 0, course, `${status}:${person}:${course}:${date}`, status, date, productType);
    }
    const insertPerson = database.prepare(
      'INSERT INTO ORG_PEOPLE_ALL_RANGES (ACCOUNT_ID, TIME_RANGE, PROJECT_SCOPE, IS_FORMER, PERSON_KEY, NAME, TITLE) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertPerson.run(TRAINEES_ACCOUNT, 'all', 'all', 0, 't1', 'Trainee One', null);
    insertPerson.run(TRAINEES_ACCOUNT, 'all', 'all', 0, 't2', 'Trainee Two', null);
    insertPerson.run(TRAINEES_ACCOUNT, 'all', 'all', 1, 't-gone', 'Former Trainee', null);
    const insertLearner = database.prepare('INSERT INTO ORG_TRAINING_OUTSIDE_LEARNERS VALUES (?, ?, ?)');
    insertLearner.run(TRAINEES_ACCOUNT, 'o1', 'Outside Learner');
    insertLearner.run(TRAINEES_ACCOUNT, 't2-elsewhere', 'Elsewhere Learner');
    insertLearner.run(TRAINEES_ACCOUNT, 't2', 'Shared Key Learner');

    const sqlite = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql: string, binds: string[]) => {
      const result = (await sqlite(sql, binds)) as { rows: Record<string, unknown>[] };
      return { rows: result.rows.map((row) => ('IS_CERTIFIED' in row ? { ...row, IS_CERTIFIED: row['IS_CERTIFIED'] === 1 } : row)) };
    });
    trainees = new OrgPeopleTraineesService();
  });

  const tableTotals = (response: OrgTraineesResponse, q: OrgTrainingStatsQuery) => {
    const listed = new Set(response.trainees.map((trainee) => trainee.personKey));
    const pairs = response.pairs.filter((p) => listed.has(p.personKey) && matchesOrgTrainingFilters(p, q));
    return { people: new Set(pairs.map((p) => p.personKey)).size, ...countOrgTraineePairs(pairs) };
  };

  it.each<[string, OrgTrainingStatsQuery]>([
    ['all time, no filter', query({})],
    ['30 days, no filter', query({ range: '30d' })],
    ['all time, foundation f-a', query({ foundation: 'f-a' })],
    ['30 days, foundation f-a', query({ range: '30d', foundation: 'f-a' })],
    ['all time, level Beginner', query({ level: 'Beginner' })],
    ['all time, course Mixed Type Exam', query({ course: 'Mixed Type Exam' })],
  ])('%s: table totals plus the former employee pairs equal the stats', async (_label, q) => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, q.range, 'auditor-entitlement');
    const stats = await service.getTrainingStats(TRAINEES_ACCOUNT, q, 'auditor-entitlement');
    const table = tableTotals(response, q);
    const filtered = [q.foundation, q.project, q.course, q.level, q.format].some((value) => value !== null);
    const former = filtered ? { people: 0, pairs: 0 } : response.formerOnPeopleList;

    expect(stats.peopleWithTrainingActivity).toBe(table.people + former.people);
    expect(stats.coursesTaken).toBe(table.coursesTaken + former.pairs);
    expect(stats.certifications).toBe(table.certifications);
    expect(stats.trainingsCompleted).toBe(table.trainingsCompleted);
    expect(stats.coursesInProgress).toBe(table.inProgress + former.pairs);
  });

  it.each(['all', '30d'] as const)('gives every pair of %s at least one date, even one whose only row sits on the build-day boundary', async (range) => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, range, 'auditor-entitlement');
    const dated = new Set(response.details.map((row) => `${row.personKey}|${row.courseId}`));

    expect(response.pairs.length).toBeGreaterThan(0);
    expect(response.pairs.filter((p) => !dated.has(`${p.personKey}|${p.courseId}`))).toEqual([]);
    expect(execute.mock.calls.every(([sql]) => !(sql as string).includes('CURRENT_DATE'))).toBe(true);
  });

  it('keeps 30-day dates inside the window the pairs were built with', async () => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, '30d', 'auditor-entitlement');

    expect(response.details.filter((row) => row.courseId === 'cert-mixed').map((row) => row.status)).toEqual(['Certified']);
  });

  it('counts a course whose rows disagree on the product type as the course classifies it, as the stats do', async () => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, 'all', 'auditor-entitlement');
    const mixed = response.pairs.find((p) => p.personKey === 't1' && p.courseId === 'cert-mixed')!;

    expect(mixed.productType).toBe('Certification');
    expect(countOrgTraineePairs([mixed])).toEqual({ coursesTaken: 1, certifications: 1, trainingsCompleted: 0, inProgress: 0 });
  });

  it('names the certified course as most recent when two pairs share the latest activity', async () => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, 'all', 'auditor-entitlement');

    expect(mostRecentOrgTraineePair(response.pairs.filter((p) => p.personKey === 't2'))?.courseName).toBe('Intro to K8s');
  });

  it('lists the outside learners the stats count, and not a key that has people-list pairs', async () => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, 'all', 'auditor-entitlement');
    const stats = await service.getTrainingStats(TRAINEES_ACCOUNT, query({}), 'auditor-entitlement');

    expect(response.outsideLearners).toEqual([
      { personKey: 'outside:1', name: 'Elsewhere Learner', status: 'Enrolled' },
      { personKey: 'outside:2', name: 'Outside Learner', status: 'Enrolled' },
    ]);
    expect(stats.learnersOutsidePeopleList).toBe(response.outsideLearners.length);
    expect(JSON.stringify(response)).not.toMatch(/Shared Key Learner|t-gone|t2-elsewhere/);
  });

  it('lists current employees only, and counts the former one apart', async () => {
    const response = await trainees.getTrainees(TRAINEES_ACCOUNT, 'all', 'auditor-entitlement');

    expect(response.trainees.map((trainee) => trainee.personKey)).toEqual(['t1', 't2']);
    expect(response.formerOnPeopleList).toEqual({ people: 1, pairs: 1 });
  });
});
