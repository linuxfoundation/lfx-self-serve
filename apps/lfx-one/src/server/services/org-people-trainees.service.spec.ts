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

import { OrgPeopleTraineesService } from './org-people-trainees.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = '0014100000Te2ovAAB';

let service: OrgPeopleTraineesService;

/** Two people on the same course plus a second course, so the course dictionary is actually exercised. */
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
    if (query.includes('SELECT DISTINCT FOUNDATION_ID')) {
      return { rows: [{ FOUNDATION_ID: 'foundation-one', FOUNDATION_NAME: 'Foundation One' }] };
    }
    if (query.includes('SELECT DISTINCT COURSE_ID')) {
      return { rows: [{ COURSE_ID: 'course-one', COURSE_NAME: 'Project Fundamentals' }] };
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
      activityTs: '2026-04-12T10:30:00.000Z',
    });
    expect(details.map((row) => row.courseId)).toEqual(['course-one', 'course-one', 'enroll-two']);
    // Two of the three detail rows share a course, so the stored dictionary has to be shorter than
    // the detail table — a `keyOf` regression that stopped collapsing them would not be.
    const stored = JSON.parse([...cacheValues.values()][0]) as CompactOrgTraineesRawCache;
    expect(stored.courses.r.length).toBe(2);
    expect(stored.details.r.length).toBe(3);
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
      if (query.includes('SELECT DISTINCT')) {
        return { rows: [] };
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
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-trainees:v4:365d')!, JSON.stringify(legacy));

    const response = await service.getTrainees(ACCOUNT, '365d');

    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});

// ORG_PEOPLE_TRAINING holds enrollments of any age; the Trainees tab reads only the selected range's rows, so the stat
// cards, table and both dropdowns describe that range.
describe('OrgPeopleTraineesService range (lfx-self-serve#4159)', () => {
  const queries = (): string[] => execute.mock.calls.map(([sql]) => sql as string);

  it.each([
    ['30d', 30],
    ['90d', 90],
    ['365d', 365],
  ] as const)('windows every read on ACTIVITY_TS for %s', async (range, days) => {
    const response = await service.getTrainees(ACCOUNT, range);

    expect(response.timeRange).toBe(range);
    expect(execute).toHaveBeenCalledTimes(4);
    for (const sql of queries()) {
      expect(sql).toContain(`AND ACTIVITY_TS >= DATEADD(day, -${days}, CURRENT_DATE())`);
    }
  });

  it('reads all time without a date predicate', async () => {
    await service.getTrainees(ACCOUNT, 'all');

    expect(execute).toHaveBeenCalledTimes(4);
    for (const sql of queries()) {
      expect(sql).not.toContain('ACTIVITY_TS >=');
    }
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

    expect(execute).toHaveBeenCalledTimes(8);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v4:30d')!)).toBe(true);
    expect(cacheValues.has(buildOrgCacheKey(ACCOUNT, 'people-trainees:v4:365d')!)).toBe(true);
  });
});
