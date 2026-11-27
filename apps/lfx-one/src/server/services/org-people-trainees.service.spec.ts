// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, cacheValues } = vi.hoisted(() => ({
  execute: vi.fn(),
  cacheValues: new Map<string, string>(),
}));

// The real `@lfx-one/shared/utils` barrel transitively pulls Angular-only code that can't load in
// this server-only vitest environment. Spread the submodules this path actually uses — the real
// implementations, so the cache round trip below exercises the true encode/decode, not stubs.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/compact-cache.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute }) },
}));
// A minimal in-memory Valkey so a write really is serialized and a read really is parsed back —
// the only way a warm-vs-cold divergence can show up at all.
vi.mock('ioredis', () => ({
  default: class {
    public status = 'ready';
    public on(): this {
      return this;
    }
    public async get(key: string): Promise<string | null> {
      return cacheValues.get(key) ?? null;
    }
    public async set(key: string, value: string): Promise<void> {
      cacheValues.set(key, value);
    }
    public async quit(): Promise<void> {
      /* No connection in this fixture. */
    }
  },
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn() }));
vi.mock('./logger.service', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));

import type { CompactOrgTraineesRawCache } from '@lfx-one/shared/interfaces';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgPeopleTraineesService } from './org-people-trainees.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = SYNTHETIC_ORG_ACCOUNT_ID;

type Row = Record<string, unknown>;

const pairRow = (personKey: string, courseKey: string, overrides: Row = {}): Row => ({
  PERSON_KEY: personKey,
  COURSE_KEY: courseKey,
  IS_CERTIFIED: false,
  PRODUCT_TYPE: 'Certification',
  COURSE_NAME: 'Project Fundamentals',
  COURSE_LEVEL: 'Beginner',
  COURSE_FORMAT: 'E-Learning',
  FOUNDATION_ID: 'foundation-one',
  FOUNDATION_NAME: 'Foundation One',
  PROJECT_ID: 'project-one',
  PROJECT_NAME: 'Project One',
  LAST_ACTIVITY_TS: '2026-05-01 08:00:00',
  ...overrides,
});

const dateRow = (personKey: string, courseId: string | null, courseOrCertId: string, status: string, activityTs: string | null): Row => ({
  PERSON_KEY: personKey,
  COURSE_ID: courseId,
  COURSE_OR_CERT_ID: courseOrCertId,
  STATUS: status,
  ACTIVITY_TS: activityTs,
});

interface Warehouse {
  identities: Row[];
  pairs: Row[];
  dates: Row[];
  outside: Row[];
  asOf: string | null;
}

const baseWarehouse = (): Warehouse => ({
  identities: [
    { PERSON_KEY: 'person-one', LFID: 'lfid-one', CDP_MEMBER_ID: 'cdp-1', NAME: 'Person One', TITLE: 'Engineer', EMAIL: 'person-one@example.com' },
    { PERSON_KEY: 'person-two', LFID: null, CDP_MEMBER_ID: null, NAME: null, TITLE: null, EMAIL: null },
  ],
  pairs: [
    pairRow('person-one', 'course-one', { IS_CERTIFIED: true, COURSE_FORMAT: null }),
    pairRow('person-two', 'course-one', { LAST_ACTIVITY_TS: '2026-03-01 08:00:00' }),
    pairRow('person-two', 'enroll-two', {
      PRODUCT_TYPE: 'Training',
      COURSE_NAME: null,
      COURSE_LEVEL: null,
      COURSE_FORMAT: 'Instructor Led',
      FOUNDATION_ID: null,
      FOUNDATION_NAME: null,
      PROJECT_ID: null,
      PROJECT_NAME: null,
      LAST_ACTIVITY_TS: '2026-02-01 08:00:00',
    }),
  ],
  dates: [
    dateRow('person-one', 'course-one', 'cert-one', 'Certified', '2026-04-12 10:30:00'),
    dateRow('person-one', 'course-one', 'enroll-one-again', 'Enrolled', '2026-05-01 08:00:00'),
    dateRow('person-two', 'course-one', 'enroll-one', 'Enrolled', '2026-03-01 08:00:00'),
    dateRow('person-two', null, 'enroll-two', 'Enrolled', '2026-02-01 08:00:00'),
    dateRow('person-two', 'course-orphan', 'enroll-orphan', 'Enrolled', '2026-01-01 08:00:00'),
  ],
  outside: [{ LEARNER_NAME: 'Outside Learner', IS_CERTIFIED: false }],
  asOf: '2026-10-30 04:15:00',
});

