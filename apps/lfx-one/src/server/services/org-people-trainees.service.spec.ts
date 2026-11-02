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

let service: OrgPeopleTraineesService;

/** Two people on the same course (one also re-enrolled after the certificate) plus a row with no course, so the course dictionary is actually exercised. */
function mockWarehouse(): void {
  execute.mockImplementation(async (query: string) => {
    if (query.includes('ORG_PEOPLE_ALL')) {
      return {
        rows: [
          { PERSON_KEY: 'person-one', LFID: 'lfid-one', CDP_MEMBER_ID: 'cdp-1', NAME: 'Ada Lovelace', TITLE: 'Engineer', EMAIL: 'ada@example.com' },
          { PERSON_KEY: 'person-two', LFID: null, CDP_MEMBER_ID: null, NAME: null, TITLE: null, EMAIL: null },
        ],
      };
    }
    if (query.includes('MAX(DBT_RUN_AT)')) {
      return { rows: [{ AS_OF: '2026-10-30 04:15:00' }] };
    }
    return {
      rows: [
        {
          PERSON_KEY: 'person-one',
          STATUS: 'Certified',
          COURSE_OR_CERT_ID: 'cert-one',
          COURSE_ID: 'course-one',
          COURSE_NAME: 'Project Fundamentals',
          ACTIVITY_TS: '2026-04-12 10:30:00',
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
          PROJECT_ID: 'project-one',
          PROJECT_NAME: 'Project One',
          COURSE_LEVEL: 'Beginner',
          COURSE_FORMAT: null,
        },
        {
          PERSON_KEY: 'person-two',
          STATUS: 'Enrolled',
          COURSE_OR_CERT_ID: 'enroll-one',
          COURSE_ID: 'course-one',
          COURSE_NAME: 'Project Fundamentals',
          ACTIVITY_TS: '2026-03-01 08:00:00',
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
          PROJECT_ID: 'project-one',
          PROJECT_NAME: 'Project One',
          COURSE_LEVEL: 'Beginner',
          COURSE_FORMAT: 'E-Learning',
        },
        {
          PERSON_KEY: 'person-one',
          STATUS: 'Enrolled',
          COURSE_OR_CERT_ID: 'enroll-one-again',
          COURSE_ID: 'course-one',
          COURSE_NAME: 'Project Fundamentals',
          ACTIVITY_TS: '2026-05-01 08:00:00',
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
          PROJECT_ID: 'project-one',
          PROJECT_NAME: 'Project One',
          COURSE_LEVEL: 'Beginner',
          COURSE_FORMAT: 'E-Learning',
        },
        {
          PERSON_KEY: 'person-two',
          STATUS: 'Enrolled',
          COURSE_OR_CERT_ID: 'enroll-two',
          COURSE_ID: null,
          COURSE_NAME: null,
          ACTIVITY_TS: '2026-02-01 08:00:00',
          FOUNDATION_ID: null,
          FOUNDATION_NAME: null,
          PROJECT_ID: null,
          PROJECT_NAME: null,
          COURSE_LEVEL: null,
          COURSE_FORMAT: 'Instructor Led',
        },
      ],
    };
  });
}

