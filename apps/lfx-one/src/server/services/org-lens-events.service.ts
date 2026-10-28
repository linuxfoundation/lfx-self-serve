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

import { isImpersonating } from '../utils/auth-helper';

import { logger } from './logger.service';
import { PersonaDetectionService } from './persona-detection.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Service for org-lens event list endpoints — reads org event footprint from platinum ORG_EVENTS. */
export class OrgLensEventsService {
  private readonly snowflakeService: SnowflakeService;
  private readonly personaDetection: PersonaDetectionService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
    this.personaDetection = new PersonaDetectionService();
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
     * The list in THREE spellings, each needing strictly less than the one above it, and each entered
     * only for a confirmed missing object (see the catch below).
     *
     * - `scoped` — the real one. Counts registrations whose address is in `ORG_PEOPLE_COMPANY_EMAILS`.
     * - `unscoped` — for that address table being absent. Still RECOMPUTES from `EVENT_REGISTRATIONS`
     *   at the drawer's grain, dropping the company-email filter and nothing else, so a row and the
     *   drawer it opens still agree. It does not read the precomputed column.
     * - `platinum` — for `EVENT_REGISTRATIONS` itself being absent. `ORG_EVENTS` alone with the
     *   precomputed `ORG_REGISTRATION_COUNT`; the pre-PR query. This is the one mode where the count
     *   does NOT agree with the drawer, because the drawer cannot degrade this far at all — it has
     *   nothing to list without registrations, so a row count may stand beside an empty drawer.
     *
     * `status=registered` follows `countExpression` in every mode, or the filter offers rows whose
     * displayed count is 0.
     */
    const buildListQuery = (mode: ListQueryMode): { sql: string; binds: string[] } => {
      const scoped = mode === 'scoped';
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

    // Started before the read, not after it: the staff check is an upstream round trip that depends
    // on nothing in the rows, and its per-request memo lives on this service's own private
    // `PersonaDetectionService`, so nothing upstream has warmed it whatever the route mounts —
    // an lf-staff middleware would not change that. Awaiting it after the rows put that trip in series with
    // Valkey or Snowflake on every list response, cache hits included. `checkLFStaff` catches and
    // resolves `false`, so an early return that never awaits this promise cannot reject unhandled.
    const includeGoal = this.callerIsLFStaff(req);

    /** Every outage exit shapes the response identically; #4408 turns these into a labelled-unavailable surface. */
    const emptyEvents = (err: unknown): OrgEventsResponse => {
      logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', { err, account_id: accountId });
      return { data: [], total: 0, pageSize, offset };
    };

    /** `ORG_EVENTS` alone with its precomputed count — the only tier left once a core table is gone. */
    const platinumRows = (): Promise<OrgEventRow[]> => {
      const platinumQuery = buildListQuery('platinum');
      return this.fetchEventListRows(platinumQuery.sql, platinumQuery.binds);
    };

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
        return emptyEvents(scopedError);
      }

      // Some OTHER object is missing, so the unscoped spelling — which reads the same core tables —
      // cannot succeed either. Skip straight to the tier that might, instead of spending a breaker
      // failure proving it.
      if (!SnowflakeService.isMissingObjectError(scopedError, COMPANY_EMAILS_TABLE)) {
        logger.warning(req, 'get_org_lens_events', 'Core table unavailable, falling back to the platinum count', {
          err: scopedError,
          account_id: accountId,
        });
        let platinum: OrgEventRow[];
        try {
          platinum = await platinumRows();
        } catch (platinumError) {
          return emptyEvents(platinumError);
        }
        // Outside the `try`, like the other two exits: a staff-check rejection here would otherwise be
        // logged and reported as a Snowflake failure and empty the whole list.
        return this.toEventsResponse(req, platinum, pageSize, offset, await includeGoal);
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
          return emptyEvents(unscopedError);
        }

