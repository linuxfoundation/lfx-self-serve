// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';

import type { OrgTraineeDetailRow, OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
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

import { countOrgTraineePairs, resolveOrgTraineePairs } from '../../../../../packages/shared/src/utils/org-trainee-pairs.utils';
import { matchesOrgTrainingFilters, normalizeOrgTrainingFilterValue } from '../../../../../packages/shared/src/utils/org-training-view-state.utils';
import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { buildOrgTrainingPairsCte } from '../helpers/org-training-pairs.sql';
import { OrgLensTrainingService } from './org-lens-training.service';

// The SQL under test is the real SQL of OrgLensTrainingService.getTrainingStats (buildOrgTrainingPairsCte + fetchTrainingStats),
// executed against node:sqlite over synthetic ORG_PEOPLE_TRAINING rows, so the pairs rule is run, not pattern-matched. Three
// answers must agree for every filter set: the SQL's mapped stats, the client mirror (resolveOrgTraineePairs +
// matchesOrgTrainingFilters + countOrgTraineePairs, which the Trainees table uses) and a hand count written below in plain code.
//
// Snowflake-only constructs are translated by `toSqlite`, never by weakening the SQL:
//   BOOLOR_AGG(x)  -> MAX(x)                 (x is 0/1, never NULL: STATUS is filtered to two known values)
//   COUNT_IF(x)    -> COUNT(CASE WHEN x THEN 1 END)
//   IFF(a, b, c)   -> IIF(a, b, c)
//   LEFT(s, n)     -> SUBSTR(s, 1, n)
//   MAX_BY(v, k)   -> correlated subquery over the same pair's rows: the v of the row with the greatest non-NULL k
//   TRIM, NULLIF, COALESCE, MAX, COUNT(DISTINCT), UNION and the schema-qualified table names run as written (the prefix is dropped).
// Range predicates (DATEADD / CURRENT_DATE) are not exercised: every query uses range 'all', whose predicate is empty.
//
// What this cannot prove, stated exactly:
//   - MAX_BY on a TIE of the key: Snowflake picks an arbitrary row and so does SQLite (here the first); the fixture has no ties.
//   - MAX_BY skips a NULL key, as MAX does: that is Snowflake's documented behaviour, assumed here and not observable in SQLite.
//   - Text ordering: SQLite compares bytes, Snowflake compares UTF-8 bytes, the client compares UTF-16 units; the fixture is ASCII,
//     where all three agree.
//   - Timestamps are 'YYYY-MM-DD HH:MM:SS' text here (the format the format-tiebreak orders by), a TIMESTAMP column in Snowflake.

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

/** `name(` at `start`: index of the matching `)` and the top-level comma-separated arguments, honouring nesting and quotes. */
function parseCall(sql: string, open: number): { close: number; args: string[] } {
  const args: string[] = [];
  let depth = 0;
  let quoted = false;
  let argStart = open + 1;
  for (let index = open; index < sql.length; index++) {
    const char = sql[index];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) {
        args.push(sql.slice(argStart, index).trim());
        return { close: index, args };
      }
    } else if (char === ',' && depth === 1) {
      args.push(sql.slice(argStart, index).trim());
      argStart = index + 1;
    }
  }
  throw new Error(`unbalanced call in: ${sql}`);
}

/** Rewrites every `name(...)` call (arguments may nest other calls) with `rewrite(args)`. */
function rewriteCalls(sql: string, name: string, rewrite: (args: string[]) => string): string {
  const pattern = new RegExp(`\\b${name}\\(`);
  let result = sql;
  for (let match = pattern.exec(result); match; match = pattern.exec(result)) {
    const open = match.index + name.length;
    const { close, args } = parseCall(result, open);
    result = result.slice(0, match.index) + rewrite(args) + result.slice(close + 1);
  }
  return result;
}

