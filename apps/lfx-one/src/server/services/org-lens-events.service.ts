// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  GetOrgEventsOptions,
  OrgEvent,
  OrgEventAttendee,
  OrgEventAttendeesDrawerResponse,
  OrgEventAttendeesDrawerRow,
  OrgEventRow,
  OrgEventSpeaker,
  OrgEventSpeakersDrawerRow,
  OrgEventSpeakersResponse,
  OrgEventsResponse,
  OrgEventsSummary,
  OrgEventsSummaryRow,
} from '@lfx-one/shared/interfaces';
import { formatDateToUTC, isObjectRow, isObjectRowArray, normalizeToUrl } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Service for org-lens event list endpoints — reads org event footprint from platinum ORG_EVENTS. */
export class OrgLensEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** GET /api/orgs/:accountId/lens/events — paginated list of events for the org. */
  public async getOrgEvents(req: Request, accountId: string, options: GetOrgEventsOptions): Promise<OrgEventsResponse> {
    const { isPast, searchQuery, status, pageSize, offset, sortField, sortOrder } = options;

    /** Allowlist of columns that may appear in ORDER BY to prevent SQL injection. */
    const VALID_SORT_COLUMNS: ReadonlySet<string> = new Set(['EVENT_NAME', 'EVENT_START_DATE', 'EVENT_CITY']);
    const sortColumn = VALID_SORT_COLUMNS.has(sortField) ? sortField : 'EVENT_START_DATE';

    logger.debug(req, 'get_org_lens_events', 'Building org events query', {
      account_id: accountId,
      is_past: isPast,
      has_search: !!searchQuery,
      status,
      page_size: pageSize,
      offset,
    });

    const searchQueryFilter = searchQuery ? 'AND oe.EVENT_NAME ILIKE ?' : '';

    /**
     * The list in two spellings. `scoped` is the real one; the unscoped one reads the precomputed
     * `ORG_EVENTS.ORG_REGISTRATION_COUNT` and never touches the address table, and exists only for the
     * degraded path in the catch below. `status=registered` has to follow the same expression, or the
     * filter offers rows whose displayed count is 0.
     */
    const buildListQuery = (mode: ListQueryMode): { sql: string; binds: string[] } => {
      const scoped = mode === 'scoped';
      // `platinum` is the pre-PR query: ORG_EVENTS alone, no registrations, no address table. It is
      // the only spelling that survives EVENT_REGISTRATIONS being unavailable — which this PR made
      // load-bearing for the list when it started recomputing counts.
      const countExpression = mode === 'platinum' ? 'oe.ORG_REGISTRATION_COUNT' : 'COALESCE(cr.REGISTRATION_COUNT, 0)';
      let statusFilter = '';
      if (status === 'registered') {
        statusFilter = `AND ${countExpression} > 0`;
      } else if (status === 'speaker-submitted') {
        statusFilter = 'AND oe.ORG_SPEAKER_SUBMITTED_COUNT > 0';
      } else if (status === 'speaker-accepted') {
        statusFilter = 'AND oe.ORG_SPEAKER_ACCEPTED_COUNT > 0';
      } else if (status === 'event-sponsor') {
        statusFilter = 'AND oe.IS_ORG_SPONSOR = TRUE';
      }

      const pastCondition = isPast ? 'oe.IS_PAST_EVENT = TRUE' : 'oe.IS_PAST_EVENT = FALSE';

      const sql = `
      ${mode === 'platinum' ? '' : registrationCountsCte(scoped)}
      SELECT
        oe.EVENT_ID,
        oe.EVENT_NAME,
        oe.FOUNDATION_NAME,
        oe.EVENT_START_DATE,
        oe.EVENT_END_DATE,
        oe.EVENT_LOCATION,
        oe.EVENT_CITY,
        oe.EVENT_COUNTRY,
        oe.EVENT_URL,
        oe.EVENT_REGISTRATION_URL,
        ${countExpression} AS ORG_REGISTRATION_COUNT,
        NULLIF(oe.EVENT_REGISTRATIONS_GOAL, 0) AS EVENT_REGISTRATIONS_GOAL,
        oe.ORG_SPEAKER_ACCEPTED_COUNT,
        oe.ORG_SPEAKER_SUBMITTED_COUNT,
        oe.IS_ORG_SPONSOR,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
      ${mode === 'platinum' ? '' : 'LEFT JOIN event_registration_counts cr ON cr.EVENT_ID = oe.EVENT_ID'}
      WHERE oe.ACCOUNT_ID = ?
        AND ${pastCondition}
        ${searchQueryFilter}
        ${statusFilter}
      ORDER BY oe.${sortColumn} ${sortOrder}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

      // Positional binds, in statement order: coverage CTE (scoped only), counts CTE (not platinum),
      // then the outer WHERE.
      const bindCountByMode: Record<ListQueryMode, number> = { scoped: 3, unscoped: 2, platinum: 1 };
      const binds: string[] = Array.from({ length: bindCountByMode[mode] }, () => accountId);
      if (searchQuery) binds.push(`%${searchQuery}%`);
      return { sql, binds };
    };

    const scopedQuery = buildListQuery('scoped');

    let rows: OrgEventRow[];
    try {
      rows = await withOrgCache(
        accountId,
        // `:v2` — the count is now company-email-scoped; entries written before this ship hold unfiltered counts.
        `events:v2:${paramSignature([isPast, status ?? null, searchQuery ?? null, pageSize, offset, sortColumn, sortOrder])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchEventListRows(scopedQuery.sql, scopedQuery.binds, true),
        isEventRowArray
      );
    } catch (scopedError) {
      /**
       * Before this rule the list read ORG_EVENTS alone. Joining the address table means its being
       * missing, ungranted or mid-deploy would take the whole Events page down — an org with events
       * would render as an org with none, which is indistinguishable from the truth. `org-lens-people`
       * treats this same table as independently failable, so this does too.
       *
       * ONLY for a confirmed missing object. Retrying after any failure would drop the company-email
       * filter whenever the scoped query timed out or hit a transient fault with the address table
       * perfectly healthy — silently showing personal-email registrants, which is the one thing this
       * rule exists to prevent. A timeout retry would also pile on work while the first query may
       * still be holding its connection.
       *
       * Deliberately NOT cached. The result is unscoped, and storing it under the scoped key would
       * keep serving unfiltered counts long after the table came back.
       */
      if (!SnowflakeService.isMissingObjectError(scopedError)) {
        logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', {
          err: scopedError,
          account_id: accountId,
        });
        return { data: [], total: 0, pageSize, offset };
      }

      // Something else is missing, so the unscoped spelling — which reads the same core tables —
      // cannot succeed either. Skip straight to the tier that might, instead of spending a breaker
      // failure proving it.
      if (!isMissingObject(scopedError, COMPANY_EMAILS_TABLE)) {
        logger.warning(req, 'get_org_lens_events', 'Core table unavailable, falling back to the platinum count', {
          err: scopedError,
          account_id: accountId,
        });
        const directPlatinum = buildListQuery('platinum');
        try {
          rows = await this.fetchEventListRows(directPlatinum.sql, directPlatinum.binds);
          return this.toEventsResponse(req, rows, pageSize, offset);
        } catch (platinumError) {
          logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', {
            err: platinumError,
            account_id: accountId,
          });
          return { data: [], total: 0, pageSize, offset };
        }
      }

      logger.warning(req, 'get_org_lens_events', 'Address table unavailable, retrying unscoped', {
        err: scopedError,
        account_id: accountId,
      });
      const fallbackQuery = buildListQuery('unscoped');
      try {
        rows = await this.fetchEventListRows(fallbackQuery.sql, fallbackQuery.binds);
      } catch (unscopedError) {
        /**
         * Last resort. Recomputing the count made EVENT_REGISTRATIONS load-bearing for a list that
         * never needed it before this PR, so its being unavailable would now blank the page the same
         * way the address table once did. ORG_EVENTS alone still answers "what events does this org
         * have", with the precomputed count. The drawer cannot degrade this far — it has nothing to
         * list without registrations — so a row count here may stand beside an empty drawer. Showing
         * the org's events with a stale count beats telling it that it has none.
         */
        if (!SnowflakeService.isMissingObjectError(unscopedError)) {
          logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', {
            err: unscopedError,
            account_id: accountId,
          });
          return { data: [], total: 0, pageSize, offset };
        }

        logger.warning(req, 'get_org_lens_events', 'Registrations unavailable, falling back to the platinum count', {
          err: unscopedError,
          account_id: accountId,
        });
        const platinumQuery = buildListQuery('platinum');
        try {
          rows = await this.fetchEventListRows(platinumQuery.sql, platinumQuery.binds);
        } catch (error) {
          logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', {
            err: error,
            account_id: accountId,
          });
          return { data: [], total: 0, pageSize, offset };
        }
      }
    }

    return this.toEventsResponse(req, rows, pageSize, offset);
  }

  /** GET /api/orgs/:accountId/lens/events/summary — org-wide total / past / upcoming counts for the stat strip. */
  public async getOrgEventsSummary(req: Request, accountId: string): Promise<OrgEventsSummary> {
    logger.debug(req, 'get_org_lens_events_summary', 'Building org events summary query', { account_id: accountId });

    const sql = `
      SELECT
        COUNT(*)                                                                                    AS TOTAL_EVENTS,
        COUNT(CASE WHEN oe.IS_PAST_EVENT = TRUE  THEN 1 END)                                       AS PAST_EVENTS,
        COUNT(CASE WHEN oe.IS_PAST_EVENT = FALSE THEN 1 END)                                       AS UPCOMING_EVENTS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
      WHERE oe.ACCOUNT_ID = ?
    `;

    let rows: OrgEventsSummaryRow[];
    try {
      rows = await withOrgCache(
        accountId,
        'events-summary',
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchEventsSummaryRows(accountId, sql),
        isObjectRowArray
      );
    } catch (error) {
      logger.warning(req, 'get_org_lens_events_summary', 'Snowflake query failed, returning zero counts', {
        err: error,
        account_id: accountId,
      });
      return { totalEvents: 0, pastEvents: 0, upcomingEvents: 0 };
    }

    const row = rows[0];
    const summary: OrgEventsSummary = {
      totalEvents: row?.TOTAL_EVENTS ?? 0,
      pastEvents: row?.PAST_EVENTS ?? 0,
      upcomingEvents: row?.UPCOMING_EVENTS ?? 0,
    };

    logger.debug(req, 'get_org_lens_events_summary', 'Fetched org events summary', { ...summary });

    return summary;
  }

  /** GET /api/orgs/:accountId/lens/events/:eventId/attendees — org registrants for a specific event. */
  public async getEventAttendees(req: Request, accountId: string, eventId: string, searchQuery?: string): Promise<OrgEventAttendeesDrawerResponse> {
    logger.debug(req, 'get_event_attendees', 'Fetching event attendees', { account_id: accountId, event_id: eventId });

    const searchFilter = searchQuery ? 'AND (UPPER(COALESCE(er.FULL_NAME, er.EMAIL)) LIKE UPPER(?) OR UPPER(er.EMAIL) LIKE UPPER(?))' : '';

    /** As with the list: the scoped drawer, and the pre-rule one for the degraded path below. */
    const buildAttendeesQuery = (scoped: boolean): { sql: string; binds: string[] } => {
      const sql = `
      ${scoped ? `WITH ${COMPANY_EMAIL_COVERAGE_CTE}` : ''}
      SELECT
        ${REGISTRANT_EMAIL_KEY}                        AS CONTACT_ID,
        MAX(COALESCE(p.NAME, er.FULL_NAME, er.EMAIL))  AS NAME,
        MAX(COALESCE(p.TITLE, er.JOB_TITLE))           AS JOB_TITLE,
        MAX(er.EVENT_NAME)                             AS EVENT_NAME
      FROM ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS er
      ${scoped ? COMPANY_EMAIL_JOINS : ''}
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
        ON ${ORG_PERSON_EMAIL_KEY} = ${REGISTRANT_EMAIL_KEY} AND p.ACCOUNT_ID = ?
      WHERE er.EVENT_ID = ?
        AND er.ACCOUNT_ID = ?
        AND ${REGISTRANT_HAS_ADDRESS}
        ${scoped ? `AND ${COMPANY_EMAIL_QUALIFIES}` : ''}
        ${searchFilter}
      GROUP BY ${REGISTRANT_EMAIL_KEY}
      ORDER BY NAME ASC NULLS LAST
    `;

      // Positional binds, in statement order: coverage CTE when scoped, the ORG_PEOPLE_ALL join, the WHERE.
      const binds: string[] = scoped ? [accountId, accountId, eventId, accountId] : [accountId, eventId, accountId];
      if (searchQuery) {
        binds.push(`%${searchQuery}%`, `%${searchQuery}%`);
      }
      return { sql, binds };
    };

    const scopedQuery = buildAttendeesQuery(true);

    let rows: OrgEventAttendeesDrawerRow[];
    try {
      rows = await withOrgCache(
        accountId,
        // `:v2` — the row set is now company-email-scoped; see the `events:v2` note above.
        `event-attendees:v2:${paramSignature([eventId, searchQuery ?? null])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchEventAttendeeRows(scopedQuery.sql, scopedQuery.binds, true),
        isContactRowArray
      );
    } catch (scopedError) {
      // Same reasoning as the list, including the missing-object guard: any other failure must not
      // quietly drop the filter. Both surfaces fall back on the same condition, so a row and the
      // drawer it opens still agree.
      // Not a missing object, or the missing object is one the unscoped spelling needs too: either
      // way the retry cannot succeed, and running it would spend a breaker failure to find that out.
      // Concurrent drawer opens during an EVENT_REGISTRATIONS outage would do so once per request.
      if (!isMissingObject(scopedError, COMPANY_EMAILS_TABLE)) {
        logger.warning(req, 'get_event_attendees', 'Snowflake query failed, returning empty attendees', {
          err: scopedError,
          account_id: accountId,
          event_id: eventId,
        });
        return { eventId, eventName: '', total: 0, data: [] };
      }

      logger.warning(req, 'get_event_attendees', 'Address table unavailable, retrying unscoped', {
        err: scopedError,
        account_id: accountId,
        event_id: eventId,
      });
      const fallbackQuery = buildAttendeesQuery(false);
      try {
        rows = await this.fetchEventAttendeeRows(fallbackQuery.sql, fallbackQuery.binds);
      } catch (error) {
        logger.warning(req, 'get_event_attendees', 'Snowflake query failed, returning empty attendees', {
          err: error,
          account_id: accountId,
          event_id: eventId,
        });
        return { eventId, eventName: '', total: 0, data: [] };
      }
    }

    const eventName = rows[0]?.EVENT_NAME ?? '';
    const data: OrgEventAttendee[] = rows.map((row) => ({
      contactId: row.CONTACT_ID,
      name: row.NAME ?? row.CONTACT_ID,
      jobTitle: row.JOB_TITLE ?? null,
    }));

    logger.debug(req, 'get_event_attendees', 'Fetched event attendees', { count: data.length, event_id: eventId });

    return { eventId, eventName, total: data.length, data };
  }

  /** GET /api/orgs/:accountId/lens/events/:eventId/speakers — org speakers (accepted + submitted) for a specific event. */
  public async getEventSpeakers(req: Request, accountId: string, eventId: string, searchQuery?: string): Promise<OrgEventSpeakersResponse> {
    logger.debug(req, 'get_event_speakers', 'Fetching event speakers', { account_id: accountId, event_id: eventId });

    const speakerName = "COALESCE(NULLIF(TRIM(es.SPEAKER_FIRST_NAME || ' ' || es.SPEAKER_LAST_NAME), ''), es.SPEAKER_EMAIL)";
    const searchFilter = searchQuery ? `AND (UPPER(${speakerName}) LIKE UPPER(?) OR UPPER(es.SPEAKER_EMAIL) LIKE UPPER(?))` : '';

    const sql = `
      SELECT
        es.SPEAKER_ID                                         AS CONTACT_ID,
        MAX(${speakerName})                                   AS NAME,
        MAX(es.JOB_TITLE)                                     AS JOB_TITLE,
        MAX(CASE WHEN es.SPEAKER_STATUS = 'Accepted' THEN 1 ELSE 0 END) AS IS_ACCEPTED,
        MAX(es.EVENT_NAME)                                    AS EVENT_NAME
      FROM ANALYTICS.SILVER_FACT.EVENT_SPEAKERS es
      WHERE es.EVENT_ID = ?
        AND es.ACCOUNT_ID = ?
        ${searchFilter}
      GROUP BY es.SPEAKER_ID
      ORDER BY NAME ASC NULLS LAST
    `;

    const binds: string[] = [eventId, accountId];
    if (searchQuery) {
      binds.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    let rows: OrgEventSpeakersDrawerRow[];
    try {
      rows = await withOrgCache(
        accountId,
        `event-speakers:${paramSignature([eventId, searchQuery ?? null])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchEventSpeakerRows(sql, binds),
        isContactRowArray
      );
    } catch (error) {
      logger.warning(req, 'get_event_speakers', 'Snowflake query failed, returning empty speakers', {
        err: error,
        account_id: accountId,
        event_id: eventId,
      });
      return { eventId, eventName: '', acceptedCount: 0, submittedCount: 0, data: [] };
    }

    const eventName = rows[0]?.EVENT_NAME ?? '';
    const data: OrgEventSpeaker[] = rows.map((row) => ({
      contactId: row.CONTACT_ID,
      name: row.NAME ?? row.CONTACT_ID,
      jobTitle: row.JOB_TITLE ?? null,
      status: row.IS_ACCEPTED ? 'ACCEPTED' : 'SUBMITTED',
    }));

    const acceptedCount = data.filter((s) => s.status === 'ACCEPTED').length;
    const submittedCount = data.length;

    logger.debug(req, 'get_event_speakers', 'Fetched event speakers', { accepted: acceptedCount, submitted: submittedCount, event_id: eventId });

    return { eventId, eventName, acceptedCount, submittedCount, data };
  }

  /**
   * `expectMissingObject` marks one thing: this statement references an object that may legitimately
   * not exist yet. Only the SCOPED spellings do — `ORG_PEOPLE_COMPANY_EMAILS`. The unscoped and
   * platinum spellings read `ORG_EVENTS`, `EVENT_REGISTRATIONS` and `ORG_PEOPLE_ALL`, all core; their
   * absence is a genuine fault that must keep its error telemetry and count toward the breaker, not
   * be filed as an expected schema rollout.
   *
   * The whole point of the unscoped retry is that
   * `ORG_PEOPLE_COMPANY_EMAILS` may be absent or ungranted — a schema-rollout condition, not a
   * Snowflake outage. Without this flag that error calls `recordFailure()` on the POD-WIDE breaker,
   * and because the fallback is deliberately uncached every request re-runs the failing query: a
   * handful of concurrent org loads would open the breaker and fail every Snowflake surface for the
   * reset window. The retry would then be blocked too, turning a degraded Events count into the
   * outage this path exists to prevent. The flag still rejects, so the fallback runs as before.
   */
  /** Shared by the normal path and the early platinum return, so both shape the response identically. */
  private toEventsResponse(req: Request, rows: OrgEventRow[], pageSize: number, offset: number): OrgEventsResponse {
    const total = rows.length > 0 ? rows[0].TOTAL_RECORDS : 0;
    const data = rows.map((row) => this.mapRowToOrgEvent(row));

    logger.debug(req, 'get_org_lens_events', 'Fetched org events', { count: data.length, total });

    return { data, total, pageSize, offset };
  }

  private async fetchEventListRows(sql: string, binds: string[], scoped = false): Promise<OrgEventRow[]> {
    const result = await this.snowflakeService.execute<OrgEventRow>(sql, binds, scoped ? { expectMissingObject: true } : undefined);
    return result.rows;
  }

  private async fetchEventsSummaryRows(accountId: string, sql: string): Promise<OrgEventsSummaryRow[]> {
    const result = await this.snowflakeService.execute<OrgEventsSummaryRow>(sql, [accountId]);
    return result.rows;
  }

  /** Same reasoning as `fetchEventListRows`: the scoped drawer may legitimately find no address table. */
  private async fetchEventAttendeeRows(sql: string, binds: string[], scoped = false): Promise<OrgEventAttendeesDrawerRow[]> {
    const result = await this.snowflakeService.execute<OrgEventAttendeesDrawerRow>(sql, binds, scoped ? { expectMissingObject: true } : undefined);
    return result.rows;
  }

  private async fetchEventSpeakerRows(sql: string, binds: string[]): Promise<OrgEventSpeakersDrawerRow[]> {
    const result = await this.snowflakeService.execute<OrgEventSpeakersDrawerRow>(sql, binds);
    return result.rows;
  }

  private mapRowToOrgEvent(row: OrgEventRow): OrgEvent {
    return {
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME,
      foundation: row.FOUNDATION_NAME ?? null,
      eventStartDate: formatDateToUTC(row.EVENT_START_DATE),
      eventEndDate: row.EVENT_END_DATE ? formatDateToUTC(row.EVENT_END_DATE) : null,
      eventLocation: row.EVENT_LOCATION ?? null,
      eventCity: row.EVENT_CITY ?? null,
      eventCountry: row.EVENT_COUNTRY ?? null,
      // normalizeToUrl prepends https:// to scheme-less DB URLs and drops unsafe ones so the template href stays absolute.
      eventUrl: normalizeToUrl(row.EVENT_URL ?? ''),
      eventRegistrationUrl: normalizeToUrl(row.EVENT_REGISTRATION_URL ?? ''),
      orgAttendeeCount: row.ORG_REGISTRATION_COUNT || 0,
      eventRegistrationsGoal: row.EVENT_REGISTRATIONS_GOAL ?? null,
      orgSpeakerAcceptedCount: row.ORG_SPEAKER_ACCEPTED_COUNT || 0,
      orgSpeakerSubmittedCount: row.ORG_SPEAKER_SUBMITTED_COUNT || 0,
      isOrgSponsor: !!row.IS_ORG_SPONSOR,
    };
  }
}