function serve(warehouse: Warehouse): void {
  execute.mockImplementation(async (query: string) => {
    if (query.includes('ORG_PEOPLE_ALL_RANGES')) return { rows: warehouse.identities };
    if (query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) return { rows: warehouse.outside };
    if (/SELECT MAX\(DBT_RUN_AT\) AS AS_OF/.test(query)) return { rows: [{ AS_OF: warehouse.asOf }] };
    if (query.includes('LAST_ACTIVITY_TS')) return { rows: warehouse.pairs };
    if (query.includes('COURSE_OR_CERT_ID')) return { rows: warehouse.dates };
    throw new Error(`unexpected read: ${query}`);
  });
}

const queries = (): string[] => execute.mock.calls.map(([sql]) => sql as string);
const callFor = (match: (sql: string) => boolean): [string, unknown[]] => execute.mock.calls.find(([sql]) => match(sql as string)) as [string, unknown[]];
const storedEntry = (): CompactOrgTraineesRawCache => JSON.parse([...cacheValues.values()][0]) as CompactOrgTraineesRawCache;

function corruptStored(corrupt: (stored: CompactOrgTraineesRawCache) => void): void {
  const [key] = [...cacheValues.keys()];
  const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
  corrupt(stored);
  cacheValues.set(key, JSON.stringify(stored));
}

let service: OrgPeopleTraineesService;