function toSqlite(sql: string): string {
  let translated = sql.replaceAll('ANALYTICS.PLATINUM_LFX_ONE.', '').replaceAll('IFF(', 'IIF(');
  translated = rewriteCalls(translated, 'LEFT', ([value, length]) => `SUBSTR(${value}, 1, ${length})`);
  translated = rewriteCalls(translated, 'BOOLOR_AGG', ([condition]) => `MAX(${condition})`);
  translated = rewriteCalls(translated, 'COUNT_IF', ([condition]) => `COUNT(CASE WHEN ${condition} THEN 1 END)`);
  // Inside the subquery the unqualified columns bind to the inner `pair_rows`; the correlation names the outer GROUP BY table.
  return rewriteCalls(
    translated,
    'MAX_BY',
    ([value, key]) =>
      `(SELECT ${value} FROM rows_in_range AS pair_rows WHERE pair_rows.PERSON_KEY = rows_in_range.PERSON_KEY AND pair_rows.COURSE_KEY = rows_in_range.COURSE_KEY AND (${key}) IS NOT NULL ORDER BY ${key} DESC LIMIT 1)`
  );
}

interface TrainingRow {
  account: string;
  person: string;
  courseOrCertId: string;
  courseId: string | null;
  status: string;
  activityTs: string | null;
  productType: string | null;
  foundationId: string | null;
  foundationName: string | null;
  projectId: string | null;
  projectName: string | null;
  courseName: string | null;
  courseLevel: string | null;
  courseFormat: string | null;
  onPeopleList: boolean;
}

const base: Omit<TrainingRow, 'person' | 'courseOrCertId' | 'courseId' | 'status' | 'activityTs'> = {
  account: ACCOUNT,
  productType: 'Training',
  foundationId: 'f-a',
  foundationName: 'Foundation A',
  projectId: 'proj-a',
  projectName: 'Project A',
  courseName: 'Intro to K8s',
  courseLevel: 'Beginner',
  courseFormat: 'E-Learning',
  onPeopleList: true,
};

function row(fields: Partial<TrainingRow> & Pick<TrainingRow, 'person' | 'courseOrCertId' | 'status' | 'activityTs'>): TrainingRow {
  return { ...base, courseId: fields.courseOrCertId, ...fields };
}

const CKA = { productType: 'Certification', courseName: 'Kubernetes Admin', courseId: 'cka' };

/**
 * Synthetic rows. Pairs, as the rule resolves them:
 *   p1|cka     Certified   Certification  Intermediate  E-Learning (latest non-null)  proj-b (greatest)  f-a   re-enrolled after the certificate
 *   p1|intro   Enrolled    Training       Beginner      E-Learning                    proj-a             f-a   course name written with surrounding spaces
 *   p2|cka     Certified   Certification  Intermediate  Exam                          proj-b             f-a
 *   p2|intro   Certified   Training       Beginner      E-Learning                    proj-a             f-a
 *   p2|cloud-1 Certified   no product     no level/format/name   proj-c  f-b           no COURSE_ID: keyed on the enrollment id
 *   p3|intro   Enrolled    Training       Beginner      E-Learning                    proj-a             f-a
 *   p3|web     Certified   Training       Advanced      Self-Paced (the certificate has none)  proj-c  f-c (greatest id; the enrollment says f-b)
 *   p3|cks     Enrolled    Certification  Advanced      Exam                          proj-b             f-a
 * Rows that no number may count: another organization, a learner off the people list, an unknown status and an undated row.
 */
