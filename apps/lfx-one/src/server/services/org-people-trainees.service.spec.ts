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
    if (query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) {
      return { rows: [{ LEARNER_NAME: 'Grace Hopper', IS_CERTIFIED: false }] };
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
          PRODUCT_TYPE: 'Certification',
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
          PRODUCT_TYPE: 'Certification',
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
          PRODUCT_TYPE: 'Certification',
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
          PRODUCT_TYPE: 'Certification',
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

  it('rebuilds the course-level columns on the cache-hit path, including the null-course id fallback and the unfilled course name', async () => {
    // Deliberately the SECOND call: the first populates the cache and returns the rows the
    // warehouse handed back, so only a read-back exercises the decoder at all. A decode that
    // dropped a dictionary column would leave the expanded section blank; the null-COURSE_ID row
    // also pins the documented fallback to COURSE_OR_CERT_ID, which the client groups on; the missing name stays null on the wire.
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const warehouseReads = execute.mock.calls.length;

    const { details } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

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
      productType: 'Certification',
      activityTs: '2026-04-12T10:30:00.000Z',
    });
    expect(details[3]).toMatchObject({ courseId: 'enroll-two', courseName: null, projectId: null, courseLevel: null, courseFormat: 'Instructor Led' });
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
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    stored.courses.k = [...stored.courses.k].reverse();
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

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
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    corrupt(stored);
    cacheValues.set(key, JSON.stringify(stored));
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
    ['an object', {}],
  ])('treats a stored entry whose required COURSE_OR_CERT_ID cell is %s as a miss', async (_label, corrupt) => {
    // Exact columns prove the shape, not the value. A required cell that never arrived, or arrived
    // as the wrong type, decodes into a row the mapper then reads — so it has to be a miss.
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    const index = stored.details.k.indexOf('COURSE_OR_CERT_ID');
    stored.details.r = stored.details.r.map((row) => row.map((cell, position) => (position === index ? corrupt : cell)));
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT, '365d', 'org-grant');

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
      if (query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) {
        return { rows: [{ LEARNER_NAME: null, IS_CERTIFIED: null }] };
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
            PRODUCT_TYPE: 'Certification',
          },
        ],
      };
    });
    const fromMiss = await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(fromHit).toStrictEqual(fromMiss);
  });

  it('treats a pre-compaction cached entry as a miss rather than decoding it', async () => {
    // The shape guard, not just the key bump, has to reject this: reading `k`/`r` off plain row
    // arrays would serve an empty tab for the whole TTL.
    const legacy = { traineeRows: [], detailRows: [{ PERSON_KEY: 'stale' }], foundationRows: [], courseRows: [] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-trainees:v10:365d')!, JSON.stringify(legacy));

    const response = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
    expect(response.outsideLearners.map((row) => row.personKey)).toEqual(['outside:1']);
  });

  it('treats a v4-shaped entry without the build time as a miss, so the as-of date is never dropped for a TTL', async () => {
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as Partial<CompactOrgTraineesRawCache>;
    delete stored.asOf;
    cacheValues.set(key, JSON.stringify(stored));

    const response = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

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
    const response = await service.getTrainees(ACCOUNT, range, 'org-grant');

    expect(response.timeRange).toBe(range);
    expect(rangedQueries()).toHaveLength(3);
    for (const sql of rangedQueries()) {
      expect(sql).toContain(`AND ACTIVITY_TS >= DATEADD(day, -${days}, CURRENT_DATE())`);
    }
  });

  it('reads all time without a date predicate', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(4);
    for (const sql of queries()) {
      expect(sql).not.toContain('ACTIVITY_TS >=');
    }
  });

  it('states the build time of the training data whatever the range, and null when the account has none', async () => {
    const narrow = await service.getTrainees(ACCOUNT, '30d', 'org-grant');
    const wide = await service.getTrainees(ACCOUNT, 'all', 'org-grant');
    const asOfRead = queries().find((sql) => sql.includes('MAX(DBT_RUN_AT)'))!;

    expect(narrow.asOf).toBe('2026-10-30T04:15:00.000Z');
    expect(wide.asOf).toBe(narrow.asOf);
    expect(asOfRead).not.toContain('ACTIVITY_TS');

    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    expect((await service.getTrainees('another-account', '30d', 'org-grant')).asOf).toBeNull();
  });

  it('takes identity from the all-time ranges roster, limited to people with training rows in the range', async () => {
    await service.getTrainees(ACCOUNT, '90d', 'org-grant');

    const identity = queries().find((sql) => sql.includes('ORG_PEOPLE_ALL_RANGES'))!;
    expect(identity).toContain("TIME_RANGE = 'all'");
    expect(identity).toContain("PROJECT_SCOPE = 'all'");
    expect(identity).toMatch(/PERSON_KEY IN \(\s*SELECT PERSON_KEY\s+FROM ANALYTICS\.PLATINUM_LFX_ONE\.ORG_PEOPLE_TRAINING[\s\S]*DATEADD\(day, -90,/);
    expect(identity).toMatch(/AND IS_ON_PEOPLE_LIST\b/);
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

    const response = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(response.trainees).toHaveLength(1);
    expect(response.trainees[0].email).toBe('ada@company.example');
    expect(JSON.stringify(response)).not.toContain('ada@personal.example');
  });

  it('caches each range under its own key', async () => {
    await service.getTrainees(ACCOUNT, '30d', 'org-grant');
    await service.getTrainees(ACCOUNT, '365d', 'org-grant');
    await service.getTrainees(ACCOUNT, '30d', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(8);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v10:30d')!)).toBe(true);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v10:365d')!)).toBe(true);
  });
});

