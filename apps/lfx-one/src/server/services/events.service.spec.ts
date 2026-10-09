// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Imported from source, not through the mocked '@lfx-one/shared/utils' barrel, so the SQL/JS
// whitespace-agreement assertion below checks the real implementation.
import { isBackfillEventSource } from '../../../../../packages/shared/src/utils/event.utils';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` subpaths aren't wired into this app's
// vitest config, so each is mocked. The event/url/date helpers are pulled in via importActual
// rather than stubbed — the backfill match is the behaviour under test here, so a stub would let
// it regress with the tests still green.
const snowflakeMocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  // Use the real travel fund aggregates so the SQL assertions can't drift from the source of truth.
  const { TRAVEL_FUND_OFFERED_AGG, TRAVEL_FUND_OPEN_ENDED_AGG, TRAVEL_FUND_LATEST_DEADLINE_AGG } = await vi.importActual<
    typeof import('../../../../../packages/shared/src/constants/events.constants')
  >('../../../../../packages/shared/src/constants/events.constants');

  return {
    COMING_SOON_SENTINEL: 'coming-soon',
    DEFAULT_EVENT_SORT_FIELD: 'EVENT_START_DATE',
    DEFAULT_VISA_REQUEST_SORT_FIELD: 'APPLICATION_DATE',
    EVENT_SOURCE_BACKFILL: 'backfill',
    MY_EVENT_STATUS: { ATTENDED: 'Attended', REGISTERED: 'Registered', NOT_REGISTERED: 'Not Registered' },
    TRAVEL_FUND_OFFERED_AGG,
    TRAVEL_FUND_OPEN_ENDED_AGG,
    TRAVEL_FUND_LATEST_DEADLINE_AGG,
    VALID_EVENT_SORT_FIELDS: new Set(['EVENT_NAME', 'PROJECT_NAME', 'EVENT_START_DATE', 'EVENT_CITY']),
    VALID_VISA_REQUEST_SORT_FIELDS: new Set(['EVENT_NAME', 'EVENT_CITY', 'APPLICATION_DATE']),
    WHOLE_NUMBER_PATTERN: /^\d+$/,
  };
});
vi.mock('@lfx-one/shared/utils', async () => {
  const eventUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/event.utils')>(
    '../../../../../packages/shared/src/utils/event.utils'
  );
  const urlUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/url.utils')>(
    '../../../../../packages/shared/src/utils/url.utils'
  );
  const dateUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/date-time.utils')>(
    '../../../../../packages/shared/src/utils/date-time.utils'
  );
  return {
    isBackfillEventSource: eventUtils.isBackfillEventSource,
    normalizeToUrl: urlUtils.normalizeToUrl,
    formatDateToUTC: dateUtils.formatDateToUTC,
  };
});
vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute: snowflakeMocks.execute }) },
}));
vi.mock('./user.service', () => ({
  UserService: class {},
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { EventsService } = await import('./events.service');

const USER_EMAIL = 'delegate@acme-motors.example';

/** Minimal MyEventRow shaped like a PLATINUM_LFX_ONE.EVENT_REGISTRATIONS row. */
function buildRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    EVENT_ID: 'evt-1',
    EVENT_NAME: 'Example Community Summit',
    EVENT_START_DATE: '2026-08-19T07:00:00.000Z',
    EVENT_END_DATE: '2026-08-21T07:00:00.000Z',
    EVENT_LOCATION: null,
    EVENT_CITY: 'Shanghai',
    EVENT_COUNTRY: 'China',
    PROJECT_ID: 'proj-1',
    PROJECT_NAME: 'Example Foundation',
    PROJECT_SLUG: 'example',
    ACCOUNT_NAME: 'Example Account',
    ACCOUNT_LOGO_URL: null,
    USER_ROLE: 'Attendee',
    REGISTRATION_STATUS: 'Accepted',
    TF_REQUEST_STATUS: null,
    VL_REQUEST_STATUS: null,
    GROSS_REVENUE: null,
    TAX_AMOUNT: null,
    NET_REVENUE: null,
    IS_PAST_EVENT: false,
    EVENT_SOURCE: 'backfill',
    EVENT_URL: null,
    EVENT_REGISTRATION_URL: null,
    USER_ATTENDED: 1,
    IS_REGISTERED: true,
    TRAVEL_FUND_END_TS: null,
    TOTAL_RECORDS: 1,
    ...overrides,
  };
}

describe('EventsService.getMyEvents status derivation', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EventsService();
  });

  async function statusFor(overrides: Record<string, unknown>): Promise<string> {
    snowflakeMocks.execute.mockResolvedValue({ rows: [buildRow(overrides)] });
    const result = await service.getMyEvents({} as never, USER_EMAIL, { pageSize: 10, offset: 0 } as never);
    return result.data[0].status;
  }

  it('reports Attended for an attended backfill row whose IS_PAST_EVENT snapshot is stale', async () => {
    // The reported bug: dbt hard-codes user_attended = TRUE for backfill rows, but IS_PAST_EVENT is
    // a build-time snapshot that can still read FALSE after the event has happened.
    await expect(statusFor({ EVENT_SOURCE: 'backfill', IS_PAST_EVENT: false, USER_ATTENDED: 1 })).resolves.toBe('Attended');
  });

  it.each([[' Backfill '], ['BACKFILL']])('matches EVENT_SOURCE %j regardless of case and whitespace', async (source) => {
    await expect(statusFor({ EVENT_SOURCE: source, IS_PAST_EVENT: false, USER_ATTENDED: 1 })).resolves.toBe('Attended');
  });

  it('reports Registered for a backfill row the user did not attend', async () => {
    await expect(statusFor({ EVENT_SOURCE: 'backfill', IS_PAST_EVENT: false, USER_ATTENDED: 0 })).resolves.toBe('Registered');
  });

  it('still reports Attended for a non-backfill past event', async () => {
    await expect(statusFor({ EVENT_SOURCE: 'cvent', IS_PAST_EVENT: true, USER_ATTENDED: 1 })).resolves.toBe('Attended');
  });

  it.each([['cvent'], [null]])('still reports Registered for a non-past event with EVENT_SOURCE %j', async (source) => {
    await expect(statusFor({ EVENT_SOURCE: source, IS_PAST_EVENT: false, USER_ATTENDED: 1 })).resolves.toBe('Registered');
  });

  it('still reports Not Registered when the user has no registration', async () => {
    await expect(statusFor({ EVENT_SOURCE: 'backfill', IS_PAST_EVENT: true, USER_ATTENDED: 1, IS_REGISTERED: false })).resolves.toBe('Not Registered');
  });
});

describe('EventsService.getMyEvents query failures', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [], metadata: [] });
    service = new EventsService();
  });

  it.each([1, 10])('propagates Upcoming registered-only query errors with pageSize=%s', async (pageSize) => {
    const error = new Error('Snowflake unavailable');
    snowflakeMocks.execute.mockRejectedValueOnce(error);

    await expect(service.getMyEvents({} as never, USER_EMAIL, { isPast: false, registeredOnly: true, pageSize, offset: 0, sortOrder: 'ASC' })).rejects.toBe(
      error
    );
  });

  it('returns a genuine zero when the registered-count query succeeds without rows', async () => {
    await expect(
      service.getMyEvents({} as never, USER_EMAIL, { isPast: false, registeredOnly: true, pageSize: 1, offset: 0, sortOrder: 'ASC' })
    ).resolves.toEqual({ data: [], total: 0, pageSize: 1, offset: 0 });
  });

  it.each([
    { isPast: false, registeredOnly: undefined },
    { isPast: false, registeredOnly: false },
    { isPast: true, registeredOnly: true },
    { isPast: undefined, registeredOnly: true },
  ])('preserves the empty fallback for isPast=$isPast, registeredOnly=$registeredOnly', async (scope) => {
    snowflakeMocks.execute.mockRejectedValueOnce(new Error('Snowflake unavailable'));

    await expect(service.getMyEvents({} as never, USER_EMAIL, { ...scope, pageSize: 25, offset: 10, sortOrder: 'ASC' })).resolves.toEqual({
      data: [],
      total: 0,
      pageSize: 25,
      offset: 10,
    });
  });
});

describe('EventsService.getMyEvents past-event SQL', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  async function sqlFor(options: Record<string, unknown>): Promise<string> {
    await service.getMyEvents({} as never, USER_EMAIL, { pageSize: 10, offset: 0, ...options } as never);
    return snowflakeMocks.execute.mock.calls[0][0] as string;
  }

  it('recomputes the past flag from the dates only for backfill rows', async () => {
    const sql = await sqlFor({ isPast: true });

    expect(sql).toContain("LOWER(TRIM(EVENT_SOURCE, ' \\t\\n\\r')) = 'backfill'");
    expect(sql).toContain('COALESCE(EVENT_END_DATE, EVENT_START_DATE) < CURRENT_DATE()');
    // The ELSE branch is the guarantee that every other source keeps its stored value.
    expect(sql).toContain('ELSE IS_PAST_EVENT END');
  });

  it('negates the same expression for the upcoming tab', async () => {
    const sql = await sqlFor({ isPast: false, affiliatedProjectSlugs: ['example'] });

    expect(sql).toContain('WHERE NOT (CASE WHEN');
    expect(sql).not.toContain('IS_PAST_EVENT = FALSE');
  });

  it('selects EVENT_SOURCE in both upcoming CTEs so the UNION ALL column lists stay aligned', async () => {
    const sql = await sqlFor({ isPast: false, affiliatedProjectSlugs: ['example'] });

    expect(sql.match(/^\s*EVENT_SOURCE,$/gm)).toHaveLength(2);
    expect(sql).toContain('e.EVENT_SOURCE,');
  });

  it('scopes the combined-CTE dedup to the whole union, not just the last branch', async () => {
    // QUALIFY binds to a single SELECT block, so the union has to be wrapped: written directly
    // after UNION ALL it only dedups affiliated_upcoming and duplicates cross-branch events.
    const sql = await sqlFor({ isPast: false, affiliatedProjectSlugs: ['example'] });
    const combined = sql.slice(sql.indexOf('combined AS ('));
    const wrapperOpen = combined.indexOf('SELECT * FROM (');
    // Each branch landmark pins its priority literal to its source; the QUALIFY landmark spans the
    // ORDER BY through "= 1", so a DESC flip or a changed row-number predicate stops matching too.
    const firstBranch = combined.indexOf('SELECT *, 1 AS SOURCE_PRIORITY FROM registered_events');
    const lastBranch = combined.indexOf('SELECT *, 2 AS SOURCE_PRIORITY FROM affiliated_upcoming');
    const qualify = combined.indexOf('QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY SOURCE_PRIORITY) = 1');

    // Ordering alone passes on a missing landmark (indexOf returns -1), so require each to exist.
    for (const landmark of [wrapperOpen, firstBranch, lastBranch, qualify]) {
      expect(landmark).toBeGreaterThanOrEqual(0);
    }
    expect(wrapperOpen).toBeLessThan(firstBranch);
    expect(combined.slice(lastBranch, qualify)).toContain(')');
  });

  it('selects EVENT_SOURCE in the past branch', async () => {
    const sql = await sqlFor({ isPast: true });

    expect(sql).toContain('EVENT_SOURCE,');
  });

  it('trims the same whitespace Snowflake-side that isBackfillEventSource trims in JS', async () => {
    // Snowflake's one-argument TRIM strips only spaces. Without the explicit character set a value
    // like '\tbackfill\n' would take the ELSE branch in SQL while the mapper called it Attended,
    // stranding the row in Upcoming with a Past status.
    const sql = await sqlFor({ isPast: true });

    expect(sql).not.toContain('TRIM(EVENT_SOURCE))');
    for (const ws of ['\\t', '\\n', '\\r']) {
      expect(sql).toContain(ws);
    }
    expect(isBackfillEventSource('\tbackfill\n')).toBe(true);
  });
});

describe('EventsService.getMyEvents co-located exclusion', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  async function queryFor(options: Record<string, unknown>): Promise<{ sql: string; binds: string[] }> {
    await service.getMyEvents({} as never, USER_EMAIL, { pageSize: 10, offset: 0, ...options } as never);
    const [sql, binds] = snowflakeMocks.execute.mock.calls[0] as [string, string[]];
    return { sql, binds };
  }

  function placeholderCount(sql: string): number {
    return (sql.match(/\?/g) ?? []).length;
  }

  it('hides co-located events inside affiliated_upcoming only, so registered events are never hidden', async () => {
    const { sql } = await queryFor({ isPast: false, affiliatedProjectSlugs: ['example'] });
    const affiliatedStart = sql.indexOf('affiliated_upcoming AS (');
    const registeredStart = sql.indexOf('registered_events AS (');
    const exclusion = sql.indexOf('AND COALESCE(IS_COLOCATED_EVENT, FALSE) = FALSE');

    for (const landmark of [affiliatedStart, registeredStart, exclusion]) {
      expect(landmark).toBeGreaterThanOrEqual(0);
    }
    expect(affiliatedStart).toBeLessThan(exclusion);
    expect(exclusion).toBeLessThan(registeredStart);
    expect(sql.slice(registeredStart)).not.toContain('IS_COLOCATED_EVENT');
  });

  it('reads the flag from EVENT_REGISTRATIONS without a dimension subquery', async () => {
    const { sql } = await queryFor({ isPast: false, affiliatedProjectSlugs: ['example'] });

    expect(sql).not.toContain('SILVER_DIM.EVENTS');
    expect(sql).not.toContain('NOT IN (SELECT');
  });

  it('adds no binds between the affiliated slugs and the user email', async () => {
    const { binds } = await queryFor({ isPast: false, affiliatedProjectSlugs: ['a', 'b'] });

    expect(binds.slice(0, 3)).toEqual(['a', 'b', USER_EMAIL]);
  });

  it.each([
    ['no affiliated slugs', {}],
    ['an eventId and slugs', { eventId: 'evt-1', affiliatedProjectSlugs: ['a', 'b'] }],
  ])('keeps the bind count equal to the placeholder count with %s', async (_label, options) => {
    const { sql, binds } = await queryFor({ isPast: false, ...options });

    expect(binds).toHaveLength(placeholderCount(sql));
  });

  it('leaves the past branch unfiltered', async () => {
    const { sql } = await queryFor({ isPast: true });

    expect(sql).not.toContain('IS_COLOCATED_EVENT');
  });
});

describe('EventsService.getEventOrganizations registration scope', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  async function queryFor(options: Record<string, unknown>) {
    await service.getEventOrganizations({} as never, USER_EMAIL, options);
    const [sql, binds] = snowflakeMocks.execute.mock.calls[0] as [string, string[]];
    expect(binds).toHaveLength((sql.match(/\?/g) ?? []).length);
    return { sql, binds };
  }

  it('omits affiliated discovery and its binds for My Registrations, including registered co-located events', async () => {
    const { sql, binds } = await queryFor({
      isPast: false,
      registeredOnly: true,
      affiliatedProjectSlugs: ['alpha', 'beta'],
      projectName: 'Example Foundation',
    });

    expect(sql).toContain("LOWER(USER_EMAIL) = ? AND REGISTRATION_STATUS = 'Accepted'");
    expect(sql).not.toContain('LOWER(PROJECT_SLUG)');
    expect(sql).not.toContain('IS_COLOCATED_EVENT');
    expect(binds).toEqual([USER_EMAIL, 'Example Foundation']);
  });

  it.each([undefined, false])('defaults registeredOnly=%s to accepted registrations OR non-co-located affiliated discovery', async (registeredOnly) => {
    const { sql, binds } = await queryFor({ isPast: false, registeredOnly, affiliatedProjectSlugs: ['alpha', 'beta'], projectName: 'Example Foundation' });

    expect(sql).toMatch(
      /\(LOWER\(USER_EMAIL\) = \? AND REGISTRATION_STATUS = 'Accepted'\)\s+OR \(LOWER\(PROJECT_SLUG\) IN \(\?, \?\)\s+AND COALESCE\(IS_COLOCATED_EVENT, FALSE\) = FALSE\)/
    );
    expect(binds).toEqual([USER_EMAIL, 'alpha', 'beta', 'Example Foundation']);
  });

  it.each([true, false])('has no discovery restriction or extra binds without affiliations, registeredOnly=%s', async (registeredOnly) => {
    const { sql, binds } = await queryFor({ isPast: false, registeredOnly });

    expect(sql).not.toContain('LOWER(PROJECT_SLUG)');
    expect(sql).not.toContain('IS_COLOCATED_EVENT');
    expect(binds).toEqual([USER_EMAIL]);
  });

  it.each([true, false])('leaves Past unchanged even with affiliated slugs and registeredOnly=%s', async (registeredOnly) => {
    const { sql, binds } = await queryFor({ isPast: true, registeredOnly, affiliatedProjectSlugs: ['alpha'], projectName: 'Example Foundation' });

    expect(sql).toContain('WHERE LOWER(USER_EMAIL) = ?');
    expect(sql).not.toContain('REGISTRATION_STATUS');
    expect(sql).not.toContain('IS_COLOCATED_EVENT');
    expect(sql).not.toContain('PROJECT_SLUG');
    expect(binds).toEqual([USER_EMAIL, 'Example Foundation']);
  });
});

describe('EventsService.getMyEvents upcoming eligibility filters', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  async function sqlFor(options: Record<string, unknown>): Promise<string> {
    await service.getMyEvents({} as never, USER_EMAIL, { isPast: false, pageSize: 10, offset: 0, ...options } as never);
    return snowflakeMocks.execute.mock.calls[0][0] as string;
  }

  it('matches the user email case-insensitively in both user CTEs', async () => {
    const sql = await sqlFor({ registeredOnly: true });

    expect(sql.match(/WHERE LOWER\(USER_EMAIL\) = \?/g)).toHaveLength(2);
    expect(sql).not.toMatch(/WHERE USER_EMAIL = \?/);
  });

  it('keeps one registration per event, preferring Accepted', async () => {
    const sql = await sqlFor({ registeredOnly: true });

    expect(sql).toContain("QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY IFF(REGISTRATION_STATUS = 'Accepted', 0, 1)) = 1");
  });

  it('requires an Accepted registration by default (visa letters)', async () => {
    const sql = await sqlFor({ registeredOnly: true, isVisaRequestAccepted: true });

    expect(sql.match(/AND REGISTRATION_STATUS = 'Accepted'/g)).toHaveLength(2);
    expect(sql).toContain('AND r.IS_VISA_REQUEST_ACCEPTED = TRUE');
  });
});

describe('EventsService.getTravelFundEvents', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  async function callFor(options: Record<string, unknown> = {}): Promise<[string, unknown[]]> {
    await service.getTravelFundEvents({} as never, { pageSize: 10, offset: 0, ...options } as never);
    return snowflakeMocks.execute.mock.calls[0] as [string, unknown[]];
  }

  it('is independent of the signed-in user and requires an open travel fund event', async () => {
    const [sql, binds] = await callFor();

    expect(sql).not.toContain('USER_EMAIL');
    expect(sql).toContain('BOOLOR_AGG(IS_TRAVEL_FUND_ACCEPTED)');
    expect(sql).toContain('IS NULL OR');
    expect(sql).toContain('>= CURRENT_TIMESTAMP()');
    expect(sql).toContain('QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY EVENT_START_DATE) = 1');
    expect(binds).not.toContain(USER_EMAIL);
  });

  it('treats an open-ended flagged row as an open deadline even when another flagged row has expired', async () => {
    const [sql] = await callFor();

    expect(sql).toContain(
      'IFF(BOOLOR_AGG(IS_TRAVEL_FUND_ACCEPTED AND TRAVEL_FUND_END_TS IS NULL) OVER (PARTITION BY EVENT_ID), NULL, MAX(IFF(IS_TRAVEL_FUND_ACCEPTED, TRAVEL_FUND_END_TS, NULL)) OVER (PARTITION BY EVENT_ID))'
    );
  });

  it('maps rows to events with the travel fund deadline and no registration', async () => {
    snowflakeMocks.execute.mockResolvedValue({
      rows: [buildRow({ IS_REGISTERED: false, REGISTRATION_STATUS: null, TRAVEL_FUND_END_TS: '2026-10-19T00:00:00.000Z', TOTAL_RECORDS: 5 })],
    });

    const result = await service.getTravelFundEvents({} as never, { pageSize: 10, offset: 0 } as never);

    expect(result.total).toBe(5);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'evt-1', travelFundEnd: '2026-10-19T00:00:00.000Z', status: 'Not Registered' });
  });

  it('propagates Snowflake errors so the picker can show its load-error state', async () => {
    snowflakeMocks.execute.mockRejectedValue(new Error('snowflake down'));

    await expect(service.getTravelFundEvents({} as never, { pageSize: 10, offset: 0 } as never)).rejects.toThrow('snowflake down');
  });

  it('filters by event id for the deep link', async () => {
    const [sql, binds] = await callFor({ eventId: 'evt-1' });

    expect(sql).toContain('EVENT_ID = ?');
    expect(binds).toContain('evt-1');
  });
});

describe('EventsService filter options use the same past-event predicate', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  function lastSql(): string {
    return snowflakeMocks.execute.mock.calls[0][0] as string;
  }

  // These feed the tab-scoped filter dropdowns. If they kept the raw column, a backfill event could
  // sit in the Past tab while its foundation stayed in the Upcoming dropdown.
  it('applies the predicate to the past foundations query', async () => {
    await service.getEventOrganizations({} as never, USER_EMAIL, { isPast: true } as never);

    expect(lastSql()).toContain("AND (CASE WHEN LOWER(TRIM(EVENT_SOURCE, ' \\t\\n\\r')) = 'backfill'");
    expect(lastSql()).not.toContain('IS_PAST_EVENT = TRUE');
  });

  it('applies the negated predicate to the upcoming foundations query', async () => {
    await service.getEventOrganizations({} as never, USER_EMAIL, { isPast: false, affiliatedProjectSlugs: ['example'] } as never);

    expect(lastSql()).toContain('WHERE NOT (CASE WHEN');
    expect(lastSql()).not.toContain('IS_PAST_EVENT = FALSE');
    expect(lastSql()).toContain("LOWER(USER_EMAIL) = ? AND REGISTRATION_STATUS = 'Accepted'");
  });

  it('applies the negated predicate to the upcoming countries query', async () => {
    await service.getUpcomingCountries({} as never);

    expect(lastSql()).toContain('WHERE NOT (CASE WHEN');
    expect(lastSql()).not.toContain('IS_PAST_EVENT = FALSE');
  });
});

describe('EventsService past and request lists match email case-insensitively', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });
    service = new EventsService();
  });

  function lastSql(): string {
    return snowflakeMocks.execute.mock.calls[0][0] as string;
  }

  it('dedups the past list per event, preferring Accepted', async () => {
    await service.getMyEvents({} as never, USER_EMAIL, { isPast: true, pageSize: 10, offset: 0 } as never);

    expect(lastSql()).toContain('WHERE LOWER(USER_EMAIL) = ?');
    expect(lastSql()).toContain("QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY IFF(REGISTRATION_STATUS = 'Accepted', 0, 1)) = 1");
    expect(lastSql()).not.toMatch(/WHERE USER_EMAIL = \?/);
  });

  it('matches the past foundations query case-insensitively', async () => {
    await service.getEventOrganizations({} as never, USER_EMAIL, { isPast: true } as never);

    expect(lastSql()).toContain('WHERE LOWER(USER_EMAIL) = ?');
  });

  it.each([
    ['getVisaRequests', 'VL_APPLICATION_DATE'],
    ['getTravelFundRequests', 'TF_APPLICATION_DATE'],
  ] as const)('%s keeps the latest request per event', async (method, dateColumn) => {
    await service[method]({} as never, USER_EMAIL, { pageSize: 10, offset: 0 } as never);

    expect(lastSql()).toContain('AND LOWER(USER_EMAIL) = ?');
    expect(lastSql()).toContain(`QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY ${dateColumn} DESC NULLS LAST) = 1`);
  });
});

describe('EventsService.isEligibleForEventRequest', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EventsService();
  });

  function lastCall(): [string, unknown[]] {
    return snowflakeMocks.execute.mock.calls[0] as [string, unknown[]];
  }

  it('requires an accepted registration and visa requests for visa letters', async () => {
    snowflakeMocks.execute.mockResolvedValue({ rows: [{ ELIGIBLE: 1 }] });

    await expect(service.isEligibleForEventRequest({} as never, USER_EMAIL, 'evt-1', 'visa')).resolves.toBe(true);

    const [sql, binds] = lastCall();
    expect(sql).toContain('WHERE LOWER(USER_EMAIL) = ?');
    expect(sql).toContain('AND NOT (CASE WHEN');
    expect(sql).toContain("AND REGISTRATION_STATUS = 'Accepted' AND IS_VISA_REQUEST_ACCEPTED = TRUE");
    expect(binds).toEqual([USER_EMAIL, 'evt-1']);
  });

  it('checks the event, not the user, for travel funding and requires an open deadline', async () => {
    snowflakeMocks.execute.mockResolvedValue({ rows: [{ ELIGIBLE: 1 }] });

    await expect(service.isEligibleForEventRequest({} as never, USER_EMAIL, 'evt-1', 'travel-fund')).resolves.toBe(true);

    const [sql, binds] = lastCall();
    expect(sql).not.toContain('USER_EMAIL');
    expect(sql).toContain('BOOLOR_AGG(IS_TRAVEL_FUND_ACCEPTED)');
    expect(sql).toContain(
      'IFF(BOOLOR_AGG(IS_TRAVEL_FUND_ACCEPTED AND TRAVEL_FUND_END_TS IS NULL), NULL, MAX(IFF(IS_TRAVEL_FUND_ACCEPTED, TRAVEL_FUND_END_TS, NULL)))'
    );
    expect(sql).toContain('>= CURRENT_TIMESTAMP()');
    expect(binds).toEqual(['evt-1']);
  });

  it('returns false when no registration matches', async () => {
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });

    await expect(service.isEligibleForEventRequest({} as never, USER_EMAIL, 'evt-1', 'visa')).resolves.toBe(false);
  });

  it('propagates Snowflake errors instead of reporting ineligible', async () => {
    snowflakeMocks.execute.mockRejectedValue(new Error('snowflake down'));

    await expect(service.isEligibleForEventRequest({} as never, USER_EMAIL, 'evt-1', 'travel-fund')).rejects.toThrow('snowflake down');
  });
});

describe('EventsService.getVisaRequests event-ended gate', () => {
  let service: InstanceType<typeof EventsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EventsService();
  });

  function visaRow(eventEnded: unknown): Record<string, unknown> {
    return {
      EVENT_ID: 'evt-1',
      EVENT_NAME: 'Example Community Summit',
      EVENT_URL: null,
      EVENT_LOCATION: null,
      EVENT_CITY: 'Shanghai',
      EVENT_COUNTRY: 'China',
      APPLICATION_DATE: '2026-06-01T00:00:00.000Z',
      REQUEST_STATUS: 'Approved',
      TRAVEL_FUND_END_TS: null,
      EVENT_ENDED: eventEnded,
      TOTAL_RECORDS: 1,
    };
  }

  it('selects EVENT_ENDED from the end date, falling back to the start date', async () => {
    snowflakeMocks.execute.mockResolvedValue({ rows: [] });

    await service.getVisaRequests({} as never, USER_EMAIL, { pageSize: 10, offset: 0 } as never);

    expect(snowflakeMocks.execute.mock.calls[0][0]).toContain('COALESCE(EVENT_END_DATE, EVENT_START_DATE) < CURRENT_DATE() AS EVENT_ENDED');
  });

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])('maps EVENT_ENDED %j to eventEnded %j', async (eventEnded, expected) => {
    snowflakeMocks.execute.mockResolvedValue({ rows: [visaRow(eventEnded)] });

    const result = await service.getVisaRequests({} as never, USER_EMAIL, { pageSize: 10, offset: 0 } as never);

    expect(result.data[0].eventEnded).toBe(expected);
  });
});