const ROWS: TrainingRow[] = [
  // p1 | cka: the enrollment is Beginner / blank format / proj-a, the later certificate Intermediate / Exam / proj-b, then a re-enrollment.
  row({ person: 'p1', ...CKA, courseOrCertId: 'p1-cka-enrolled', status: 'Enrolled', activityTs: '2026-03-01 00:00:00', courseFormat: '   ' }),
  row({
    person: 'p1',
    ...CKA,
    courseOrCertId: 'p1-cka-certified',
    status: 'Certified',
    activityTs: '2026-04-01 00:00:00',
    courseLevel: 'Intermediate',
    courseFormat: 'Exam',
    projectId: 'proj-b',
    projectName: 'Project B',
  }),
  row({ person: 'p1', ...CKA, courseOrCertId: 'p1-cka-again', status: 'Enrolled', activityTs: '2026-05-01 00:00:00' }),
  row({ person: 'p1', courseOrCertId: 'p1-intro', courseId: 'intro', status: 'Enrolled', activityTs: '2026-02-01 00:00:00', courseName: ' Intro to K8s ' }),
  // p2
  row({
    person: 'p2',
    ...CKA,
    courseOrCertId: 'p2-cka',
    status: 'Certified',
    activityTs: '2026-04-10 00:00:00',
    courseLevel: 'Intermediate',
    courseFormat: 'Exam',
    projectId: 'proj-b',
    projectName: 'Project B',
  }),
  row({ person: 'p2', courseOrCertId: 'p2-intro', courseId: 'intro', status: 'Certified', activityTs: '2026-03-05 00:00:00' }),
  row({
    person: 'p2',
    courseOrCertId: 'cloud-1',
    courseId: null,
    status: 'Enrolled',
    activityTs: '2026-03-20 00:00:00',
    productType: null,
    foundationId: 'f-b',
    foundationName: 'Foundation B',
    projectId: 'proj-c',
    projectName: 'Project C',
    courseName: null,
    courseLevel: null,
    courseFormat: null,
  }),
  row({
    person: 'p2',
    courseOrCertId: 'cloud-1',
    courseId: null,
    status: 'Certified',
    activityTs: '2026-03-25 00:00:00',
    productType: null,
    foundationId: 'f-b',
    foundationName: 'Foundation B',
    projectId: 'proj-c',
    projectName: 'Project C',
    courseName: null,
    courseLevel: null,
    courseFormat: null,
  }),
  // p3
  row({ person: 'p3', courseOrCertId: 'p3-intro', courseId: 'intro', status: 'Enrolled', activityTs: '2026-01-10 00:00:00' }),
  row({
    person: 'p3',
    courseOrCertId: 'p3-web-enrolled',
    courseId: 'web',
    status: 'Enrolled',
    activityTs: '2026-01-20 00:00:00',
    productType: null,
    foundationId: 'f-b',
    foundationName: 'Foundation B',
    projectId: 'proj-c',
    projectName: 'Project C',
    courseName: 'Web Basics',
    courseLevel: 'Advanced',
    courseFormat: 'Self-Paced',
  }),
  row({
    person: 'p3',
    courseOrCertId: 'p3-web-certified',
    courseId: 'web',
    status: 'Certified',
    activityTs: '2026-02-15 00:00:00',
    foundationId: 'f-c',
    foundationName: 'Foundation C',
    projectId: 'proj-c',
    projectName: 'Project C',
    courseName: 'Web Basics',
    courseLevel: 'Advanced',
    courseFormat: null,
  }),
  row({
    person: 'p3',
    courseOrCertId: 'p3-cks',
    courseId: 'cks',
    status: 'Enrolled',
    activityTs: '2026-04-15 00:00:00',
    productType: 'Certification',
    projectId: 'proj-b',
    projectName: 'Project B',
    courseName: 'Kubernetes Security',
    courseLevel: 'Advanced',
    courseFormat: 'Exam',
  }),
  // Never counted.
  row({ person: 'p1', ...CKA, courseOrCertId: 'other-account-row', status: 'Certified', activityTs: '2026-04-02 00:00:00', account: OTHER_ACCOUNT }),
  row({ person: 'p4', courseOrCertId: 'off-list', courseId: 'intro', status: 'Certified', activityTs: '2026-04-03 00:00:00', onPeopleList: false }),
  // Learners off the people list: p4 (above) and p5 are outside learners; p1 is also on the list (one person); p6 is undated, p7 is another organization's.
  row({ person: 'p5', courseOrCertId: 'off-list-enrolled', courseId: 'intro', status: 'Enrolled', activityTs: '2026-04-05 00:00:00', onPeopleList: false }),
  row({ person: 'p1', courseOrCertId: 'off-list-same-key', courseId: 'intro', status: 'Enrolled', activityTs: '2026-04-06 00:00:00', onPeopleList: false }),
  row({ person: 'p6', courseOrCertId: 'off-list-undated', courseId: 'intro', status: 'Enrolled', activityTs: null, onPeopleList: false }),
  row({
    person: 'p7',
    courseOrCertId: 'off-list-other-account',
    courseId: 'intro',
    status: 'Enrolled',
    activityTs: '2026-04-07 00:00:00',
    onPeopleList: false,
    account: OTHER_ACCOUNT,
  }),
  row({ person: 'p1', courseOrCertId: 'unknown-status', courseId: 'ghost-one', status: 'Dropped', activityTs: '2026-04-04 00:00:00' }),
  row({ person: 'p1', courseOrCertId: 'undated', courseId: 'ghost-two', status: 'Enrolled', activityTs: null }),
];

