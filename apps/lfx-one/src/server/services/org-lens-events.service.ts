// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
import { formatDateToUTC, normalizeToUrl } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

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
    let statusFilter = '';
    if (status === 'registered') {
      statusFilter = 'AND oe.ORG_REGISTRATION_COUNT > 0';
    } else if (status === 'speaker-submitted') {
      statusFilter = 'AND oe.ORG_SPEAKER_SUBMITTED_COUNT > 0';
    } else if (status === 'speaker-accepted') {
      statusFilter = 'AND oe.ORG_SPEAKER_ACCEPTED_COUNT > 0';
    } else if (status === 'event-sponsor') {
      statusFilter = 'AND oe.IS_ORG_SPONSOR = TRUE';
    }

    const pastCondition = isPast ? 'oe.IS_PAST_EVENT = TRUE' : 'oe.IS_PAST_EVENT = FALSE';

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
        oe.ORG_REGISTRATION_COUNT,
        NULLIF(oe.EVENT_REGISTRATIONS_GOAL, 0) AS EVENT_REGISTRATIONS_GOAL,
        oe.ORG_SPEAKER_ACCEPTED_COUNT,
        oe.ORG_SPEAKER_SUBMITTED_COUNT,
        oe.IS_ORG_SPONSOR,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS oe
      WHERE oe.ACCOUNT_ID = ?
        AND ${pastCondition}
        ${searchQueryFilter}
        ${statusFilter}
      ORDER BY oe.${sortColumn} ${sortOrder}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const binds: string[] = [accountId];
    if (searchQuery) binds.push(`%${searchQuery}%`);

    let result;
    try {
      result = await this.snowflakeService.execute<OrgEventRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_org_lens_events', 'Snowflake query failed, returning empty events', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
      });
      return { data: [], total: 0, pageSize, offset };
    }

    const total = result.rows.length > 0 ? result.rows[0].TOTAL_RECORDS : 0;
    const data = result.rows.map((row) => this.mapRowToOrgEvent(row));

    logger.debug(req, 'get_org_lens_events', 'Fetched org events', { count: data.length, total });

    return { data, total, pageSize, offset };
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

    let result;
    try {
      result = await this.snowflakeService.execute<OrgEventsSummaryRow>(sql, [accountId]);
    } catch (error) {
      logger.warning(req, 'get_org_lens_events_summary', 'Snowflake query failed, returning zero counts', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
      });
      return { totalEvents: 0, pastEvents: 0, upcomingEvents: 0 };
    }

    const row = result.rows[0];
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

    const sql = `
      SELECT
        er.EMAIL                                       AS CONTACT_ID,
        MAX(COALESCE(p.NAME, er.FULL_NAME, er.EMAIL))  AS NAME,
        MAX(COALESCE(p.TITLE, er.JOB_TITLE))           AS JOB_TITLE,
        MAX(er.EVENT_NAME)                             AS EVENT_NAME
      FROM ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS er
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
        ON UPPER(p.EMAIL) = UPPER(er.EMAIL) AND p.ACCOUNT_ID = ?
      WHERE er.EVENT_ID = ?
        AND er.ACCOUNT_ID = ?
        ${searchFilter}
      GROUP BY er.EMAIL
      ORDER BY NAME ASC NULLS LAST
    `;

    const binds: string[] = [accountId, eventId, accountId];
    if (searchQuery) {
      binds.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    let result;
    try {
      result = await this.snowflakeService.execute<OrgEventAttendeesDrawerRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_event_attendees', 'Snowflake query failed, returning empty attendees', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
        event_id: eventId,
      });
      return { eventId, eventName: '', total: 0, data: [] };
    }

    const eventName = result.rows[0]?.EVENT_NAME ?? '';
    const data: OrgEventAttendee[] = result.rows.map((row) => ({
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

    let result;
    try {
      result = await this.snowflakeService.execute<OrgEventSpeakersDrawerRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_event_speakers', 'Snowflake query failed, returning empty speakers', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
        event_id: eventId,
      });
      return { eventId, eventName: '', acceptedCount: 0, submittedCount: 0, data: [] };
    }

    const eventName = result.rows[0]?.EVENT_NAME ?? '';
    const data: OrgEventSpeaker[] = result.rows.map((row) => ({
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
