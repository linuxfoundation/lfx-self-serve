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
  ...(await import('../../../../../packages/shared/src/utils/url.utils')),
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

import type { CompactOrgEventAttendeesRawCache } from '@lfx-one/shared/interfaces';

import { OrgPeopleEventAttendeesService } from './org-people-event-attendees.service';
import { buildOrgCacheKey, ValkeyService } from './valkey.service';

const ACCOUNT = '0014100000Te2ovAAB';

let service: OrgPeopleEventAttendeesService;

/**
 * Two people at the same event plus a second event, so a round trip has to survive the event
 * dictionary rather than just echoing rows back.
 */
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
    if (query.includes('SELECT DISTINCT EVENT_ID')) {
      return { rows: [{ EVENT_ID: 'event-one', EVENT_NAME: 'Community Summit', EVENT_END_DATE: '2026-04-10' }] };
    }
    return {
      rows: [
        {
          PERSON_KEY: 'person-one',
          EVENT_ID: 'event-one',
          EVENT_NAME: 'Community Summit',
          EVENT_LOCATION: 'Austin Convention Center',
          EVENT_CITY: 'Austin',
          EVENT_COUNTRY: 'USA',
          EVENT_URL: 'regfox.com/community-summit',
          EVENT_START_DATE: '2026-04-08',
          EVENT_END_DATE: '2026-04-10',
          IS_SPEAKER: true,
          IS_PAST_EVENT: true,
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
        },
        {
          PERSON_KEY: 'person-two',
          EVENT_ID: 'event-one',
          EVENT_NAME: 'Community Summit',
          EVENT_LOCATION: 'Austin Convention Center',
          EVENT_CITY: 'Austin',
          EVENT_COUNTRY: 'USA',
          EVENT_URL: 'regfox.com/community-summit',
          EVENT_START_DATE: '2026-04-08',
          EVENT_END_DATE: '2026-04-10',
          IS_SPEAKER: false,
          IS_PAST_EVENT: true,
          FOUNDATION_ID: 'foundation-one',
          FOUNDATION_NAME: 'Foundation One',
        },
        {
          PERSON_KEY: 'person-two',
          EVENT_ID: 'event-two',
          EVENT_NAME: null,
          EVENT_LOCATION: null,
          EVENT_CITY: null,
          EVENT_COUNTRY: null,
          EVENT_URL: null,
          EVENT_START_DATE: null,
          EVENT_END_DATE: null,
          IS_SPEAKER: null,
          IS_PAST_EVENT: null,
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
  service = new OrgPeopleEventAttendeesService();
});

afterEach(() => {
  ValkeyService.resetInstance();
  vi.unstubAllEnvs();
});

describe('OrgPeopleEventAttendeesService compact cache (GH-1906)', () => {
  it('serves a cache hit that is byte-identical to the miss that populated it', async () => {
    const fromMiss = await service.getEventAttendees(ACCOUNT);
    const warehouseReads = execute.mock.calls.length;

    const fromHit = await service.getEventAttendees(ACCOUNT);

    // `toStrictEqual` distinguishes null from undefined from an absent key; the serialized
    // comparison additionally pins key order, which `getEventAttendees`'s object literals fix and a
    // decode must not perturb.
    expect(fromHit).toStrictEqual(fromMiss);
    expect(JSON.stringify(fromHit)).toBe(JSON.stringify(fromMiss));
    expect(execute).toHaveBeenCalledTimes(warehouseReads);
  });

  it('rebuilds every event-level column the detail rows no longer carry, on the cache-hit path', async () => {
    // Deliberately the SECOND call: the first populates the cache and returns the rows the
    // warehouse handed back, so only a read-back exercises the decoder at all. The dedup is the
    // whole saving here, so a decode that dropped a dictionary column would empty most of the
    // expanded sub-table while still round-tripping the rows themselves.
    await service.getEventAttendees(ACCOUNT);
    const warehouseReads = execute.mock.calls.length;

    const { details } = await service.getEventAttendees(ACCOUNT);

    expect(execute).toHaveBeenCalledTimes(warehouseReads);

    expect(details[0]).toEqual({
      personKey: 'person-one',
      eventId: 'event-one',
      eventName: 'Community Summit',
      eventLocation: 'Austin Convention Center',
      eventCity: 'Austin',
      eventCountry: 'USA',
      eventUrl: 'https://regfox.com/community-summit',
      foundationId: 'foundation-one',
      foundationName: 'Foundation One',
      eventStartDate: '2026-04-08',
      eventEndDate: '2026-04-10',
      isSpeaker: true,
      isPastEvent: true,
    });
    expect(details.map((row) => row.eventId)).toEqual(['event-one', 'event-one', 'event-two']);
    // Two of the three detail rows share an event, so the stored dictionary has to be shorter than
    // the detail table — a `keyOf` regression that stopped collapsing them would not be.
    const stored = JSON.parse([...cacheValues.values()][0]) as CompactOrgEventAttendeesRawCache;
    expect(stored.events.r.length).toBe(2);
    expect(stored.details.r.length).toBe(3);
  });

  it('rejects a stored entry whose columns drifted from what the writer emits', async () => {
    // `fromColumnar` decodes a duplicated, reordered or short-rowed table "successfully" into rows
    // missing data, so the guard has to reject the entry up front rather than serve a tab with
    // holes in it for the rest of the TTL.
    await service.getEventAttendees(ACCOUNT);
    const [key] = [...cacheValues.keys()];
    const stored = JSON.parse(cacheValues.get(key)!) as CompactOrgEventAttendeesRawCache;
    stored.details.k = [...stored.details.k, 'PERSON_KEY'];
    cacheValues.set(key, JSON.stringify(stored));
    const warehouseReads = execute.mock.calls.length;

    await service.getEventAttendees(ACCOUNT);

    expect(execute.mock.calls.length).toBeGreaterThan(warehouseReads);
  });

  it('treats a pre-compaction cached entry as a miss rather than decoding it', async () => {
    // The shape guard, not just the key bump, has to reject this: reading `k`/`r` off plain row
    // arrays would serve an empty tab for the whole TTL.
    const legacy = { attendeeRows: [], detailRows: [{ PERSON_KEY: 'stale' }], foundationRows: [], eventRows: [] };
    cacheValues.set(buildOrgCacheKey(ACCOUNT, 'people-event-attendees:v2')!, JSON.stringify(legacy));

    const response = await service.getEventAttendees(ACCOUNT);

    expect(response.attendees.map((row) => row.personKey)).toEqual(['person-one', 'person-two']);
  });
});
