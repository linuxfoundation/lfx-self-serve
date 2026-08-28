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
    // Each branch landmark pins its priority literal to its source, so swapping them fails here;
    // the QUALIFY landmark closes at ")", so an ORDER BY flipped to DESC stops matching too.
    const firstBranch = combined.indexOf('SELECT *, 1 AS SOURCE_PRIORITY FROM registered_events');
    const lastBranch = combined.indexOf('SELECT *, 2 AS SOURCE_PRIORITY FROM affiliated_upcoming');
    const qualify = combined.indexOf('QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY SOURCE_PRIORITY)');

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
  });

  it('applies the negated predicate to the upcoming countries query', async () => {
    await service.getUpcomingCountries({} as never);

    expect(lastSql()).toContain('WHERE NOT (CASE WHEN');
    expect(lastSql()).not.toContain('IS_PAST_EVENT = FALSE');
  });
});