beforeEach(() => {
  vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
  execute.mockReset();
  cacheValues.clear();
  ValkeyService.resetInstance();
  mockWarehouse();
  service = new OrgPeopleTraineesService();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

describe('OrgPeopleTraineesService compact cache (GH-1906)', () => {
  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    const fromMiss = await service.getTrainees(ACCOUNT, '365d');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getTrainees(ACCOUNT, '365d');

    // `toStrictEqual` distinguishes null from undefined from an absent key; the serialized
    // comparison additionally pins key order, which `getTrainees`'s object literals fix and a
    // decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it('rebuilds the course-level columns on the cache-hit path, including the null-course fallback', async () => {
    // Deliberately the SECOND call: the first populates the cache and returns the rows the
    // warehouse handed back, so only a read-back exercises the decoder at all. A decode that
    // dropped a dictionary column would leave the expanded section blank; the null-COURSE_ID row
    // also pins the documented fallback to COURSE_OR_CERT_ID, which the client groups on.
    await service.getTrainees(ACCOUNT, '365d');
    const warehouseReads = execute.mock.calls.length;

    const { details } = await service.getTrainees(ACCOUNT, '365d');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);

    expect(details[0]).toEqual({
      personKey: 'person-one',
      status: 'Certified',
      courseOrCertId: 'cert-one',
      courseId: 'course-one',
      courseName: 'Project Fundamentals',
      foundationId: 'foundation-one',
      foundationName: 'Foundation One',
      projectId: 'project-one',
      projectName: 'Project One',
      courseLevel: 'Beginner',
      courseFormat: null,
      activityTs: '2026-04-12T10:30:00.000Z',
    });
    expect(details[3]).toMatchObject({ courseId: 'enroll-two', projectId: null, courseLevel: null, courseFormat: 'Instructor Led' });
    expect(details.map((row) => row.courseId)).toEqual(['course-one', 'course-one', 'course-one', 'enroll-two']);
    // Two of the four detail rows share every course-level column, so the stored dictionary has to be shorter than
    // the detail table — a `keyOf` regression that stopped collapsing them would not be.
    const stored = JSON.parse([...cacheValues.values()][0]) as CompactOrgTraineesRawCache;
    expect(stored.courses.r.length).toBe(3);
    expect(stored.details.r.length).toBe(4);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a tab with
    // holes in it for the rest of the TTL.
    await service.getTrainees(ACCOUNT, '365d');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    stored.courses.k = [...stored.courses.k].reverse();
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it.each([
    [
      'an index past the end of the dictionary',
      (stored: CompactOrgTraineesRawCache) => (stored.detailCourses = stored.detailCourses.map(() => stored.courses.r.length)),
    ],
    ['a negative index', (stored: CompactOrgTraineesRawCache) => (stored.detailCourses = stored.detailCourses.map(() => -1))],
    ['a non-integer index', (stored: CompactOrgTraineesRawCache) => (stored.detailCourses = stored.detailCourses.map(() => 1.5))],
    ['an index array shorter than the rows', (stored: CompactOrgTraineesRawCache) => (stored.detailCourses = stored.detailCourses.slice(0, -1))],
  ])('treats a stored entry with %s as a miss', async (_label, corrupt) => {
    // The decode resolves each reference without a fallback, so an unresolvable one would emit a
    // row with no dictionary fields at all. The guard has to reject the entry instead.
    await service.getTrainees(ACCOUNT, '365d');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    corrupt(stored);
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('round-trips an empty result unchanged', async () => {
    // The empty envelope has to survive its own guard: rejecting it would make an org with no rows
    // refetch on every request forever.
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    const fromMiss = await service.getTrainees(ACCOUNT, '365d');

    const fromHit = await service.getTrainees(ACCOUNT, '365d');

    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(cacheValues.size).toBe(1);
  });

  it.each([
    ['absent', '\u0000'],
    ['a number', 42],
    ['an object', {}],
  ])('treats a stored entry whose required COURSE_OR_CERT_ID cell is %s as a miss', async (_label, corrupt) => {
    // Exact columns prove the shape, not the value. A required cell that never arrived, or arrived
    // as the wrong type, decodes into a row the mapper then reads — so it has to be a miss.
    await service.getTrainees(ACCOUNT, '365d');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    const index = stored.details.k.indexOf('COURSE_OR_CERT_ID');
    stored.details.r = stored.details.r.map((row) => row.map((cell, position) => (position === index ? corrupt : cell)));
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('caches rows whose PERSON_KEY and COURSE_OR_CERT_ID are null instead of missing forever', async () => {
    // Same rule as the event-attendee null EVENT_ID: the uncached mapper passes a null through, so
    // a guard demanding a string in any loosened cell (roster and detail PERSON_KEY,
    // COURSE_OR_CERT_ID) would make one such row a permanent miss — all three are nulled together.
    execute.mockReset();
    execute.mockImplementation(async (query: string) => {
      if (query.includes('ORG_PEOPLE_ALL')) {
        return { rows: [{ PERSON_KEY: null, LFID: null, CDP_MEMBER_ID: null, NAME: null, TITLE: null, EMAIL: null }] };
      }
      return {
        rows: [
          {
            PERSON_KEY: null,
            STATUS: 'Enrolled',
            COURSE_OR_CERT_ID: null,
            COURSE_ID: null,
            COURSE_NAME: null,
            ACTIVITY_TS: '2026-02-01 08:00:00',
            FOUNDATION_ID: null,
            FOUNDATION_NAME: null,
            PROJECT_ID: null,
            PROJECT_NAME: null,
            COURSE_LEVEL: null,
            COURSE_FORMAT: null,
          },
        ],
      };
    });
    const fromMiss = await service.getTrainees(ACCOUNT, '365d');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getTrainees(ACCOUNT, '365d');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('treats a pre-compaction cached entry as a miss rather than decoding it', async () => {
    // The shape guard, not just the key bump, has to reject this: reading `k`/`r` off plain row
    // arrays would serve an empty tab for the whole TTL.
    const legacy = { traineeRows: [], detailRows: [{ PERSON_KEY: 'stale' }], foundationRows: [], courseRows: [] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-trainees:v5:365d')!, JSON.stringify(legacy));

    const response = await service.getTrainees(ACCOUNT, '365d');

    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });

  it('treats a v4-shaped entry without the build time as a miss, so the as-of date is never dropped for a TTL', async () => {
    await service.getTrainees(ACCOUNT, '365d');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as Partial<CompactOrgTraineesRawCache>;
    delete stored.asOf;
    cacheValues.set(key, JSON.stringify(stored));

    const response = await service.getTrainees(ACCOUNT, '365d');

    expect(response.asOf).toBe('2026-10-30T04:15:00.000Z');
  });
});

// ORG_PEOPLE_TRAINING holds enrollments of any age; the Trainees tab reads only the selected range's rows, so the stat
// cards, table and every dropdown describe that range.
describe('OrgPeopleTraineesService range (lfx-self-serve#4159)', () => {
  const queries = (): string[] => execute.mock.calls.map(([sql]) => sql as string);
  const rangedQueries = (): string[] => queries().filter((sql) => !sql.includes('MAX(DBT_RUN_AT)'));

  it.each([
    ['30d', 30],
    ['90d', 90],
    ['365d', 365],
    ['730d', 730],
  ] as const)('windows every read on ACTIVITY_TS for %s', async (range, days) => {
    const response = await service.getTrainees(ACCOUNT, range);

    expect(response.timeRange).toBe(range);
    expect(rangedQueries()).toHaveLength(2);
    for (const sql of rangedQueries()) {
      expect(sql).toContain(`AND ACTIVITY_TS >= DATEADD(day, -${days}, CURRENT_DATE())`);
    }
  });

  it('reads all time without a date predicate', async () => {
    await service.getTrainees(ACCOUNT, 'all');

    expect(execute).toHaveBeenCalledTimes(3);
    for (const sql of queries()) {
      expect(sql).not.toContain('ACTIVITY_TS >=');
    }
  });

  it('states the build time of the training data whatever the range, and null when the account has none', async () => {
    const narrow = await service.getTrainees(ACCOUNT, '30d');
    const wide = await service.getTrainees(ACCOUNT, 'all');
    const asOfRead = queries().find((sql) => sql.includes('MAX(DBT_RUN_AT)'))!;

    expect(narrow.asOf).toBe('2026-10-30T04:15:00.000Z');
    expect(wide.asOf).toBe(narrow.asOf);
    expect(asOfRead).not.toContain('ACTIVITY_TS');

    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    expect((await service.getTrainees('another-account', '30d')).asOf).toBeNull();
  });

  it('takes identity from the all-time ranges roster, limited to people with training rows in the range', async () => {
    await service.getTrainees(ACCOUNT, '90d');

    const identity = queries().find((sql) => sql.includes('ORG_PEOPLE_ALL_RANGES'))!;
    expect(identity).toContain("TIME_RANGE = 'all'");
    expect(identity).toContain("PROJECT_SCOPE = 'all'");
    expect(identity).toMatch(/PERSON_KEY IN \(\s*SELECT PERSON_KEY\s+FROM ANALYTICS\.PLATINUM_LFX_ONE\.ORG_PEOPLE_TRAINING[\s\S]*DATEADD\(day, -90,/);
  });

  // A former employee's ranges row carries a personal address; the Trainees tab must never send it. The fake warehouse
  // honours the predicate the way Snowflake would, so dropping `IS_FORMER = FALSE` lets the former row through.
  it('reads identity from current-employee rows only, so a former row and its address never reach the response', async () => {
    execute.mockImplementation(async (query: string) => {
      if (query.includes('ORG_PEOPLE_ALL_RANGES')) {
        const current = { PERSON_KEY: 'person-one', LFID: 'lfid-one', CDP_MEMBER_ID: null, NAME: 'Ada Lovelace', TITLE: null, EMAIL: 'ada@company.example' };
        const former = { PERSON_KEY: 'person-one', LFID: 'lfid-one', CDP_MEMBER_ID: null, NAME: 'Ada Lovelace', TITLE: null, EMAIL: 'ada@personal.example' };
        return { rows: /\bIS_FORMER = FALSE\b/.test(query) ? [current] : [current, former] };
      }
      return { rows: [] };
    });

    const response = await service.getTrainees(ACCOUNT, '365d');

    expect(response.trainees).toHaveLength(1);
    expect(response.trainees[0].email).toBe('ada@company.example');
    expect(JSON.stringify(response)).not.toContain('ada@personal.example');
  });

  it('caches each range under its own key', async () => {
    await service.getTrainees(ACCOUNT, '30d');
    await service.getTrainees(ACCOUNT, '365d');
    await service.getTrainees(ACCOUNT, '30d');

    expect(execute).toHaveBeenCalledTimes(6);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v5:30d')!)).toBe(true);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v5:365d')!)).toBe(true);
  });
});

describe('OrgPeopleTraineesService filter options (lfx-self-serve#4916)', () => {
  /** A training row as the warehouse returns it; the fake honours the range predicate the way Snowflake would. */
  const trainingRow = (personKey: string, courseOrCertId: string, overrides: Record<string, string | null>, activityTs: string) => ({
    PERSON_KEY: personKey,
    STATUS: 'Enrolled',
    COURSE_OR_CERT_ID: courseOrCertId,
    COURSE_ID: courseOrCertId,
    COURSE_NAME: courseOrCertId,
    ACTIVITY_TS: activityTs,
    FOUNDATION_ID: 'foundation-one',
    FOUNDATION_NAME: 'Foundation One',
    PROJECT_ID: 'project-one',
    PROJECT_NAME: 'Project One',
    COURSE_LEVEL: null,
    COURSE_FORMAT: null,
    ...overrides,
  });
  const recent = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const old = '2020-01-15 00:00:00';
  const rows = [
    // Two course ids under one name (course versions): one dropdown entry.
    trainingRow('person-one', 'course-v1', { COURSE_NAME: 'Cloud Basics', COURSE_LEVEL: 'Beginner', COURSE_FORMAT: 'E-Learning' }, recent),
    trainingRow('person-two', 'course-v2', { COURSE_NAME: 'Cloud Basics', COURSE_LEVEL: 'Beginner', COURSE_FORMAT: 'Instructor Led' }, old),
    // A certificate: level, no format.
    trainingRow('person-two', 'cert-one', { STATUS: 'Certified', COURSE_ID: 'course-v2', COURSE_NAME: 'Cloud Basics', COURSE_LEVEL: 'Advanced' }, old),
    trainingRow(
      'person-three',
      'course-x',
      {
        PROJECT_ID: 'project-two',
        PROJECT_NAME: 'Another Project',
        FOUNDATION_ID: 'foundation-two',
        FOUNDATION_NAME: 'Foundation Two',
        COURSE_FORMAT: 'MicroCourse',
      },
      old
    ),
  ];

  beforeEach(() => {
    execute.mockImplementation(async (query: string) => {
      if (query.includes('ORG_PEOPLE_ALL') || query.includes('MAX(DBT_RUN_AT)')) return { rows: [] };
      return { rows: /ACTIVITY_TS >= DATEADD\(day, -30,/.test(query) ? rows.filter((row) => row.ACTIVITY_TS === recent) : rows };
    });
  });

  it('reads the project, level and format of every row', async () => {
    await service.getTrainees(ACCOUNT, 'all');

    const detailRead = execute.mock.calls.map(([sql]) => sql as string).find((sql) => sql.includes('COURSE_OR_CERT_ID'))!;
    for (const column of ['PROJECT_ID', 'PROJECT_NAME', 'COURSE_LEVEL', 'COURSE_FORMAT']) {
      expect(detailRead).toContain(column);
    }
  });

  it('builds every dropdown from the rows it ships: one course entry per name, formats from enrollments, no empty values', async () => {
    const { filterOptions } = await service.getTrainees(ACCOUNT, 'all');

    expect(filterOptions).toEqual({
      foundations: [
        { label: 'Foundation One', value: 'foundation-one' },
        { label: 'Foundation Two', value: 'foundation-two' },
      ],
      projects: [
        { label: 'Another Project', value: 'project-two' },
        { label: 'Project One', value: 'project-one' },
      ],
      courses: [
        { label: 'Cloud Basics', value: 'Cloud Basics' },
        { label: 'course-x', value: 'course-x' },
      ],
      levels: [
        { label: 'Advanced', value: 'Advanced' },
        { label: 'Beginner', value: 'Beginner' },
      ],
      formats: [
        { label: 'E-Learning', value: 'E-Learning' },
        { label: 'Instructor Led', value: 'Instructor Led' },
        { label: 'MicroCourse', value: 'MicroCourse' },
      ],
    });
  });

  it('offers only what the range holds', async () => {
    const { filterOptions, details } = await service.getTrainees(ACCOUNT, '30d');

    expect(details.map((row) => row.courseOrCertId)).toEqual(['course-v1']);
    expect(filterOptions.projects.map((option) => option.value)).toEqual(['project-one']);
    expect(filterOptions.levels.map((option) => option.value)).toEqual(['Beginner']);
    expect(filterOptions.formats.map((option) => option.value)).toEqual(['E-Learning']);
    expect(filterOptions.courses.map((option) => option.value)).toEqual(['Cloud Basics']);
  });

  it('lets each pick match exactly the rows that carry it, so the per-value counts add up to the rows with a value', async () => {
    const { details, filterOptions } = await service.getTrainees(ACCOUNT, 'all');

    const count = (options: { value: string }[], field: 'courseLevel' | 'courseFormat' | 'projectId' | 'courseName') =>
      options.reduce((sum, option) => sum + details.filter((row) => row[field] === option.value).length, 0);
    expect(count(filterOptions.levels, 'courseLevel')).toBe(details.filter((row) => row.courseLevel).length);
    expect(count(filterOptions.formats, 'courseFormat')).toBe(details.filter((row) => row.status === 'Enrolled').length);
    expect(count(filterOptions.projects, 'projectId')).toBe(details.length);
    expect(count(filterOptions.courses, 'courseName')).toBe(details.length);
  });
});