/** The rows the organization's people list counts: this account, on the list, a known status, a date. */
const COUNTED = ROWS.filter((r) => r.account === ACCOUNT && r.onPeopleList && (r.status === 'Enrolled' || r.status === 'Certified') && r.activityTs !== null);

/** Written from the rule's description alone: people with a dated, known-status row off the people list who have no people-list row in the same counted set. */
function handOutsidePeople(): number {
  const onList = new Set(COUNTED.map((r) => r.person));
  const outside = ROWS.filter(
    (r) => r.account === ACCOUNT && !r.onPeopleList && (r.status === 'Enrolled' || r.status === 'Certified') && r.activityTs !== null && !onList.has(r.person)
  );
  return new Set(outside.map((r) => r.person)).size;
}

/** A warehouse row as the Trainees detail read hands it to the client (the mirror's input). */
function toDetail(r: TrainingRow): OrgTraineeDetailRow {
  return {
    personKey: r.person,
    status: r.status === 'Certified' ? 'Certified' : 'Enrolled',
    courseOrCertId: r.courseOrCertId,
    courseId: r.courseId ?? r.courseOrCertId,
    courseName: r.courseName,
    foundationId: r.foundationId,
    foundationName: r.foundationName,
    projectId: r.projectId,
    projectName: r.projectName,
    courseLevel: r.courseLevel,
    courseFormat: r.courseFormat,
    productType: r.productType,
    activityTs: `${r.activityTs!.replace(' ', 'T')}.000Z`,
  };
}

interface Expected {
  coursesTaken: number;
  certifications: number;
  trainingsCompleted: number;
  coursesInProgress: number;
  people: number;
  certifiedPeople: number;
  peopleInTraining: number;
}

interface HandPair {
  person: string;
  certified: boolean;
  product: string | null;
  foundationId: string | null;
  projectId: string | null;
  courseName: string | null;
  level: string | null;
  format: string | null;
}

/** A free-text attribute as the pairs rule reads it: spaces trimmed, blank is none. */
function clean(value: string | null): string | null {
  const trimmed = (value ?? '').replace(/^ +| +$/g, '');
  return trimmed === '' ? null : trimmed;
}

/** The greatest of the non-null values, by plain code point order. */
function greatest(values: (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null).sort();
  return present.length > 0 ? present[present.length - 1] : null;
}

