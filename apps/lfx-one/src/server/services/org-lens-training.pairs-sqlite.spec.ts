// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { OrgTrainingStats, OrgTrainingStatsQuery, OrgTrainingTabId } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

// The service imports `@lfx-one/shared/utils`, whose barrel pulls Angular; only the view-state and range utils are needed.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-training-view-state.utils')),
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache: vi.fn() }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn() } }));

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensTrainingService } from './org-lens-training.service';
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
  return sql.replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '').replaceAll('IFF(', 'IIF(');
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

  it('narrows every figure to one company under the Company filter, which then equals its single-organization figures', async () => {
    const narrowed = family(OTHER_ACCOUNT);
    expect(narrowed.members.map((member) => member.accountId)).toEqual([OTHER_ACCOUNT]);

    const stats = await service.getFamilyTrainingStats(req, narrowed, query({}));
    const single = await service.getTrainingStats(OTHER_ACCOUNT, query({}), 'auditor-entitlement');
    expect({ ...stats, organizations: undefined, rollUp: undefined }).toEqual({ ...single, organizations: undefined, rollUp: undefined });
    expect(stats.organizations).toHaveLength(2);
  });
});