describe('OrgPeopleTraineesService detail rows (lfx-self-serve#4916)', () => {
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
    PRODUCT_TYPE: 'Certification',
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
        PRODUCT_TYPE: 'Certification',
      },
      old
    ),
  ];

  beforeEach(() => {
    execute.mockImplementation(async (query: string) => {
      // Every row's person is on the people list: the options are built from listed rows only.
      if (query.includes('ORG_PEOPLE_ALL')) {
        const keys = [...new Set(rows.map((row) => row.PERSON_KEY))];
        return { rows: keys.map((key) => ({ PERSON_KEY: key, LFID: null, CDP_MEMBER_ID: null, NAME: key, TITLE: null, EMAIL: null })) };
      }
      if (query.includes('MAX(DBT_RUN_AT)') || query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) return { rows: [] };
      return { rows: /ACTIVITY_TS >= DATEADD\(day, -30,/.test(query) ? rows.filter((row) => row.ACTIVITY_TS === recent) : rows };
    });
  });

  it('reads the project, level and format of every row', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    const detailRead = execute.mock.calls.map(([sql]) => sql as string).find((sql) => sql.includes('COURSE_OR_CERT_ID'))!;
    for (const column of ['PROJECT_ID', 'PROJECT_NAME', 'COURSE_LEVEL', 'COURSE_FORMAT']) {
      expect(detailRead).toContain(column);
    }
  });

  it('ships the product type of every detail row, and no dropdown options (those come from /filter-options)', async () => {
    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.details.length).toBeGreaterThan(0);
    expect(response.details.every((row) => row.productType === 'Certification')).toBe(true);
    expect('filterOptions' in response).toBe(false);
  });

  it('reads the product type column in the detail read', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    const detailRead = execute.mock.calls.map(([sql]) => sql as string).find((sql) => sql.includes('COURSE_OR_CERT_ID'))!;
    expect(detailRead).toContain('PRODUCT_TYPE');
  });

  it('keeps only the rows of the range', async () => {
    const { details } = await service.getTrainees(ACCOUNT, '30d', 'org-grant');

    expect(details.map((row) => row.courseId)).toEqual(['course-v1']);
  });
});

