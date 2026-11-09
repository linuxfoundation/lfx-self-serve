// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_EVENTS_NEUTRAL_REGISTRANT_LABEL, ORG_EVENTS_NEUTRAL_SPEAKER_LABEL, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  EventAttendeeFoundationOptionRow,
  GetOrgEventsOptions,
  OrgEvent,
  OrgEventAttendee,
  OrgEventAttendeesDrawerResponse,
  OrgEventAttendeesDrawerRow,
  OrgEventDrawerHeaderRow,
  OrgEventFoundationsResponse,
  OrgEventRow,
  OrgEventSpeaker,
  OrgEventSpeakersDrawerRow,
  OrgEventSpeakersResponse,
  OrgEventsAttribution,
  OrgEventsFilters,
  OrgEventsParticipation,
  OrgEventsResponse,
  OrgEventsSummary,
  OrgEventsSummaryRow,
} from '@lfx-one/shared/interfaces';
import { effectiveOrgEventsParticipation, formatDateToUTC, isObjectRow, isObjectRowArray, normalizeToUrl } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import {
  distinctFoundationOptions,
  orgEventsAttendeePredicate,
  orgEventsCountColumn,
  orgEventsFootprintColumn,
  orgEventsRangeWindow,
} from '../helpers/org-events-filters.helper';
import { isImpersonating } from '../utils/auth-helper';

import { logger } from './logger.service';
import { PersonaDetectionService } from './persona-detection.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Allowlist of columns that may appear in ORDER BY to prevent SQL injection. */
const VALID_SORT_COLUMNS: ReadonlySet<string> = new Set(['EVENT_NAME', 'EVENT_START_DATE', 'EVENT_CITY']);

/**
 * Service for the Org Lens Events page. dbt computes every count (per-event distinct people per attribution in ORG_EVENTS,
 * person × event participation in ORG_EVENT_PARTICIPATION); this service selects the columns of the picked option and applies
 * parameterized WHERE / ORDER BY / LIMIT.
 */