/**
 * Snowflake's single-argument `TRIM` removes spaces and nothing else — its docs are explicit that
 * "a specification of `' '` in characters does not remove other whitespace characters". A tab- or
 * newline-padded address would therefore survive normalization and match nothing, excluding a real
 * registrant whenever the account has coverage.
 *
 * Spelled with code points rather than the obvious `TRIM(x, '\t\n\r ')`, because that literal is
 * not portable and fails unsafely: SQLite does not treat backslash as an escape, so the character
 * set reads as the literal characters `\`, `t`, `n`, `r` and space — and
 * `TRIM('ada@company.test ', '\t\n\r ')` returns `ada@company.tes`, silently eating the `t`. The
 * spec harness runs this SQL against SQLite, so that spelling would corrupt addresses in tests while
 * behaving differently in production. `CHR` is unambiguous in Snowflake; the harness maps it to
 * SQLite's `char`.
 *
 * The set is tab, LF, CR, NBSP and space — deliberately a chosen list, not the Unicode whitespace
 * class. NBSP earns its place because addresses are pasted out of documents and web forms, where it
 * is the one non-obvious character that survives. The rarer separators (U+2007, U+202F, U+200B and
 * friends) are not covered: matching them properly wants a regex, `REGEXP_REPLACE` is not available
 * in the SQLite harness, and normalization at this grain belongs in the platinum model anyway. If the
 * list needs to grow again, that is the signal to do it in dbt under #4409 rather than extend here.
 */
