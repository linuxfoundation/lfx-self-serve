// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` subpaths aren't wired into this app's
// vitest config, so each is mocked. The event/url/date helpers are pulled in via importActual
// rather than stubbed — the backfill match is the behaviour under test here, so a stub would let
// it regress with the tests still green.
const snowflakeMocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({
  COMING_SOON_SENTINEL: 'coming-soon',
  DEFAULT_EVENT_SORT_FIELD: 'EVENT_START_DATE',
  DEFAULT_VISA_REQUEST_SORT_FIELD: 'APPLICATION_DATE',
  EVENT_SOURCE_BACKFILL: 'backfill',
  MY_EVENT_STATUS: { ATTENDED: 'Attended', REGISTERED: 'Registered', NOT_REGISTERED: 'Not Registered' },
  VALID_EVENT_SORT_FIELDS: new Set(['EVENT_NAME', 'PROJECT_NAME', 'EVENT_START_DATE', 'EVENT_CITY']),
  VALID_VISA_REQUEST_SORT_FIELDS: new Set(['EVENT_NAME', 'EVENT_CITY', 'APPLICATION_DATE']),
  WHOLE_NUMBER_PATTERN: /^\d+$/,
}));
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

    expect(sql).toContain("LOWER(TRIM(EVENT_SOURCE)) = 'backfill'");
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

  it('selects EVENT_SOURCE in the past branch', async () => {
    const sql = await sqlFor({ isPast: true });

    expect(sql).toContain('EVENT_SOURCE,');
  });
});