describe('OrgPeopleTraineesService learners outside the people list (lfx-self-serve#4287)', () => {
  /** A training row as the warehouse holds it; `offList` stands in for its people-list flag. */
  const trainingRow = (personKey: string, courseOrCertId: string, status: string, activityTs: string) => ({
    PERSON_KEY: personKey,
    STATUS: status,
    COURSE_OR_CERT_ID: courseOrCertId,
    COURSE_ID: 'course-one',
    COURSE_NAME: 'Course One',
    ACTIVITY_TS: activityTs,
    FOUNDATION_ID: 'foundation-one',
    FOUNDATION_NAME: 'Foundation One',
    PROJECT_ID: 'project-one',
    PROJECT_NAME: 'Project One',
    COURSE_LEVEL: 'Beginner',
    COURSE_FORMAT: status === 'Enrolled' ? 'E-Learning' : null,
    PRODUCT_TYPE: 'Certification',
  });
  const recent = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const old = '2020-01-15 00:00:00';
  const training = [
    trainingRow('person-listed', 'enrolled:course-one', 'Enrolled', recent),
    // On the people list, but with no current-employee row: counted under an opaque key, never listed.
    trainingRow('person-former', 'enrolled:former', 'Enrolled', recent),
    // Certified, but only before the 30-day window.
    trainingRow('ti:outside-one', 'enrolled:outside', 'Enrolled', recent),
    trainingRow('ti:outside-one', 'certified:outside', 'Certified', old),
    trainingRow('ti:outside-two', 'enrolled:outside-two', 'Enrolled', old),
  ];
  const offList = new Set(['ti:outside-one', 'ti:outside-two']);
  const learnerNames: Record<string, string | null> = { 'ti:outside-one': 'Zoe Outside', 'ti:outside-two': null };

  beforeEach(() => {
    // Honours the predicates the way Snowflake would, so a read that dropped one would let the wrong rows through.
    execute.mockImplementation(async (query: string) => {
      const inRange = (row: { ACTIVITY_TS: string }) => !/ACTIVITY_TS >= DATEADD\(day, -30,/.test(query) || row.ACTIVITY_TS === recent;
      if (query.includes('ORG_PEOPLE_ALL_RANGES')) {
        return {
          rows: [
            {
              PERSON_KEY: 'person-listed',
              LFID: 'lfid-listed',
              CDP_MEMBER_ID: null,
              NAME: 'Listed Person',
              TITLE: 'Engineer',
              EMAIL: 'listed@company.example',
            },
          ],
        };
      }
      if (query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) {
        if (!/BOOLOR_AGG\(STATUS = 'Certified'\) AS IS_CERTIFIED/.test(query) || !/AND NOT IS_ON_PEOPLE_LIST\b/.test(query)) return { rows: [] };
        const certified = new Map<string, boolean>();
        for (const row of training.filter((candidate) => offList.has(candidate.PERSON_KEY) && inRange(candidate))) {
          certified.set(row.PERSON_KEY, (certified.get(row.PERSON_KEY) ?? false) || row.STATUS === 'Certified');
        }
        return {
          rows: [...certified].map(([key, isCertified]) => ({ PERSON_KEY: key, LEARNER_NAME: learnerNames[key], IS_CERTIFIED: isCertified })),
        };
      }
      if (query.includes('MAX(DBT_RUN_AT)')) return { rows: [] };
      const onList = /AND IS_ON_PEOPLE_LIST\b/.test(query);
      return { rows: training.filter((row) => (!onList || !offList.has(row.PERSON_KEY)) && inRange(row)) };
    });
  });

  it('ships a name and one status per learner, and no course, project, foundation, level, format, date or id', async () => {
    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.outsideLearners).toEqual([
      { personKey: 'outside:1', name: 'Zoe Outside', status: 'Certified' },
      { personKey: 'outside:2', name: null, status: 'Enrolled' },
    ]);
    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-listed']);
    // People-list rows only: the learners' own course rows are never read, so none can reach the wire.
    expect(response.details.map((row) => row.courseOrCertId)).not.toContain('enrolled:outside');
    expect(JSON.stringify(response)).not.toMatch(/ti:outside|:outside/);
  });

  it('derives the status from the range: a certificate dated before it leaves the learner Enrolled', async () => {
    const response = await service.getTrainees(ACCOUNT, '30d', 'org-grant');

    expect(response.outsideLearners).toEqual([{ personKey: 'outside:1', name: 'Zoe Outside', status: 'Enrolled' }]);
  });

  it('maps a certified flag to Certified and a false or null one to Enrolled', async () => {
    execute.mockImplementation(async (query: string) =>
      query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')
        ? {
            rows: [
              { LEARNER_NAME: 'A', IS_CERTIFIED: true },
              { LEARNER_NAME: 'B', IS_CERTIFIED: false },
              { LEARNER_NAME: '', IS_CERTIFIED: null },
            ],
          }
        : { rows: [] }
    );

    const { outsideLearners } = await service.getTrainees(ACCOUNT, '365d', 'org-grant');

    expect(outsideLearners.map((learner) => [learner.name, learner.status])).toEqual([
      ['A', 'Certified'],
      ['B', 'Enrolled'],
      [null, 'Enrolled'],
    ]);
  });

  it('ships course rows of listed people only: a former employee behind people-list rows has no wire row', async () => {
    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect([...new Set(response.details.map((row) => row.personKey))]).toEqual(['person-listed']);
    expect(response.details.find((row) => row.personKey === 'person-listed')?.courseOrCertId).toBe('enrolled:course-one');
    expect(JSON.stringify(response)).not.toMatch(/person-former|enrolled:former/);
  });

  it('still reads the former employee rows server-side, so a learner sharing that key is deduplicated', async () => {
    const honest = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: string, binds: unknown[]) =>
      query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')
        ? { rows: [{ PERSON_KEY: 'person-former', LEARNER_NAME: 'Former Learner', IS_CERTIFIED: false }] }
        : honest(query, binds)
    );

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.outsideLearners).toEqual([]);
    expect(JSON.stringify(response)).not.toMatch(/person-former|Former Learner/);
  });

  it('counts a learner who shares a warehouse key with people-list rows once, and never sends that key', async () => {
    // The same warehouse person as an outside learner and behind a former employee's (or a listed member's)
    // people-list rows: lf-dbt keeps IS_ON_PEOPLE_LIST constant per key, but the people card must not count them twice.
    const honest = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: string, binds: unknown[]) => {
      if (!query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) return honest(query, binds);
      return {
        rows: [
          { PERSON_KEY: 'person-former', LEARNER_NAME: 'Former Learner', IS_CERTIFIED: false },
          { PERSON_KEY: 'person-listed', LEARNER_NAME: 'Listed Learner', IS_CERTIFIED: true },
          { PERSON_KEY: 'ti:outside-one', LEARNER_NAME: 'Zoe Outside', IS_CERTIFIED: false },
        ],
      };
    });

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.outsideLearners).toEqual([{ personKey: 'outside:1', name: 'Zoe Outside', status: 'Enrolled' }]);
    expect(response.details.map((row) => row.personKey)).toEqual(['person-listed']);
    expect(JSON.stringify(response)).not.toMatch(/person-former|Former Learner|Listed Learner/);
    // Nor cached: the stored entry holds no learner's warehouse key and no dropped learner's name.
    const stored = [...cacheValues.values()].join('\n');
    expect(stored).toContain('Zoe Outside');
    expect(stored).not.toMatch(/ti:outside-one|Former Learner|Listed Learner/);
  });

  it('caches no former employee row: the stored entry holds neither their warehouse key nor their enrollment or certificate ids', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    const stored = [...cacheValues.values()].join('\n');
    expect(stored).toContain('enrolled:course-one');
    expect(stored).not.toMatch(/person-former|enrolled:former/);
    const entry = JSON.parse([...cacheValues.values()][0]) as CompactOrgTraineesRawCache;
    expect(entry.details.r).toHaveLength(1);
  });

  it('counts the unlisted former employee as one person and one pair, and ships and stores only the counts', async () => {
    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.formerOnPeopleList).toEqual({ people: 1, pairs: 1 });
    const entry = JSON.parse([...cacheValues.values()][0]) as CompactOrgTraineesRawCache;
    expect(entry.formerOnPeopleList).toEqual({ people: 1, pairs: 1 });
    expect(JSON.stringify(response)).not.toMatch(/person-former/);
  });

  it('counts a former employee by distinct (person, course) pair: re-enrollments and a certificate collapse, a second course adds one, uncounted rows add none', async () => {
    const honest = execute.getMockImplementation()!;
    const former = (courseOrCertId: string, courseId: string | null, status: string, activityTs: string | null, personKey = 'person-former') => ({
      ...training[1],
      PERSON_KEY: personKey,
      COURSE_OR_CERT_ID: courseOrCertId,
      COURSE_ID: courseId,
      STATUS: status,
      ACTIVITY_TS: activityTs,
    });
    execute.mockImplementation(async (query: string, binds: unknown[]) => {
      const result = (await honest(query, binds)) as { rows: Record<string, unknown>[] };
      if (!query.includes('COURSE_OR_CERT_ID') || query.includes('ORG_PEOPLE_ALL_RANGES') || query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')) return result;
      return {
        rows: [
          ...result.rows,
          // Same pair as the fixture's former row: a re-enrollment and the certificate.
          former('enrolled:former-again', 'course-one', 'Enrolled', recent),
          former('certified:former', 'course-one', 'Certified', recent),
          // A second course, found through the cert id when COURSE_ID is null.
          former('enrolled:former-two', null, 'Enrolled', recent),
          // Not counted by the cards: an unknown status and an undated row.
          former('other:former', 'course-three', 'Dropped', recent),
          former('undated:former', 'course-four', 'Enrolled', null),
          // A second unlisted person, and a person with only uncounted rows.
          former('enrolled:other', 'course-one', 'Enrolled', recent, 'person-former-two'),
          former('undated:third', 'course-one', 'Enrolled', null, 'person-former-three'),
        ],
      };
    });

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.formerOnPeopleList).toEqual({ people: 2, pairs: 3 });
    expect(JSON.stringify([response, ...cacheValues.values()])).not.toMatch(/person-former/);
  });

  it('reports no former employees when every people-list learner has a current-employee row', async () => {
    const honest = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: string, binds: unknown[]) => {
      const result = (await honest(query, binds)) as { rows: Record<string, unknown>[] };
      return query.includes('COURSE_OR_CERT_ID') && !query.includes('ORG_PEOPLE_ALL_RANGES') && !query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')
        ? { rows: result.rows.filter((row) => row['PERSON_KEY'] !== 'person-former') }
        : result;
    });

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.formerOnPeopleList).toEqual({ people: 0, pairs: 0 });
  });

  it('counts the former employee the same on the direct auditor-entitlement path, and reads the same count back from the cache', async () => {
    const direct = await service.getTrainees(ACCOUNT, 'all', 'auditor-entitlement');
    expect(direct.formerOnPeopleList).toEqual({ people: 1, pairs: 1 });
    expect(cacheValues.size).toBe(0);

    await service.getTrainees(ACCOUNT, 'all', 'org-grant');
    const warehouseReads = execute.mock.calls.length;
    const cached = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(execute).toHaveBeenCalledTimes(warehouseReads);
    expect(cached.formerOnPeopleList).toEqual({ people: 1, pairs: 1 });
  });

  it('treats a v9-shaped entry without the counts as a miss', async () => {
    await service.getTrainees(ACCOUNT, 'all', 'org-grant');
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as Partial<CompactOrgTraineesRawCache>;
    delete stored.formerOnPeopleList;
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
    expect(response.formerOnPeopleList).toEqual({ people: 1, pairs: 1 });
  });

  it('still counts the former employee rows for the outside-learner dedupe before dropping them from the cache', async () => {
    const honest = execute.getMockImplementation()!;
    execute.mockImplementation(async (query: string, binds: unknown[]) =>
      query.includes('ORG_TRAINING_OUTSIDE_LEARNERS')
        ? { rows: [{ PERSON_KEY: 'person-former', LEARNER_NAME: 'Former Learner', IS_CERTIFIED: false }] }
        : honest(query, binds)
    );

    const response = await service.getTrainees(ACCOUNT, 'all', 'org-grant');

    expect(response.outsideLearners).toEqual([]);
    expect(JSON.stringify([...cacheValues.values()])).not.toMatch(/person-former|Former Learner/);
  });

  it('windows the learners on the range and reads their status, not their rows', async () => {
    await service.getTrainees(ACCOUNT, '90d', 'org-grant');

    const queries = execute.mock.calls.map(([sql]) => sql as string);
    const outside = queries.find((sql) => sql.includes('ORG_TRAINING_OUTSIDE_LEARNERS'))!;
    expect(outside).toMatch(/AND NOT IS_ON_PEOPLE_LIST[\s\S]*AND ACTIVITY_TS >= DATEADD\(day, -90,[\s\S]*GROUP BY PERSON_KEY/);
    // The warehouse key is selected for the dedupe against people-list rows only; the test above shows it is never cached.
    expect(outside).toMatch(/SELECT\s+o\.PERSON_KEY,\s+o\.LEARNER_NAME,\s+t\.IS_CERTIFIED\s+FROM/);
    expect(outside).not.toMatch(/\b(EMAIL|TITLE|COURSE_ID|COURSE_NAME|PROJECT_ID|FOUNDATION_ID|COURSE_OR_CERT_ID)\b/);
    expect(queries.find((sql) => sql.includes('COURSE_OR_CERT_ID'))).toMatch(/AND IS_ON_PEOPLE_LIST\s+AND ACTIVITY_TS/);
    expect(queries.find((sql) => sql.includes('ORG_PEOPLE_ALL_RANGES'))).toMatch(/AND IS_ON_PEOPLE_LIST\s+AND ACTIVITY_TS/);
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