beforeEach(() => {
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  execute.mockReset();
  cacheValues.clear();
  ValkeyService.resetInstance();
  serve(baseWarehouse());
  service = new OrgPeopleTraineesService();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

describe('OrgPeopleTraineesService warehouse pairs (lfx-self-serve#6229)', () => {
  it('ships each pair as the warehouse resolves it: status, product type and course attributes, with no resolution of its own', async () => {
    const { pairs } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(pairs).toEqual([
      {
        personKey: 'person-one',
        courseId: 'course-one',
        status: 'Certified',
        productType: 'Certification',
        courseName: 'Project Fundamentals',
        courseLevel: 'Beginner',
        courseFormat: null,
        foundationId: 'foundation-one',
        foundationName: 'Foundation One',
        projectId: 'project-one',
        projectName: 'Project One',
        lastActivityTs: '2026-05-01T08:00:00.000Z',
      },
      expect.objectContaining({ personKey: 'person-two', courseId: 'course-one', status: 'Enrolled' }),
      expect.objectContaining({ personKey: 'person-two', courseId: 'enroll-two', productType: 'Training', courseName: null, projectId: null }),
    ]);
  });

  it('reads the pairs of the account, range and people list, and resolves nothing in SQL', async () => {
    await service.getTrainees(ACCOUNT, '90d', 'org-grant');

    const [sql, binds] = callFor((query) => query.includes('LAST_ACTIVITY_TS'));
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_PAIRS');
    expect(sql).toMatch(/WHERE ACCOUNT_ID = \?\s+AND TIME_RANGE = \?\s+AND IS_ON_PEOPLE_LIST/);
    expect(binds).toEqual([ACCOUNT, '90d']);
    for (const resolution of ['GROUP BY', 'BOOLOR_AGG', 'MAX(', 'MAX_BY(', 'DATEADD']) {
      expect(sql).not.toContain(resolution);
    }
  });

  it('ships date rows keyed on their pair, the certificate id standing in for a missing course id, and drops a row of no pair', async () => {
    const { details } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(details.map(({ personKey, courseId, status, activityTs }) => ({ personKey, courseId, status, activityTs }))).toEqual([
      { personKey: 'person-one', courseId: 'course-one', status: 'Certified', activityTs: '2026-04-12T10:30:00.000Z' },
      { personKey: 'person-one', courseId: 'course-one', status: 'Enrolled', activityTs: '2026-05-01T08:00:00.000Z' },
      { personKey: 'person-two', courseId: 'course-one', status: 'Enrolled', activityTs: '2026-03-01T08:00:00.000Z' },
      { personKey: 'person-two', courseId: 'enroll-two', status: 'Enrolled', activityTs: '2026-02-01T08:00:00.000Z' },
    ]);
    expect(JSON.stringify(details)).not.toMatch(/cert-one|enroll-one-again|course-orphan/);
  });

  it('keeps the legacy course attributes on every date row, copied from its pair, for clients loaded before pairs were served', async () => {
    const { details } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(details[0]).toEqual({
      personKey: 'person-one',
      courseId: 'course-one',
      status: 'Certified',
      activityTs: '2026-04-12T10:30:00.000Z',
      productType: 'Certification',
      courseName: 'Project Fundamentals',
      courseLevel: 'Beginner',
      courseFormat: null,
      foundationId: 'foundation-one',
      foundationName: 'Foundation One',
      projectId: 'project-one',
      projectName: 'Project One',
    });
    expect(details[3]).toEqual(expect.objectContaining({ courseId: 'enroll-two', productType: 'Training', courseName: null, projectId: null }));
  });

  it('drops a date row with an unknown status or no parseable date', async () => {
    const warehouse = baseWarehouse();
    warehouse.dates.push(dateRow('person-one', 'course-one', 'dropped', 'Dropped', '2026-06-01 08:00:00'));
    warehouse.dates.push(dateRow('person-one', 'course-one', 'undated', 'Enrolled', null));
    serve(warehouse);

    const { details } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(details).toHaveLength(4);
  });

  it.each([
    ['30d', 30],
    ['90d', 90],
    ['365d', 365],
    ['730d', 730],
  ] as const)('windows the date rows from the day the pairs were built for %s, never from today', async (range, days) => {
    await service.getTrainees(ACCOUNT, range, 'org-grant');

    const [sql, binds] = callFor((query) => query.includes('COURSE_OR_CERT_ID'));
    expect(sql).toContain(
      `AND ACTIVITY_TS >= DATEADD(day, -${days}, TO_DATE((SELECT MAX(DBT_RUN_AT) FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_PAIRS WHERE ACCOUNT_ID = ?)))`
    );
    expect(sql).toMatch(/AND IS_ON_PEOPLE_LIST\s+AND STATUS IN \('Enrolled', 'Certified'\)\s+AND ACTIVITY_TS IS NOT NULL/);
    expect(binds).toEqual([ACCOUNT, ACCOUNT]);
    for (const query of queries()) {
      expect(query).not.toContain('CURRENT_DATE');
    }
  });

  it('reads all-time date rows without a date predicate', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    const [sql, binds] = callFor((query) => query.includes('COURSE_OR_CERT_ID'));
    expect(sql).not.toContain('ACTIVITY_TS >=');
    expect(binds).toEqual([ACCOUNT]);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('states the build time of the pairs whatever the range, and null when the account has none', async () => {
    const narrow = await service.getTrainees(ACCOUNT, '30d', 'org-grant');
    const wide = await service.getTrainees(ACCOUNT, 'all', 'org-grant');
    const asOfRead = queries().find((sql) => /SELECT MAX\(DBT_RUN_AT\) AS AS_OF/.test(sql))!;

    expect(narrow.asOf).toBe('2026-10-30T04:15:00.000Z');
    expect(wide.asOf).toBe(narrow.asOf);
    expect(asOfRead).toContain('ORG_PEOPLE_TRAINING_PAIRS');
    expect(asOfRead).not.toContain('TIME_RANGE');

    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    expect((await service.getTrainees('another-account', '30d', 'org-grant')).asOf).toBeNull();
  });

  it('takes identity from the all-time ranges roster, limited to people with people-list pairs in the range', async () => {
    await service.getTrainees(ACCOUNT, '90d', 'org-grant');

    const [identity, binds] = callFor((query) => query.includes('ORG_PEOPLE_ALL_RANGES'));
    expect(identity).toContain("TIME_RANGE = 'all'");
    expect(identity).toContain("PROJECT_SCOPE = 'all'");
    expect(identity).toMatch(
      /PERSON_KEY IN \(\s*SELECT PERSON_KEY\s+FROM ANALYTICS\.PLATINUM_LFX_ONE\.ORG_PEOPLE_TRAINING_PAIRS\s+WHERE ACCOUNT_ID = \?\s+AND TIME_RANGE = \?\s+AND IS_ON_PEOPLE_LIST/
    );
    expect(binds).toEqual([ACCOUNT, ACCOUNT, '90d']);
  });

  // A former employee's ranges row carries a personal address; the Trainees tab must never send it. The fake warehouse
  // honours the predicate the way Snowflake would, so dropping `IS_FORMER = FALSE` lets the former row through.
  it('reads identity from current-employee rows only, so a former row and its address never reach the response', async () => {
    execute.mockImplementation(async (query: string) => {
      if (query.includes('ORG_PEOPLE_ALL_RANGES')) {
        const current = {
          PERSON_KEY: 'person-one',
          LFID: 'lfid-one',
          CDP_MEMBER_ID: null,
          NAME: 'Person One',
          TITLE: null,
          EMAIL: 'person-one@company.example',
        };
        const former = {
          PERSON_KEY: 'person-one',
          LFID: 'lfid-one',
          CDP_MEMBER_ID: null,
          NAME: 'Person One',
          TITLE: null,
          EMAIL: 'person-one@personal.example',
        };
        return { rows: /\bIS_FORMER = FALSE\b/.test(query) ? [current] : [current, former] };
      }
      return { rows: [] };
    });

    const response = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(response.trainees).toHaveLength(1);
    expect(response.trainees[0].email).toBe('person-one@company.example');
    expect(JSON.stringify(response)).not.toContain('person-one@personal.example');
  });

  it('caches each range under its own key', async () => {
    await service.getTrainees(ACCOUNT, '30d', 'org-grant');
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    await service.getTrainees(ACCOUNT, '30d', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(10);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v11:30d')!)).toBe(true);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v11:365d')!)).toBe(true);
  });
});

describe('OrgPeopleTraineesService compact cache (GH-1906)', () => {
  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    const fromMiss = await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    // `toStrictEqual` distinguishes null from undefined from an absent key; the serialized
    // comparison additionally pins key order, which `getTrainees`'s object literals fix and a
    // decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it('stores each course once and each date row by its pair, with no enrollment or certificate id', async () => {
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    const stored = storedEntry();
    expect(stored.pairs.r).toHaveLength(3);
    expect(stored.courses.r).toHaveLength(3);
    expect(stored.dates.r).toHaveLength(4);
    expect(stored.datePairs).toEqual([0, 0, 1, 2]);
    expect(JSON.stringify(stored)).not.toMatch(/cert-one|enroll-one-again|enroll-orphan/);
  });

  it('collapses pairs that share every course column into one dictionary entry', async () => {
    const warehouse = baseWarehouse();
    warehouse.pairs.push(pairRow('person-one', 'course-two', { IS_CERTIFIED: true, COURSE_FORMAT: null }));
    warehouse.pairs.push(pairRow('person-two', 'course-two', { IS_CERTIFIED: true, COURSE_FORMAT: null }));
    serve(warehouse);

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(storedEntry().pairs.r).toHaveLength(5);
    expect(storedEntry().courses.r).toHaveLength(4);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a tab with
    // holes in it for the rest of the TTL.
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    corruptStored((stored) => (stored.pairs.k = [...stored.pairs.k].reverse()));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it.each([
    [
      'a course index past the end of the dictionary',
      (stored: CompactOrgTraineesRawCache) => (stored.pairCourses = stored.pairCourses.map(() => stored.courses.r.length)),
    ],
    ['a negative course index', (stored: CompactOrgTraineesRawCache) => (stored.pairCourses = stored.pairCourses.map(() => -1))],
    ['a non-integer course index', (stored: CompactOrgTraineesRawCache) => (stored.pairCourses = stored.pairCourses.map(() => 1.5))],
    ['a course index array shorter than the pairs', (stored: CompactOrgTraineesRawCache) => (stored.pairCourses = stored.pairCourses.slice(0, -1))],
    ['a pair index past the end of the pairs', (stored: CompactOrgTraineesRawCache) => (stored.datePairs = stored.datePairs.map(() => stored.pairs.r.length))],
    ['a pair index array shorter than the rows', (stored: CompactOrgTraineesRawCache) => (stored.datePairs = stored.datePairs.slice(0, -1))],
  ])('treats a stored entry with %s as a miss', async (_label, corrupt) => {
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    corruptStored(corrupt);
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('round-trips an empty result unchanged', async () => {
    // The empty envelope has to survive its own guard: rejecting it would make an org with no rows
    // refetch on every request forever.
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    const fromHit = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  it.each([
    ['absent', '\u0000'],
    ['a number', 42],
    ['null', null],
  ])('treats a stored entry whose required pair PERSON_KEY cell is %s as a miss', async (_label, corrupt) => {
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    corruptStored((stored) => {
      const index = stored.pairs.k.indexOf('PERSON_KEY');
      stored.pairs.r = stored.pairs.r.map((row) => row.map((cell, position) => (position === index ? corrupt : cell)));
    });
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('caches a trainee row whose PERSON_KEY is null and an unnamed learner instead of missing forever', async () => {
    serve({
      ...baseWarehouse(),
      identities: [{ PERSON_KEY: null, LFID: null, CDP_MEMBER_ID: null, NAME: null, TITLE: null, EMAIL: null }],
      outside: [{ LEARNER_NAME: null, IS_CERTIFIED: null }],
    });
    const fromMiss = await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('treats an entry of the previous shape as a miss rather than decoding it', async () => {
    const previous = { traineeRows: { k: [], r: [] }, outsideLearnerRows: { k: [], r: [] }, courses: { k: [], r: [] }, details: { k: [], r: [] } };
    cacheValues.set(
      buildOrgCacheKey(ACCOUNT, 'people-trainees:v11:365d')!,
      JSON.stringify({ ...previous, detailCourses: [], formerOnPeopleList: { people: 0, pairs: 0 }, asOf: null })
    );

    const response = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
    expect(response.pairs).toHaveLength(3);
  });

  it('treats an entry without the build time as a miss, so the as-of date is never dropped for a TTL', async () => {
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    corruptStored((stored) => delete (stored as Partial<CompactOrgTraineesRawCache>).asOf);

    const response = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(response.asOf).toBe('2026-10-30T04:15:00.000Z');
  });
});

describe('OrgPeopleTraineesService learners outside the people list (lfx-self-serve#4287)', () => {
  it('ships a name and one status per learner, and no key, course, project, foundation, level, format, date or id', async () => {
    serve({
      ...baseWarehouse(),
      outside: [
        { LEARNER_NAME: 'Outside One', IS_CERTIFIED: true },
        { LEARNER_NAME: null, IS_CERTIFIED: false },
      ],
    });

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.outsideLearners).toEqual([
      { personKey: 'outside:1', name: 'Outside One', status: 'Certified' },
      { personKey: 'outside:2', name: null, status: 'Enrolled' },
    ]);
  });

  it('maps a certified flag to Certified and a false or null one to Enrolled', async () => {
    serve({
      ...baseWarehouse(),
      outside: [
        { LEARNER_NAME: 'A', IS_CERTIFIED: true },
        { LEARNER_NAME: 'B', IS_CERTIFIED: false },
        { LEARNER_NAME: '', IS_CERTIFIED: null },
      ],
    });

    const { outsideLearners } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(outsideLearners.map((learner) => [learner.name, learner.status])).toEqual([
      ['A', 'Certified'],
      ['B', 'Enrolled'],
      [null, 'Enrolled'],
    ]);
  });

  it('reads them from the range pairs off the list, leaves out a key with people-list pairs, and never selects the key', async () => {
    await service.getTrainees(ACCOUNT, '90d', 'org-grant');

    const [outside, binds] = callFor((query) => query.includes('ORG_TRAINING_OUTSIDE_LEARNERS'));
    expect(outside).toMatch(/SELECT\s+o\.LEARNER_NAME,\s+p\.IS_CERTIFIED\s+FROM/);
    expect(outside).toMatch(
      /FROM ANALYTICS\.PLATINUM_LFX_ONE\.ORG_PEOPLE_TRAINING_PAIRS\s+WHERE ACCOUNT_ID = \?\s+AND TIME_RANGE = \?\s+AND NOT IS_ON_PEOPLE_LIST\s+AND PERSON_KEY NOT IN \(\s*SELECT PERSON_KEY\s+FROM ANALYTICS\.PLATINUM_LFX_ONE\.ORG_PEOPLE_TRAINING_PAIRS\s+WHERE ACCOUNT_ID = \?\s+AND TIME_RANGE = \?\s+AND IS_ON_PEOPLE_LIST\s+AND PERSON_KEY IS NOT NULL\s*\)/
    );
    expect(outside).toContain('BOOLOR_AGG(IS_CERTIFIED) AS IS_CERTIFIED');
    expect(outside).not.toMatch(/\b(EMAIL|TITLE|COURSE_ID|COURSE_NAME|PROJECT_ID|FOUNDATION_ID|COURSE_OR_CERT_ID|ACTIVITY_TS)\b/);
    expect(binds).toEqual([ACCOUNT, '90d', ACCOUNT, '90d', ACCOUNT]);
  });
});

describe('OrgPeopleTraineesService former employees on the people list', () => {
  const withFormer = (): Warehouse => {
    const warehouse = baseWarehouse();
    warehouse.pairs.push(pairRow('person-former', 'course-one', { IS_CERTIFIED: true }));
    warehouse.pairs.push(pairRow('person-former', 'course-two'));
    warehouse.pairs.push(pairRow('person-former-two', 'course-one'));
    warehouse.dates.push(dateRow('person-former', 'course-one', 'certified:former', 'Certified', '2026-04-01 08:00:00'));
    return warehouse;
  };

  beforeEach(() => serve(withFormer()));

  it('counts their people and pairs, and ships and stores only the counts', async () => {
    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.formerOnPeopleList).toEqual({ people: 2, pairs: 3 });
    expect(storedEntry().formerOnPeopleList).toEqual({ people: 2, pairs: 3 });
    expect(JSON.stringify([response, ...cacheValues.values()])).not.toMatch(/person-former|certified:former/);
  });

  it('reports no former employees when every people-list pair belongs to a current employee', async () => {
    serve(baseWarehouse());

    expect((await service.getTrainees(ACCOUNT, 'all', 'org-grant')).formerOnPeopleList).toEqual({ people: 0, pairs: 0 });
  });

  it('counts them the same on the direct auditor-entitlement path, and reads the same count back from the cache', async () => {
    const direct = await service.getTrainees(ACCOUNT, 'all', 'auditor-entitlement');
    expect(direct.formerOnPeopleList).toEqual({ people: 2, pairs: 3 });
    expect(cacheValues.size).toBe(0);

    await service.getTrainees(ACCOUNT, 'all', 'org-grant');
    const warehouseReads = execute.mock.calls.length;
    const cached = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(cached.formerOnPeopleList).toEqual({ people: 2, pairs: 3 });
  });

  it('treats an entry without the counts as a miss', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');
    corruptStored((stored) => delete (stored as Partial<CompactOrgTraineesRawCache>).formerOnPeopleList);
    const warehouseReads = execute.mock.calls.length;

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
    expect(response.formerOnPeopleList).toEqual({ people: 2, pairs: 3 });
  });
});

describe('OrgPeopleTraineesService access qualification and the shared cache', () => {
  it('serves an org-grant caller through the shared cache: the second read does not reach the warehouse', async () => {
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(cacheValues.size).toBe(1);
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it('serves an auditor-entitlement caller directly: nothing is read from or stored in the shared cache', async () => {
    const response = await service.getTrainees(ACCOUNT, '365d', 'auditor-entitlement');

    expect(cacheValues.size).toBe(0);
    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);

    // A warm shared entry is not served to that caller either: every call reads the warehouse again.
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const warm = execute.mock.calls.length;
    await service.getTrainees(ACCOUNT, '365d', 'auditor-entitlement');
    expect(execute.mock.calls.length).toBeGreaterThan(warm);
  });

  it('returns the same response for both qualifications', async () => {
    const direct = await service.getTrainees(ACCOUNT, '365d', 'auditor-entitlement');
    const shared = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(direct).toStrictEqual(shared);
  });
});