/** Written from the rule's description alone (see `buildOrgTrainingPairsCte`), sharing no code with the SQL or the client mirror. */
function handPairs(): HandPair[] {
  const groups = new Map<string, TrainingRow[]>();
  for (const r of COUNTED) {
    const key = `${r.person}\u0000${r.courseId ?? r.courseOrCertId}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((rows) => {
    // The id the foundation / project comes from: the greatest one on any row.
    const foundationId = greatest(rows.map((r) => r.foundationId));
    const projectId = greatest(rows.map((r) => r.projectId));
    // The format: the latest row that has one.
    const withFormat = rows.filter((r) => clean(r.courseFormat) !== null).sort((a, b) => b.activityTs!.localeCompare(a.activityTs!));
    return {
      person: rows[0].person,
      certified: rows.some((r) => r.status === 'Certified'),
      product: greatest(rows.map((r) => r.productType)),
      foundationId,
      projectId,
      courseName: greatest(rows.map((r) => clean(r.courseName))),
      level: greatest(rows.map((r) => clean(r.courseLevel))),
      format: withFormat.length > 0 ? clean(withFormat[0].courseFormat) : null,
    };
  });
}

function handCount(query: OrgTrainingStatsQuery): Expected {
  const kept = handPairs().filter(
    (pair) =>
      (query.foundation === null || pair.foundationId === query.foundation) &&
      (query.project === null || pair.projectId === query.project) &&
      (query.course === null || pair.courseName === query.course) &&
      (query.level === null || pair.level === query.level) &&
      (query.format === null || pair.format === query.format)
  );
  const certified = kept.filter((pair) => pair.certified);
  const isCertification = (pair: HandPair) => pair.product === 'Certification';
  const people = (pairs: HandPair[]) => new Set(pairs.map((pair) => pair.person)).size;
  return {
    coursesTaken: kept.length,
    certifications: certified.filter(isCertification).length,
    trainingsCompleted: certified.filter((pair) => !isCertification(pair)).length,
    coursesInProgress: kept.filter((pair) => !pair.certified).length,
    people: people(kept),
    certifiedPeople: people(certified.filter(isCertification)),
    peopleInTraining: people(kept.filter((pair) => !pair.certified)),
  };
}

function mirrorCount(query: OrgTrainingStatsQuery): Expected {
  const pairs = resolveOrgTraineePairs(COUNTED.map(toDetail)).filter((pair) => matchesOrgTrainingFilters(pair, query));
  const counts = countOrgTraineePairs(pairs);
  const keysOf = (selected: typeof pairs) => new Set(selected.map((pair) => pair.personKey)).size;
  return {
    coursesTaken: counts.coursesTaken,
    certifications: counts.certifications,
    trainingsCompleted: counts.trainingsCompleted,
    coursesInProgress: counts.inProgress,
    people: keysOf(pairs),
    certifiedPeople: keysOf(pairs.filter((pair) => pair.status === 'Certified' && pair.productType === 'Certification')),
    peopleInTraining: keysOf(pairs.filter((pair) => pair.status === 'Enrolled')),
  };
}

const NONE = { foundation: null, project: null, course: null, level: null, format: null };
const query = (filters: Partial<OrgTrainingStatsQuery>): OrgTrainingStatsQuery => ({ range: 'all', ...NONE, ...filters });

let database: SqlDatabase;
let service: OrgLensTrainingService;

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE ORG_PEOPLE_TRAINING (
      ACCOUNT_ID TEXT, PERSON_KEY TEXT, COURSE_OR_CERT_ID TEXT, COURSE_ID TEXT, STATUS TEXT, ACTIVITY_TS TEXT, PRODUCT_TYPE TEXT,
      FOUNDATION_ID TEXT, FOUNDATION_NAME TEXT, PROJECT_ID TEXT, PROJECT_NAME TEXT, COURSE_NAME TEXT, COURSE_LEVEL TEXT, COURSE_FORMAT TEXT,
      IS_ON_PEOPLE_LIST INTEGER, DBT_RUN_AT TEXT
    );
    CREATE TABLE ORG_TRAINING_ROSTER_MEMBERS (ACCOUNT_ID TEXT, ROSTER_MEMBERS INTEGER, AS_OF_TS TEXT);
  `);
  const insert = database.prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of ROWS) {
    insert.run(
      r.account,
      r.person,
      r.courseOrCertId,
      r.courseId,
      r.status,
      r.activityTs,
      r.productType,
      r.foundationId,
      r.foundationName,
      r.projectId,
      r.projectName,
      r.courseName,
      r.courseLevel,
      r.courseFormat,
      r.onPeopleList ? 1 : 0,
      '2026-10-30 04:15:00'
    );
  }

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