const EMAIL_WHITESPACE = `CHR(9) || CHR(10) || CHR(13) || CHR(160) || ' '`;

/** One normalization, used everywhere an address is compared, grouped, counted or tested for blankness. */
function normalizedEmail(column: string): string {
  return `LOWER(TRIM(${column}, ${EMAIL_WHITESPACE}))`;
}

/**
 * Account-wide coverage probe for the address table, as an UNCORRELATED CTE.
 *
 * Rows whose address is null or blank are not counted: they cannot match any registration, so letting
 * one stand for coverage would switch the fallback off while supplying nothing to filter by — every
 * count on the page would go to 0, which is the exact outcome the fallback exists to prevent.
 *
 * It exists in this shape for a dialect reason, not a stylistic one: Snowflake does not allow a
 * correlated `EXISTS` as an argument to `OR`, so the obvious spelling of the fallback —
 * `EXISTS (…matches…) OR NOT EXISTS (…any row for this account…)` — fails to compile. Both query
 * paths catch and degrade to empty, so the failure would have surfaced as a silently blank page on
 * every cache miss rather than as an error. Hoisting coverage into a one-row CTE keeps both `OR`
 * operands plain column predicates. Takes one bind (the account id).
 */
const COMPANY_EMAIL_COVERAGE_CTE = `company_email_coverage AS (
        SELECT COUNT(*) AS COVERAGE_ROWS
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS
        WHERE ACCOUNT_ID = ?
          AND NULLIF(TRIM(EMAIL, ${EMAIL_WHITESPACE}), '') IS NOT NULL
      )`;