        logger.warning(req, 'get_org_lens_events', 'Registrations unavailable, falling back to the platinum count', {
          err: unscopedError,
          account_id: accountId,
        });
        try {
          rows = await platinumRows();
        } catch (error) {
          return emptyEvents(error);
        }
      }
    }

    return this.toEventsResponse(req, rows, pageSize, offset, await includeGoal);
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

    // Names only. Matching `er.EMAIL` made this an existence oracle — a caller could test whether a
    // given address registered for an event without ever being shown it. The shipped drawer filters
    // client-side on name and job title and never sends `searchQuery`, so nothing in the UI regresses.
    const searchFilter = searchQuery ? `AND UPPER(COALESCE(${NON_ADDRESS_NAME('p.NAME')}, ${NON_ADDRESS_NAME('er.FULL_NAME')})) LIKE UPPER(?)` : '';

    /**
     * The drawer in TWO spellings, not three: scoped, and unscoped for the address table being
     * absent. There is no platinum equivalent — without `EVENT_REGISTRATIONS` the drawer has nothing
     * to list, so it returns empty while the list falls through to its precomputed count.
     */
    const buildAttendeesQuery = (scoped: boolean): { sql: string; binds: string[] } => {
      const sql = `
      ${scoped ? `WITH ${COMPANY_EMAIL_COVERAGE_CTE}` : ''}
      SELECT
        ${REGISTRANT_EMAIL_KEY}                        AS CONTACT_ID,
        MAX(COALESCE(${NON_ADDRESS_NAME('p.NAME')}, ${NON_ADDRESS_NAME('er.FULL_NAME')})) AS NAME,
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
      ORDER BY NAME ASC NULLS LAST, CONTACT_ID ASC
    `;

      // Positional binds, in statement order: coverage CTE when scoped, the ORG_PEOPLE_ALL join, the WHERE.
      const binds: string[] = scoped ? [accountId, accountId, eventId, accountId] : [accountId, eventId, accountId];
      if (searchQuery) {
        binds.push(`%${searchQuery}%`);
      }
      return { sql, binds };
    };

    const scopedQuery = buildAttendeesQuery(true);

    let rows: OrgEventAttendeesDrawerRow[];
    try {
      rows = await withOrgCache(
        accountId,
        // `:v3` — `:v2` was the company-email scoping; `:v3` is the narrowed row shape (no address in
        // `NAME`) and the narrowed search. Entries written before this ships would otherwise be served
        // with addresses still in `NAME` for a full TTL — a company address on the normal scoped path,
        // and a personal one on the zero-coverage arm. Only this scoped read is cached at all; the
        // unscoped retry below never is.
        `event-attendees:v3:${paramSignature([eventId, searchQuery ?? null])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchEventAttendeeRows(scopedQuery.sql, scopedQuery.binds, true),
        isContactRowArray
      );
    } catch (scopedError) {
      // Only a missing ADDRESS TABLE retries unscoped, exactly as the list does, so a row and the
      // drawer it opens agree in both of the tiers they share. Any other failure — a timeout above
      // all — must not retry: the unscoped spelling would silently drop the company-email filter,
      // which is the one thing this rule exists to prevent. A missing CORE table is a third case:
      // the unscoped spelling reads those tables too, so retrying could only spend a breaker failure
      // to prove it. There the two surfaces part company — the list has a platinum tier that reads
      // ORG_EVENTS alone, and the drawer has nothing to list without registrations, so it returns
      // empty and a row count may stand beside an empty drawer.
      if (!SnowflakeService.isMissingObjectError(scopedError, COMPANY_EMAILS_TABLE)) {
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
    /**
     * `CONTACT_ID` is the normalized registration address: the right grouping key, and the wrong thing
     * to hand the client. Downstream it is only a list-tracking key and an avatar colour seed, neither
     * of which needs to mean anything, so the response carries the row's position instead. The address
     * stays server-side in the cached row, the same way the staff-only goal does.
     *
     * Positional, so it is stable only within one response — which is all `track` and the avatar seed
     * need. `ORDER BY` is fully deterministic (name, then the key) so the same rows get the same ids
     * across reads, cached or not; a different search term is a different query and may renumber.
     */
    const data: OrgEventAttendee[] = rows.map((row, index) => ({
      contactId: String(index),
      name: row.NAME ?? ANONYMOUS_ATTENDEE_NAME,
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
   * Is the caller LF staff? #4432 removes the event-wide registration goal from EXTERNAL admins'
   * view and payload; LF staff keep it.
   *
   * Deliberately NOT `RoleGrantsResponse.isStaff`, which an earlier revision of this used.
   * `OrgRoleGrantsService` sets that for membership of any team in `ORG_WIDE_READ_TEAM_IDS` —
   * `lf-staff`, `global-org-auditors` AND `global_org_admin` — and its own comment says it "is never
   * a read gate", only an Org Lens search affordance. Using it here would have handed the internal
   * goal to a global auditor or org admin who is not LF staff: a disclosure bug on the one rule that
   * is entirely about disclosure.
   *
   * `checkLFStaff` asks for `lf-staff#member` alone, caches per request, and already degrades to
   * `false` on a failed access check — fail-closed, which is the right direction here. An external
   * admin seeing a figure Angela Brown ruled out is the failure that matters; a staff member briefly
   * missing a number they can get elsewhere is not.
   */
  private async callerIsLFStaff(req: Request): Promise<boolean> {
    // While impersonating, the answer must be about the TARGET, not the staff member driving the
    // session. `checkLFStaff` alone does not settle that: `authMiddleware` swaps in the target's
    // bearer, but whether the exchanged token still satisfies `lf-staff#member` is the auth service's
    // business, not something this disclosure gate should depend on. The whole point of "view as" is
    // to see the member company's view, and that view has no goal in it — so an impersonated session
    // is never staff here, whoever the target is. Same direction as the gw-embed gate, which refuses
    // outright while impersonating because the two identities diverge.
    if (isImpersonating(req)) {
      return false;
    }

    return this.personaDetection.checkLFStaff(req);
  }

  /** Shared by the normal path and the early platinum return, so both shape the response identically. */
  private toEventsResponse(req: Request, rows: OrgEventRow[], pageSize: number, offset: number, includeGoal: boolean): OrgEventsResponse {
    const total = rows.length > 0 ? rows[0].TOTAL_RECORDS : 0;
    const data = rows.map((row) => this.mapRowToOrgEvent(row, includeGoal));

    logger.debug(req, 'get_org_lens_events', 'Fetched org events', { count: data.length, total });

    return { data, total, pageSize, offset };
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
   *
   * The option carries the object's NAME, not a bare `true`, so the exemption covers exactly
   * `ORG_PEOPLE_COMPANY_EMAILS`: a missing core table misses this branch entirely and keeps its normal
   * failure handling, and only the rollout condition this flag exists for is forgiven. Naming it is
   * not the whole guard, though — when the address table and a core table are gone at once, Snowflake
   * blames the exempt object and the exemption does fire. `execute` therefore releases the probe
   * rather than recording a success, so the shared failure count survives; see the note there.
   */
  private async fetchEventListRows(sql: string, binds: string[], scoped = false): Promise<OrgEventRow[]> {
    const result = await this.snowflakeService.execute<OrgEventRow>(sql, binds, scoped ? { expectMissingObject: COMPANY_EMAILS_TABLE } : undefined);
    return result.rows;
  }

  private async fetchEventsSummaryRows(accountId: string, sql: string): Promise<OrgEventsSummaryRow[]> {
    const result = await this.snowflakeService.execute<OrgEventsSummaryRow>(sql, [accountId]);
    return result.rows;
  }

  /** Same reasoning as `fetchEventListRows`: the scoped drawer may legitimately find no address table. */
  private async fetchEventAttendeeRows(sql: string, binds: string[], scoped = false): Promise<OrgEventAttendeesDrawerRow[]> {
    const result = await this.snowflakeService.execute<OrgEventAttendeesDrawerRow>(
      sql,
      binds,
      scoped ? { expectMissingObject: COMPANY_EMAILS_TABLE } : undefined
    );
    return result.rows;
  }

  private async fetchEventSpeakerRows(sql: string, binds: string[]): Promise<OrgEventSpeakersDrawerRow[]> {
    const result = await this.snowflakeService.execute<OrgEventSpeakersDrawerRow>(sql, binds);
    return result.rows;
  }

  private mapRowToOrgEvent(row: OrgEventRow, includeGoal: boolean): OrgEvent {
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
      // Spread, not a null: the key must be ABSENT for an external admin, not present-and-empty.
      ...(includeGoal ? { eventRegistrationsGoal: row.EVENT_REGISTRATIONS_GOAL ?? null } : {}),
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

/**
 * One normalization, used everywhere an address is compared, grouped or counted — and by the two
 * blankness guards as well, so there is exactly one definition to change. It is a hoisted function
 * declaration and `EMAIL_WHITESPACE` is declared above it, so every call site below can reach it.
 *
 * Routing the guards through it is equivalent today, because `LOWER` never turns a non-empty string
 * empty. The point is that it stays equivalent: anything added here that `TRIM` cannot do (stripping
 * a zero-width space, say) now reaches the guards too, instead of having to be mirrored into them.
 */
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
          AND NULLIF(${normalizedEmail('EMAIL')}, '') IS NOT NULL
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
 * Both the per-event count and the drawer embed this one predicate, so within one spelling the two
 * cannot disagree about who qualifies, including on the zero-coverage arm. Across spellings they can:
 * the drawer has no platinum tier, which is the known gap recorded on `registrationCountsCte`.
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
 */
const COMPANY_EMAIL_QUALIFIES = `(ce.EMAIL IS NOT NULL OR cov.COVERAGE_ROWS = 0)`;

/**
 * A registrant needs a usable address whichever spelling is running. This half of the rule is NOT
 * about company scoping, so it applies to the unscoped fallback too: without it that path returns a
 * row whose `CONTACT_ID` is null, which is unusable as the grouping key and invisible to the row
 * count's `COUNT(DISTINCT …)`, so the drawer would list someone the row never counted. Where the
 * result IS cached — the scoped spelling only, and the unscoped retry never is — such a row is also
 * rejected by `isContactRowArray`, refusing the whole entry on every read. The scoped predicate used
 * to carry this clause, so splitting the fallback out of it originally dropped the guard on exactly
 * the degraded path.
 * (A null `NAME` is now ordinary, not a symptom: it is what a registrant with no resolved person and
 * no `FULL_NAME` looks like once the address is out of the coalesce, and it maps to a neutral label.)
 *
 * KNOWN, DELIBERATE GAP, and this is the guard that drops the row. Applying it on the fallback path
 * too means a registration with no address at all is dropped there, where before this rule it would
 * have reached the drawer. Upstream dedup is `PARTITION BY email, event_id` and NULLs partition
 * together, so this is at most one row per event. Keeping it would mean emitting an attendee whose
 * `CONTACT_ID` is null — rejected by `isContactRowArray`, so the event's whole cache entry is
 * refused on every read, and invisible to `COUNT(DISTINCT …)`, so the row and the drawer would
 * disagree again. Giving it a synthesized identity instead needs a registration-level key this query
 * does not select. Revisit with the platinum measure in #4409, where the grain can carry one.
 */
const REGISTRANT_HAS_ADDRESS = `NULLIF(${normalizedEmail('er.EMAIL')}, '') IS NOT NULL`;

/**
 * The identity of a registrant, for counting and for grouping. Addresses reach the fact table in
 * whatever case and padding the registration form captured, and the join above already matches them
 * case- and whitespace-insensitively — so counting or grouping on the raw column would split one
 * person who registered as `ada@company.example` and ` Ada@Company.Example ` into two attendees.
 * Both readers use this one expression so the row count and the drawer cannot drift apart.
 *
 * It is the drawer's `CONTACT_ID` column, but only as far as the cached row: the response maps it to
 * an opaque positional id, so the address never reaches the client. See `getEventAttendees`.
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
 * Per-event registrant count, so a row and the drawer it opens agree in the two tiers they share.
 * `ORG_EVENTS.ORG_REGISTRATION_COUNT` cannot be used here: it is precomputed with no company-email
 * scoping. This counts on `REGISTRANT_EMAIL_KEY`, the same grain the drawer groups by.
 *
 * The unscoped spelling drops the company-email filter and nothing else — it still recomputes from
 * the same registrations, at the same grain, with the same address guard. So dropping the scope is
 * the point of that fallback; dropping the agreement is not, and it doesn't.
 *
 * The list has a third tier the drawer lacks: when `EVENT_REGISTRATIONS` itself is unavailable this
 * CTE cannot run at all, and `buildListQuery('platinum')` reads the precomputed column instead. That
 * tier DOES give up the agreement — a row may say 99 beside an empty drawer — and it is a deliberate
 * last resort, because showing the org its events with a stale count beats telling it it has none.
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
 * A name field holding an address is not a name. `er.FULL_NAME` is free text off a registration form
 * and `p.NAME` is only as clean as its source, so either can contain the address this query exists to
 * keep out of the response — and it would then be rendered as the attendee's name and matched by the
 * name search, putting back both leaks the redaction closed.
 *
 * Deliberately a crude `LIKE '%@%'` rather than address validation: the question is not whether the
 * value parses as an address, it is whether it might be one. A real name containing `@` is a false
 * positive that costs a neutral label, which is the safe direction to be wrong in.
 */
const NON_ADDRESS_NAME = (column: string): string => `CASE WHEN ${column} LIKE '%@%' THEN NULL ELSE ${column} END`;

/**
 * Shown when a registrant resolves to no person and the registration carries no name. It used to fall
 * back to the raw address, which rendered a personal email in the drawer on the degraded tiers.
 */
const ANONYMOUS_ATTENDEE_NAME = 'Registered attendee';

/** The one object either surface may legitimately find absent; every other table here is core. */
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

/** Speaker rows map `contactId: row.CONTACT_ID` with no fallback, and attendee rows order by it — validate the contract key to the same depth as the people/access guards. */
function isContactRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['CONTACT_ID'] === 'string');
}