describe('pairs SQL run against SQLite over mixed-attribute rows', () => {
  it('translates the Snowflake-only constructs the pairs SQL uses, and leaves none behind', () => {
    const { cte } = buildOrgTrainingPairsCte(ACCOUNT, query({}));
    for (const construct of ['BOOLOR_AGG', 'MAX_BY', 'IFF(', 'LEFT(']) expect(cte).toContain(construct);

    const translated = toSqlite(cte);
    for (const construct of ['BOOLOR_AGG', 'MAX_BY', 'IFF(', 'LEFT(', 'COUNT_IF', 'ANALYTICS.']) expect(translated).not.toContain(construct);
  });

  it('keeps the rows no number may count out of the fixture counts', () => {
    expect(ROWS.length - COUNTED.length).toBe(8);
    // Outside learners: p4 and p5 only (p1 is on the list, p6 is undated, p7 belongs to another organization).
    expect(handOutsidePeople()).toBe(2);
    expect(handPairs()).toHaveLength(8);
  });

  // [label, filters, courses taken, certifications, trainings completed, in progress, people, certified people, people in training]
  // Counted by hand from the pair table above ROWS; the SQL and the client mirror must reproduce every row.
  it.each<[string, Partial<OrgTrainingStatsQuery>, number, number, number, number, number, number, number]>([
    ['default (no filter)', {}, 8, 2, 3, 3, 3, 2, 2],
    ['level Intermediate', { level: 'Intermediate' }, 2, 2, 0, 0, 2, 2, 0],
    ['level Beginner', { level: 'Beginner' }, 3, 0, 1, 2, 3, 0, 2],
    ['level Advanced', { level: 'Advanced' }, 2, 0, 1, 1, 1, 0, 1],
    ['format E-Learning', { format: 'E-Learning' }, 4, 1, 1, 2, 3, 1, 2],
    ['format Exam', { format: 'Exam' }, 2, 1, 0, 1, 2, 1, 1],
    ['format Self-Paced', { format: 'Self-Paced' }, 1, 0, 1, 0, 1, 0, 0],
    ['project proj-a', { project: 'proj-a' }, 3, 0, 1, 2, 3, 0, 2],
    ['project proj-b', { project: 'proj-b' }, 3, 2, 0, 1, 3, 2, 1],
    ['project proj-c', { project: 'proj-c' }, 2, 0, 2, 0, 2, 0, 0],
    ['course Intro to K8s (name written with spaces on one row)', { course: 'Intro to K8s' }, 3, 0, 1, 2, 3, 0, 2],
    ['course Kubernetes Admin', { course: 'Kubernetes Admin' }, 2, 2, 0, 0, 2, 2, 0],
    ['foundation f-a', { foundation: 'f-a' }, 6, 2, 1, 3, 3, 2, 2],
    ['foundation f-b (the web pair enrollment says f-b but the pair resolves to f-c)', { foundation: 'f-b' }, 1, 0, 1, 0, 1, 0, 0],
    ['foundation f-c (greatest id of the pair)', { foundation: 'f-c' }, 1, 0, 1, 0, 1, 0, 0],
    ['combination level + format + project', { level: 'Advanced', format: 'Exam', project: 'proj-b' }, 1, 0, 0, 1, 1, 0, 1],
    [
      'combination foundation + level + format + project + course',
      { foundation: 'f-a', level: 'Beginner', format: 'E-Learning', project: 'proj-a', course: 'Intro to K8s' },
      3,
      0,
      1,
      2,
      3,
      0,
      2,
    ],
    [
      'mixed pair: the enrollment level Beginner no longer matches the pair resolved to Intermediate with proj-b',
      { level: 'Beginner', project: 'proj-b' },
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ],
    ['mixed pair: the certificate level and project match it whole', { level: 'Intermediate', project: 'proj-b', format: 'Exam' }, 1, 1, 0, 0, 1, 1, 0],
    [
      'mixed pair: the re-enrollment format E-Learning (the latest non-null) is the pair format',
      { level: 'Intermediate', format: 'E-Learning' },
      1,
      1,
      0,
      0,
      1,
      1,
      0,
    ],
    ['a combination no pair carries', { foundation: 'f-b', level: 'Advanced' }, 0, 0, 0, 0, 0, 0, 0],
  ])(
    '%s: SQL stats = client mirror = hand count',
    async (_label, filters, coursesTaken, certifications, trainingsCompleted, inProgress, people, certifiedPeople, peopleInTraining) => {
      const q = query(filters);
      const literal: Expected = { coursesTaken, certifications, trainingsCompleted, coursesInProgress: inProgress, people, certifiedPeople, peopleInTraining };

      const stats = await service.getTrainingStats(ACCOUNT, q, 'auditor-entitlement');

      // The learners off the people list are their own number, only while no filter is set; they never enter the people count.
      const outside = Object.values(filters).some((value) => value !== undefined) ? null : handOutsidePeople();
      const fromSql: Expected = {
        coursesTaken: stats.coursesTaken,
        certifications: stats.certifications,
        trainingsCompleted: stats.trainingsCompleted,
        coursesInProgress: stats.coursesInProgress,
        people: stats.peopleWithTrainingActivity,
        certifiedPeople: stats.certifiedPeople,
        peopleInTraining: stats.peopleInTraining,
      };
      expect(stats.learnersOutsidePeopleList).toBe(outside);
      expect(fromSql).toEqual(literal);
      expect(handCount(q)).toEqual(literal);
      expect(mirrorCount(q)).toEqual(literal);
      expect(stats.coursesTaken).toBe(stats.certifications + stats.trainingsCompleted + stats.coursesInProgress);

      // The pairs statement itself ran against the table, not a stub.
      expect(execute.mock.calls.some(([sql]) => (sql as string).includes('rows_in_range AS') && (sql as string).includes('COUNT_IF'))).toBe(true);
    }
  );

  it('counts people on the people list only, and the learners outside it as their own number (0 with any filter)', async () => {
    const unfiltered = await service.getTrainingStats(ACCOUNT, query({}), 'auditor-entitlement');
    expect(unfiltered.peopleWithTrainingActivity).toBe(new Set(COUNTED.map((r) => r.person)).size);
    expect(unfiltered.peopleWithTrainingActivity).toBe(handCount(query({})).people);
    expect(unfiltered.learnersOutsidePeopleList).toBe(handOutsidePeople());
    expect(unfiltered.learnersOutsidePeopleList).toBe(2);

    for (const filters of [{ level: 'Beginner' }, { foundation: 'f-a' }, { project: 'proj-a' }, { course: 'Intro to K8s' }, { format: 'E-Learning' }]) {
      const filtered = await service.getTrainingStats(ACCOUNT, query(filters), 'auditor-entitlement');
      expect(filtered.learnersOutsidePeopleList, JSON.stringify(filters)).toBeNull();
      expect(filtered.peopleWithTrainingActivity, JSON.stringify(filters)).toBe(handCount(query(filters)).people);
    }
  });

  it('resolves each pair attribute across all its in-range rows, as the hand-written rule does (MAX, MAX_BY by id, latest non-null format)', async () => {
    const { cte, binds } = buildOrgTrainingPairsCte(ACCOUNT, query({}));
    const sql = `
      WITH ${cte}
      SELECT PERSON_KEY, COURSE_KEY, IS_CERTIFIED, PRODUCT_TYPE, FOUNDATION_ID, FOUNDATION_NAME, PROJECT_ID, PROJECT_NAME, COURSE_NAME, COURSE_LEVEL, COURSE_FORMAT
      FROM f
      ORDER BY PERSON_KEY, COURSE_KEY
    `;
    const { rows } = await execute.getMockImplementation()!(sql, binds);

    const pair = (person: string, course: string) =>
      rows.find((result: Record<string, unknown>) => result['PERSON_KEY'] === person && result['COURSE_KEY'] === course);
    // Written out, not derived: the pair table above ROWS.
    expect(rows).toHaveLength(8);
    expect(pair('p1', 'cka')).toMatchObject({
      IS_CERTIFIED: 1,
      PRODUCT_TYPE: 'Certification',
      COURSE_LEVEL: 'Intermediate',
      COURSE_FORMAT: 'E-Learning',
      PROJECT_ID: 'proj-b',
      PROJECT_NAME: 'Project B',
    });
    expect(pair('p1', 'intro')).toMatchObject({ IS_CERTIFIED: 0, COURSE_NAME: 'Intro to K8s' });
    expect(pair('p2', 'cka')).toMatchObject({ IS_CERTIFIED: 1, COURSE_FORMAT: 'Exam' });
    expect(pair('p2', 'cloud-1')).toMatchObject({
      IS_CERTIFIED: 1,
      PRODUCT_TYPE: null,
      COURSE_NAME: null,
      COURSE_LEVEL: null,
      COURSE_FORMAT: null,
      FOUNDATION_ID: 'f-b',
      PROJECT_ID: 'proj-c',
    });
    expect(pair('p3', 'web')).toMatchObject({
      IS_CERTIFIED: 1,
      PRODUCT_TYPE: 'Training',
      COURSE_FORMAT: 'Self-Paced',
      FOUNDATION_ID: 'f-c',
      FOUNDATION_NAME: 'Foundation C',
    });
    expect(pair('p3', 'cks')).toMatchObject({ IS_CERTIFIED: 0, PRODUCT_TYPE: 'Certification', COURSE_FORMAT: 'Exam' });

    // And the hand-written rule and the client mirror resolve the same attributes.
    const mirror = resolveOrgTraineePairs(COUNTED.map(toDetail));
    for (const result of rows as Record<string, unknown>[]) {
      const resolved = mirror.find((candidate) => candidate.personKey === result['PERSON_KEY'] && candidate.courseId === result['COURSE_KEY'])!;
      expect(resolved).toMatchObject({
        status: result['IS_CERTIFIED'] === 1 ? 'Certified' : 'Enrolled',
        productType: result['PRODUCT_TYPE'],
        foundationId: result['FOUNDATION_ID'],
        foundationName: result['FOUNDATION_NAME'],
        projectId: result['PROJECT_ID'],
        projectName: result['PROJECT_NAME'],
        courseName: result['COURSE_NAME'],
        courseLevel: result['COURSE_LEVEL'],
        courseFormat: result['COURSE_FORMAT'],
      });
    }
  });

  it('answers a filter value no row carries with zero pair stats, never binding that value into a statement', async () => {
    const stats = await service.getTrainingStats(ACCOUNT, query({ level: 'Expert' }), 'auditor-entitlement');

    expect([stats.coursesTaken, stats.peopleWithTrainingActivity, stats.certifications]).toEqual([0, 0, 0]);
    expect(execute.mock.calls.some(([, binds]) => (binds as string[]).includes('Expert'))).toBe(false);
  });
});