/**
 * Joins that decide whether a registration's address is one this org holds. The `LEFT JOIN` may fan a
 * registration out when an address is recorded against more than one person key, which is harmless
 * here: both readers are already distinct on the address, counting and grouping on
 * `REGISTRANT_EMAIL_KEY`. `company_email_coverage` is one row, so the `CROSS JOIN` does not multiply.
 * Needs no bind of its own.
 */
const COMPANY_EMAIL_JOINS = `CROSS JOIN company_email_coverage cov
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS ce
        ON ce.ACCOUNT_ID = er.ACCOUNT_ID
        AND ${normalizedEmail('ce.EMAIL')} = ${normalizedEmail('er.EMAIL')}`;

/**
 * A registration counts for this org only when its address is one the warehouse already holds for the
 * org — `ORG_PEOPLE_COMPANY_EMAILS` is the employer ∩ employee intersection the person-detail drawer
 * reads. Upstream `ACCOUNT_ID` attribution does not require a company address (a personal address on a
 * profile that links to the org still lands there), which is exactly what the first arm excludes.
 *
 * The second arm is a no-regression guard, not a loosening of the rule. An account with NO rows in the
 * address table has no coverage to filter by, and filtering on it anyway would turn every count on the
 * page to 0 — indistinguishable, to the viewer, from an org that attended nothing. `org-lens-people`
 * reads the same table and refuses the same inference, reporting absent address data as `unavailable`
 * rather than as "none on record". So zero coverage falls back to the unfiltered set, which is exactly
 * what shipped before this rule existed. Partial coverage is not detectable here and is not guarded.
 *
 * Both the per-event count and the drawer embed this one predicate, so the two can never disagree about
 * who qualifies — including on the fallback path.
 *
 * KNOWN GAP, NOT CLOSED HERE. A zero-coverage result is unfiltered, and it IS cached. Refusing the
 * write (as an earlier revision did) meant every list load and every drawer open for such an org ran
 * the account-wide aggregate live — a permanent cost on exactly the orgs this fallback exists for, to
 * avoid a staleness window that opens once, when coverage first lands, and closes within one TTL.
 * Wrong trade; the window is documented instead.
 *
 * KNOWN GAP, NOT CLOSED HERE. The list and the drawer are separate requests with separate cache
 * entries, so each picks its own spelling. During an address-table outage a list row served from a
 * cache entry written while the table was healthy (scoped) can sit next to a drawer that just fell
 * back (unscoped), and the drawer then lists people the row did not count. Both are internally
 * consistent; they disagree with each other for at most one `ORG_LENS_SNOWFLAKE_TTL_SECONDS`, and
 * they re-converge once the entry expires or the table returns. Closing it properly means carrying
 * the chosen scope across both requests and both cache keys, or reporting the drawer as unavailable
 * when it cannot honour the list's scope — the labelled-unavailable surface tracked in #4408.
 *
 * KNOWN, DELIBERATE GAP. The non-blank requirement applies on the fallback path too, so a registration
 * with no address at all is dropped there, where before this rule it would have reached the drawer.
 * Upstream dedup is `PARTITION BY email, event_id` and NULLs partition together, so this is at most one
 * row per event. Keeping it would mean emitting an attendee whose `CONTACT_ID` is null — against the
 * non-nullable `OrgEventAttendee.contactId`, rejected by `isContactRowArray` so the event's whole cache
 * entry is refused on every read, and invisible to `COUNT(DISTINCT …)` so the row and the drawer would
 * disagree again. Giving it a synthesized identity instead needs a registration-level key this query
 * does not select. Revisit with the platinum measure in #4409, where the grain can carry one.
 */