export class OrgLensEventsService {
  private readonly snowflakeService: SnowflakeService;
  private readonly personaDetection: PersonaDetectionService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
    this.personaDetection = new PersonaDetectionService();
  }

  /** GET /api/orgs/:accountId/lens/events — paginated list of events for the org. */
  public async getOrgEvents(req: Request, accountId: string, options: GetOrgEventsOptions): Promise<OrgEventsResponse> {
    const { isPast, searchQuery, status, pageSize, offset, sortField, sortOrder, attribution, participation, eventScope, foundation, range } = options;
    const sortColumn = VALID_SORT_COLUMNS.has(sortField) ? sortField : 'EVENT_START_DATE';

    logger.debug(req, 'get_org_lens_events', 'Building org events query', {
      account_id: accountId,
      is_past: isPast,
      has_search: !!searchQuery,
      status,
      page_size: pageSize,
      offset,
    });

    // Started before the read, not after it: the staff check is an upstream round trip that depends
    // on nothing in the rows, and its per-request memo lives on this service's own private
    // `PersonaDetectionService`. Awaiting it after the rows put that trip in series with Valkey or
    // Snowflake on every list response, cache hits included. `checkLFStaff` catches and resolves
    // `false`, so an early return that never awaits this promise cannot reject unhandled.
    const includeGoal = this.callerIsLFStaff(req);

    let rows: OrgEventRow[];
    try {
      // The Upcoming tab always counts registrations: nobody has attended an event that has not started.
      const servedParticipation = effectiveOrgEventsParticipation(participation, isPast);
      const countColumn = orgEventsCountColumn(attribution, servedParticipation);
      const footprintColumn = orgEventsFootprintColumn(attribution);
      // The "Registered" status means the organization registered someone, whatever Count is showing.
      const registeredColumn = orgEventsCountColumn(attribution, 'registered');

      const { sql, binds } = this.buildListQuery({
        accountId,
        isPast,
        searchQuery,
        status,
        pageSize,
        offset,
        sortColumn,
        sortOrder,
        eventScope,
        foundation,
        range,
        countColumn,
        footprintColumn,
        registeredColumn,
      });

      rows = await withOrgCache(
        accountId,
        `events:v5:${paramSignature([isPast, status ?? null, searchQuery ?? null, pageSize, offset, sortColumn, sortOrder, attribution, servedParticipation, eventScope, foundation, isPast ? range : null])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        async () => (await this.snowflakeService.execute<OrgEventRow>(sql, binds)).rows,
        isEventRowArray
      );
    } catch (error) {
      // Every outage exit shapes the response identically; #4408 turns these into a labelled-unavailable surface.
      logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', { err: error, account_id: accountId });
      return { data: [], total: 0, pageSize, offset };
    }

    const total = rows.length > 0 ? rows[0].TOTAL_RECORDS : 0;
    const canSeeGoal = await includeGoal;
    const data = rows.map((row) => this.mapRowToOrgEvent(row, canSeeGoal));

    logger.debug(req, 'get_org_lens_events', 'Fetched org events', { count: data.length, total });

    return { data, total, pageSize, offset };
  }

  /**
   * GET /api/orgs/:accountId/lens/events/summary — Upcoming / Past / Total tiles. They follow range (Past only),
   * foundation, scope and attribution; never search, status or tab.
   */
  public async getOrgEventsSummary(req: Request, accountId: string, filters: OrgEventsFilters): Promise<OrgEventsSummary> {
    logger.debug(req, 'get_org_lens_events_summary', 'Building org events summary query', { account_id: accountId });

    let row: OrgEventsSummaryRow | undefined;
    try {
      const footprintFilter = filters.scope === 'activity' ? `AND oe.${orgEventsFootprintColumn(filters.attribution)} = TRUE` : '';
      const foundationFilter = filters.foundation ? 'AND oe.FOUNDATION_ID = ?' : '';
      const sql = `
        SELECT
          COUNT(CASE WHEN oe.IS_PAST_EVENT = TRUE ${orgEventsRangeWindow('oe.EVENT_DATE', filters.range)} THEN 1 END) AS PAST_EVENTS,
          COUNT(CASE WHEN oe.IS_PAST_EVENT = FALSE THEN 1 END) AS UPCOMING_EVENTS
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
        WHERE oe.ACCOUNT_ID = ?
          ${footprintFilter}
          ${foundationFilter}
      `;
      const binds = filters.foundation ? [accountId, filters.foundation] : [accountId];

      const rows = await withOrgCache(
        accountId,
        `events-summary:v2:${paramSignature([filters.attribution, filters.scope, filters.foundation, filters.range])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        async () => (await this.snowflakeService.execute<OrgEventsSummaryRow>(sql, binds)).rows,
        isObjectRowArray
      );
      row = rows[0];
    } catch (error) {
      logger.warning(req, 'get_org_lens_events_summary', 'Snowflake query failed, returning zero counts', {
        err: error,
        account_id: accountId,
      });
      return { totalEvents: 0, pastEvents: 0, upcomingEvents: 0 };
    }

    const pastEvents = row?.PAST_EVENTS ?? 0;
    const upcomingEvents = row?.UPCOMING_EVENTS ?? 0;
    const summary: OrgEventsSummary = { totalEvents: pastEvents + upcomingEvents, pastEvents, upcomingEvents };

    logger.debug(req, 'get_org_lens_events_summary', 'Fetched org events summary', { ...summary });

    return summary;
  }

  /** GET /api/orgs/:accountId/lens/events/foundations — foundations that have events under the picked scope and attribution. */
  public async getOrgEventFoundations(
    req: Request,
    accountId: string,
    filters: Pick<OrgEventsFilters, 'attribution' | 'scope'>
  ): Promise<OrgEventFoundationsResponse> {
    try {
      const footprintFilter = filters.scope === 'activity' ? `AND oe.${orgEventsFootprintColumn(filters.attribution)} = TRUE` : '';
      const sql = `
        SELECT DISTINCT oe.FOUNDATION_ID, oe.FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
        WHERE oe.ACCOUNT_ID = ?
          AND oe.FOUNDATION_ID IS NOT NULL
          AND oe.FOUNDATION_NAME IS NOT NULL
          ${footprintFilter}
        ORDER BY oe.FOUNDATION_NAME ASC
      `;
      const rows = await withOrgCache(
        accountId,
        `events-foundations:v2:${paramSignature([filters.attribution, filters.scope])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        async () => (await this.snowflakeService.execute<EventAttendeeFoundationOptionRow>(sql, [accountId])).rows,
        isObjectRowArray
      );
      return { data: distinctFoundationOptions(rows).map((row) => ({ id: row.FOUNDATION_ID, name: row.FOUNDATION_NAME })) };
    } catch (error) {
      logger.warning(req, 'get_org_lens_event_foundations', 'Snowflake query failed, returning no foundations', { err: error, account_id: accountId });
      return { data: [] };
    }
  }

  /**
   * GET /api/orgs/:accountId/lens/events/:eventId/attendees — everyone the picked option credits to the organization for one event,
   * by name and title (lfx-self-serve#5158). No email is ever returned.
   */
  public async getEventAttendees(
    req: Request,
    accountId: string,
    eventId: string,
    options: { attribution: OrgEventsAttribution; participation: OrgEventsParticipation; searchQuery?: string }
  ): Promise<OrgEventAttendeesDrawerResponse> {
    const { searchQuery } = options;
    logger.debug(req, 'get_event_attendees', 'Fetching event attendees', { account_id: accountId, event_id: eventId });

    try {
      const header = await this.readDrawerHeader(accountId, eventId);
      const servedParticipation = effectiveOrgEventsParticipation(options.participation, header?.IS_PAST_EVENT === true);

      // Everyone the option counts, searched or not: one cache entry per event and option, and the search below narrows only what is shown.
      const sql = `
        SELECT PARTICIPANT_REF, DISPLAY_NAME, JOB_TITLE
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION
        WHERE ACCOUNT_ID = ?
          AND EVENT_ID = ?
          AND ${orgEventsAttendeePredicate(options.attribution, servedParticipation)}
        ORDER BY DISPLAY_NAME ASC NULLS LAST, PARTICIPANT_REF ASC
      `;

      // `v6` (lfx-self-serve#5158): everyone the option credits, not only the listable; a `v5` entry is the narrower row set.
      const attendeeRows = await withOrgCache(
        accountId,
        `event-attendees:v6:${paramSignature([eventId, options.attribution, servedParticipation])}`,
        VALKEY_CACHE.ORG_LENS_NAMED_TTL_SECONDS,
        async () => (await this.snowflakeService.execute<OrgEventAttendeesDrawerRow>(sql, [accountId, eventId])).rows,
        isObjectRowArray
      );

      // Names only. Matching an address would make this an existence oracle, and the warehouse carries none.
      const needle = searchQuery?.toUpperCase();
      const rows = needle ? attendeeRows.filter((row) => displayText(row.DISPLAY_NAME)?.toUpperCase().includes(needle)) : attendeeRows;

      // Positional ids: stable within one response, which is all the list `track` and the avatar colour seed need.
      const data: OrgEventAttendee[] = rows.map((row, index) => ({
        contactId: String(index),
        name: displayText(row.DISPLAY_NAME) ?? ORG_EVENTS_NEUTRAL_REGISTRANT_LABEL,
        jobTitle: displayText(row.JOB_TITLE),
      }));

      logger.debug(req, 'get_event_attendees', 'Fetched event attendees', { count: data.length, event_id: eventId });

      return {
        eventId,
        eventName: header?.EVENT_NAME ?? '',
        total: data.length,
        data,
      };
    } catch (error) {
      // A failed read is not a count of zero: propagate so the drawer shows its load-error state.
      logger.warning(req, 'get_event_attendees', 'Snowflake query failed', {
        err: error,
        account_id: accountId,
        event_id: eventId,
      });
      throw error;
    }
  }

  /** GET /api/orgs/:accountId/lens/events/:eventId/speakers — org speakers (accepted + submitted) for a specific event. */
  public async getEventSpeakers(req: Request, accountId: string, eventId: string, searchQuery?: string): Promise<OrgEventSpeakersResponse> {
    logger.debug(req, 'get_event_speakers', 'Fetching event speakers', { account_id: accountId, event_id: eventId });

    // A name field holding an address is not a name; the search matches names only, as the attendees drawer does.
    const speakerName = `CASE WHEN TRIM(es.SPEAKER_FIRST_NAME || ' ' || es.SPEAKER_LAST_NAME) LIKE '%@%' THEN NULL ELSE NULLIF(TRIM(es.SPEAKER_FIRST_NAME || ' ' || es.SPEAKER_LAST_NAME), '') END`;
    const searchFilter = searchQuery ? `AND UPPER(${speakerName}) LIKE UPPER(?)` : '';

    const sql = `
      SELECT
        es.SPEAKER_ID                                         AS SPEAKER_ID,
        MAX(${speakerName})                                   AS NAME,
        MAX(es.JOB_TITLE)                                     AS JOB_TITLE,
        MAX(CASE WHEN es.SPEAKER_STATUS = 'Accepted' THEN 1 ELSE 0 END) AS IS_ACCEPTED,
        MAX(es.EVENT_NAME)                                    AS EVENT_NAME
      FROM ANALYTICS.SILVER_FACT.EVENT_SPEAKERS es
      WHERE es.EVENT_ID = ?
        AND es.ACCOUNT_ID = ?
        ${searchFilter}
      GROUP BY es.SPEAKER_ID
      ORDER BY NAME ASC NULLS LAST, SPEAKER_ID ASC
    `;

    const binds: string[] = [eventId, accountId];
    if (searchQuery) {
      binds.push(`%${searchQuery}%`);
    }

    let rows: OrgEventSpeakersDrawerRow[];
    try {
      rows = await withOrgCache(
        accountId,
        `event-speakers:v3:${paramSignature([eventId, searchQuery ?? null])}`,
        VALKEY_CACHE.ORG_LENS_NAMED_TTL_SECONDS,
        async () => (await this.snowflakeService.execute<OrgEventSpeakersDrawerRow>(sql, binds)).rows,
        isSpeakerRowArray
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
    // Positional ids, like the attendees drawer: the warehouse key stays server-side.
    const data: OrgEventSpeaker[] = rows.map((row, index) => ({
      contactId: String(index),
      name: displayText(row.NAME) ?? ORG_EVENTS_NEUTRAL_SPEAKER_LABEL,
      jobTitle: displayText(row.JOB_TITLE),
      status: row.IS_ACCEPTED ? 'ACCEPTED' : 'SUBMITTED',
    }));

    const acceptedCount = data.filter((s) => s.status === 'ACCEPTED').length;
    const submittedCount = data.length;

    logger.debug(req, 'get_event_speakers', 'Fetched event speakers', { accepted: acceptedCount, submitted: submittedCount, event_id: eventId });

    return { eventId, eventName, acceptedCount, submittedCount, data };
  }

  /**
   * Is the caller LF staff? #4432 removes the event-wide registration goal from EXTERNAL admins'
   * view and payload; LF staff keep it, except while impersonating (see below).
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

  private buildListQuery(params: {
    accountId: string;
    isPast: boolean;
    searchQuery?: string;
    status?: string | null;
    pageSize: number;
    offset: number;
    sortColumn: string;
    sortOrder: 'ASC' | 'DESC';
    eventScope: OrgEventsFilters['scope'];
    foundation: string;
    range: OrgEventsFilters['range'];
    countColumn: string;
    footprintColumn: string;
    registeredColumn: string;
  }): { sql: string; binds: string[] } {
    const {
      accountId,
      isPast,
      searchQuery,
      status,
      pageSize,
      offset,
      sortColumn,
      sortOrder,
      eventScope,
      foundation,
      range,
      countColumn,
      footprintColumn,
      registeredColumn,
    } = params;

    let statusFilter = '';
    if (status === 'registered') {
      statusFilter = `AND oe.${registeredColumn} > 0`;
    } else if (status === 'speaker-submitted') {
      statusFilter = 'AND oe.ORG_SPEAKER_SUBMITTED_COUNT > 0';
    } else if (status === 'speaker-accepted') {
      statusFilter = 'AND oe.ORG_SPEAKER_ACCEPTED_COUNT > 0';
    } else if (status === 'event-sponsor') {
      statusFilter = 'AND oe.IS_ORG_SPONSOR = TRUE';
    }

    // Range applies to the Past tab only; Upcoming events are never windowed.
    const tenseFilter = isPast ? `AND oe.IS_PAST_EVENT = TRUE ${orgEventsRangeWindow('oe.EVENT_DATE', range)}` : 'AND oe.IS_PAST_EVENT = FALSE';
    const scopeFilter = eventScope === 'activity' ? `AND oe.${footprintColumn} = TRUE` : '';
    const foundationFilter = foundation ? 'AND oe.FOUNDATION_ID = ?' : '';
    const searchFilter = searchQuery ? 'AND oe.EVENT_NAME ILIKE ?' : '';

    const sql = `
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
        oe.${countColumn} AS ORG_ATTENDEE_COUNT,
        NULLIF(oe.EVENT_REGISTRATIONS_GOAL, 0) AS EVENT_REGISTRATIONS_GOAL,
        oe.ORG_SPEAKER_ACCEPTED_COUNT,
        oe.ORG_SPEAKER_SUBMITTED_COUNT,
        oe.IS_ORG_SPONSOR,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
      WHERE oe.ACCOUNT_ID = ?
        ${tenseFilter}
        ${scopeFilter}
        ${foundationFilter}
        ${searchFilter}
        ${statusFilter}
      ORDER BY oe.${sortColumn} ${sortOrder}, oe.EVENT_ID ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    // Positional binds, in statement order.
    const binds: string[] = [accountId];
    if (foundation) binds.push(foundation);
    if (searchQuery) binds.push(`%${searchQuery}%`);
    return { sql, binds };
  }

  /** The event's name and whether it has ended — one row, cached per event. */
  private async readDrawerHeader(accountId: string, eventId: string): Promise<OrgEventDrawerHeaderRow | undefined> {
    const sql = `
      SELECT oe.EVENT_NAME, oe.IS_PAST_EVENT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
      WHERE oe.ACCOUNT_ID = ?
        AND oe.EVENT_ID = ?
      LIMIT 1
    `;
    // `v3` (lfx-self-serve#5158): name and ended flag only, so one entry per event whatever the attribution; `v2` also held counts.
    const rows = await withOrgCache(
      accountId,
      `event-header:v3:${paramSignature([eventId])}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => (await this.snowflakeService.execute<OrgEventDrawerHeaderRow>(sql, [accountId, eventId])).rows,
      isObjectRowArray
    );
    return rows[0];
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
      orgAttendeeCount: row.ORG_ATTENDEE_COUNT || 0,
      // Spread, not a null: the key must be ABSENT for an external admin, not present-and-empty.
      ...(includeGoal ? { eventRegistrationsGoal: row.EVENT_REGISTRATIONS_GOAL ?? null } : {}),
      orgSpeakerAcceptedCount: row.ORG_SPEAKER_ACCEPTED_COUNT || 0,
      orgSpeakerSubmittedCount: row.ORG_SPEAKER_SUBMITTED_COUNT || 0,
      isOrgSponsor: !!row.IS_ORG_SPONSOR,
    };
  }
}

/** A name or title for display: trimmed, `null` when empty or when it holds an address — no email reaches a drawer, whatever the warehouse sent. */
function displayText(value: string | null): string | null {
  const text = value?.trim();
  return text && !text.includes('@') ? text : null;
}

/** Deterministic, key-safe sub-resource suffix for the result-changing query params (base64url → only `[A-Za-z0-9_-]`). */
function paramSignature(parts: readonly (string | number | boolean | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** Event-list rows reach the client through `mapRowToOrgEvent`, which reads `EVENT_ID` with no fallback — validate the contract key so a poisoned `[{}]` entry degrades to a miss. */
function isEventRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['EVENT_ID'] === 'string');
}

/** Speaker rows are read by `SPEAKER_ID` order and `NAME` with no fallback — validate the contract key to the same depth as the people/access guards. */
function isSpeakerRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['SPEAKER_ID'] === 'string');
}