describe('the 200-character cutoff of a pair attribute (idempotent normalization)', () => {
  // A name whose 200th character is a space once cut: `x` x199, then ` suffix`.
  const CUT_NAME = `${'x'.repeat(199)} suffix`;
  const OFFERED = 'x'.repeat(199);

  function insertCutRow(): void {
    database
      .prepare('INSERT INTO ORG_PEOPLE_TRAINING VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        ACCOUNT,
        'p-cut',
        'cut-course',
        'cut-course',
        'Enrolled',
        '2026-10-01 00:00:00',
        'Training',
        'f-a',
        'Foundation A',
        'proj-a',
        'Project A',
        CUT_NAME,
        ' Beginner ',
        'E-Learning',
        1,
        '2026-10-30 04:15:00'
      );
  }

  it('trims again after the cut, so the pair carries the value the dropdown offers and a request for it matches', async () => {
    insertCutRow();
    const { cte, binds } = buildOrgTrainingPairsCte(ACCOUNT, query({}));
    const { rows } = await execute.getMockImplementation()!(`WITH ${cte} SELECT COURSE_NAME, COURSE_LEVEL FROM f WHERE PERSON_KEY = 'p-cut'`, binds);

    expect(rows).toEqual([{ COURSE_NAME: OFFERED, COURSE_LEVEL: 'Beginner' }]);
    expect(normalizeOrgTrainingFilterValue(OFFERED)).toBe(OFFERED);
    expect(normalizeOrgTrainingFilterValue(CUT_NAME)).toBe(OFFERED);

    const stats = await service.getTrainingStats(ACCOUNT, query({ course: OFFERED }), 'auditor-entitlement');
    expect(stats.coursesTaken).toBe(1);
  });
});