const COMPANY_EMAIL_QUALIFIES = `(ce.EMAIL IS NOT NULL OR cov.COVERAGE_ROWS = 0)`;

/**
 * A registrant needs a usable address whichever spelling is running. This half of the rule is NOT
 * about company scoping, so it applies to the unscoped fallback too: without it that path returns a
 * row whose `CONTACT_ID` is null — against the non-nullable `OrgEventAttendee.contactId`, rejected by
 * `isContactRowArray`, and with a null `name` when the registration carries none either, which the
 * drawer then calls `computePersonInitials` on. The scoped predicate used to carry this clause, so
 * splitting the fallback out of it originally dropped the guard on exactly the degraded path.
 */
const REGISTRANT_HAS_ADDRESS = `NULLIF(TRIM(er.EMAIL, ${EMAIL_WHITESPACE}), '') IS NOT NULL`;

/**
 * The identity of a registrant, for counting and for grouping. Addresses reach the fact table in
 * whatever case and padding the registration form captured, and the join above already matches them
 * case- and whitespace-insensitively — so counting or grouping on the raw column would split one
 * person who registered as `ada@company.example` and ` Ada@Company.Example ` into two attendees.
 * Both readers use this one expression so the row count and the drawer cannot drift apart.
 *
 * It is also the drawer's `CONTACT_ID`, which is sound because nothing resolves a person from it —
 * downstream it is a list-tracking key and an avatar colour seed.
 */
