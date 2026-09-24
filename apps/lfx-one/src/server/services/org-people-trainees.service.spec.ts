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
    const fromMiss = await service.getTrainees(ACCOUNT);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getTrainees(ACCOUNT);

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
    await service.getTrainees(ACCOUNT);
    const warehouseReads = execute.mock.calls.length;

    const { details } = await service.getTrainees(ACCOUNT);

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
    await service.getTrainees(ACCOUNT);
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgTraineesRawCache;
    stored.courses.k = [...stored.courses.k].reverse();
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getTrainees(ACCOUNT);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('treats a pre-compaction cached entry as a miss rather than decoding it', async () => {
    // The shape guard, not just the key bump, has to reject this: reading `k`/`r` off plain row
    // arrays would serve an empty tab for the whole TTL.
    const legacy = { traineeRows: [], detailRows: [{ PERSON_KEY: 'stale' }], foundationRows: [], courseRows: [] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-trainees:v2')!, JSON.stringify(legacy));

    const response = await service.getTrainees(ACCOUNT);

    expect(response.trainees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});