const REGISTRANT_EMAIL_KEY = normalizedEmail('er.EMAIL');

/**
 * The person-table side of that same identity, so the profile join sees exactly what the grouping
 * does. It previously matched on `UPPER(p.EMAIL) = UPPER(er.EMAIL)` — case-insensitive but not
 * whitespace-insensitive — which stopped mattering only while the drawer grouped on the raw column.
 * Once variants collapse into one group, a padded registration misses the profile while its unpadded
 * twin matches, and `MAX(COALESCE(p.NAME, er.FULL_NAME, …))` can then return the registration's own
 * name over the profile's. Normalizing both sides identically means every row in a group carries the
 * same enrichment, so the aggregate has nothing inconsistent to choose between.
 */
const ORG_PERSON_EMAIL_KEY = normalizedEmail('p.EMAIL');

/**
 * Per-event registrant count, so a row and the drawer it opens never disagree.
 * `ORG_EVENTS.ORG_REGISTRATION_COUNT` cannot be used: it is precomputed with no company-email scoping.
 * It counts on `REGISTRANT_EMAIL_KEY`, the same grain the drawer groups by.
 *
 * The unscoped spelling drops the company-email filter and nothing else — it still recomputes from the
 * same registrations, at the same grain, with the same address guard. Falling back to the precomputed
 * platinum column instead would restore pre-rule behaviour literally, but it would also break the one
 * invariant this PR is built on: a row saying 99 while the drawer it opens lists 2. Dropping the scope
 * is the point of the fallback; dropping the agreement is not.
 *
 * Binds: two account ids when scoped (coverage CTE, registrations CTE), one when not.
 * Replacing the scoped spelling with a column on the platinum model is #4409.
 */
function registrationCountsCte(scoped: boolean): string {
  return `WITH ${scoped ? `${COMPANY_EMAIL_COVERAGE_CTE},` : ''}
      event_registration_counts AS (
        SELECT
          er.EVENT_ID,
          COUNT(DISTINCT ${REGISTRANT_EMAIL_KEY}) AS REGISTRATION_COUNT
        FROM ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS er
        ${scoped ? COMPANY_EMAIL_JOINS : ''}
        WHERE er.ACCOUNT_ID = ?
          AND ${REGISTRANT_HAS_ADDRESS}
        ${scoped ? `AND ${COMPANY_EMAIL_QUALIFIES}` : ''}
        GROUP BY er.EVENT_ID
      )`;
}

/**
 * True when the error says THIS object is the missing one. `isMissingObjectError` only answers "some
 * object is absent", which is not enough to choose a fallback: the unscoped and platinum spellings
 * still read the core tables, so retrying after `EVENT_REGISTRATIONS` goes missing cannot succeed and
 * costs a breaker failure for nothing. Snowflake names the object in the message, so the tier can be
 * chosen rather than guessed at.
 */
function isMissingObject(error: unknown, objectName: string): boolean {
  if (!SnowflakeService.isMissingObjectError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.toUpperCase().includes(objectName.toUpperCase());
}

const COMPANY_EMAILS_TABLE = 'ORG_PEOPLE_COMPANY_EMAILS';

/** scoped → company-email filtered; unscoped → same grain, no filter; platinum → ORG_EVENTS alone. */
type ListQueryMode = 'scoped' | 'unscoped' | 'platinum';

/** Deterministic, key-safe sub-resource suffix for the result-changing query params (base64url → only `[A-Za-z0-9_-]`). */
function paramSignature(parts: readonly (string | number | boolean | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** Event-list rows reach the client through `mapRowToOrgEvent`, which reads `EVENT_ID` with no fallback — validate the contract key so a poisoned `[{}]` entry degrades to a miss. */
function isEventRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['EVENT_ID'] === 'string');
}

/** Attendee/speaker rows map `contactId: row.CONTACT_ID` with no fallback — validate the contract key to the same depth as the people/access guards. */
function isContactRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['CONTACT_ID'] === 'string');
}
