// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GetOrgEventsOptions, OrgEvent, OrgEventRow, OrgEventsResponse, OrgEventsSummary, OrgEventsSummaryRow } from '@lfx-one/shared/interfaces';
import { formatDateToUTC } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

/** Service for org-lens event list endpoints — queries org employees' event footprint via Snowflake. */
export class OrgLensEventsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** GET /api/orgs/:accountId/lens/events — paginated list of events for the org. */
  public async getOrgEvents(req: Request, accountId: string, userEmail: string, options: GetOrgEventsOptions): Promise<OrgEventsResponse> {
    const { isPast, searchQuery, status, pageSize, offset, sortOrder } = options;

    logger.debug(req, 'get_org_lens_events', 'Building org events query', {
      account_id: accountId,
      is_past: isPast,
      has_search: !!searchQuery,
      status,
      page_size: pageSize,
      offset,
    });

    const searchQueryFilter = searchQuery ? 'AND o.EVENT_NAME ILIKE ?' : '';
    let statusFilter = '';
    if (status === 'registered') {
      statusFilter = 'AND u.EVENT_ID IS NOT NULL';
    } else if (status === 'not-registered') {
      statusFilter = 'AND u.EVENT_ID IS NULL';
    }

    const isPastCondition = isPast ? 'TRUE' : 'FALSE';

    const sql = `
      WITH account AS (
        SELECT ACCOUNT_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_ACCOUNT_CONTEXT
        WHERE ACCOUNT_ID = ?
        LIMIT 1
      ),
      org_events AS (
        SELECT
          er.EVENT_ID,
          er.EVENT_NAME,
          er.PROJECT_NAME AS FOUNDATION,
          er.EVENT_START_DATE,
          er.EVENT_END_DATE,
          er.EVENT_LOCATION,
          er.EVENT_CITY,
          er.EVENT_COUNTRY,
          er.EVENT_URL,
          er.EVENT_REGISTRATION_URL,
          COUNT(DISTINCT er.USER_EMAIL) AS ORG_ATTENDEE_COUNT
        FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS er
        JOIN account a ON UPPER(er.ACCOUNT_NAME) = UPPER(a.ACCOUNT_NAME)
        WHERE er.IS_PAST_EVENT = ${isPastCondition}
          AND er.REGISTRATION_STATUS = 'Accepted'
        GROUP BY
          er.EVENT_ID, er.EVENT_NAME, er.PROJECT_NAME,
          er.EVENT_START_DATE, er.EVENT_END_DATE,
          er.EVENT_LOCATION, er.EVENT_CITY, er.EVENT_COUNTRY,
          er.EVENT_URL, er.EVENT_REGISTRATION_URL
      ),
      user_reg AS (
        SELECT EVENT_ID
        FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
        WHERE USER_EMAIL = ?
          AND IS_PAST_EVENT = ${isPastCondition}
          AND REGISTRATION_STATUS = 'Accepted'
      )
      SELECT
        o.EVENT_ID,
        o.EVENT_NAME,
        o.FOUNDATION,
        o.EVENT_START_DATE,
        o.EVENT_END_DATE,
        o.EVENT_LOCATION,
        o.EVENT_CITY,
        o.EVENT_COUNTRY,
        o.EVENT_URL,
        o.EVENT_REGISTRATION_URL,
        o.ORG_ATTENDEE_COUNT,
        (u.EVENT_ID IS NOT NULL) AS IS_REGISTERED,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM org_events o
      LEFT JOIN user_reg u ON o.EVENT_ID = u.EVENT_ID
      WHERE 1=1
        ${searchQueryFilter}
        ${statusFilter}
      -- pageSize, offset, and sortOrder are pre-validated by the controller (numeric bounds + allowlist);
      -- structural keywords cannot be bound via Snowflake ? params, so they are interpolated here.
      ORDER BY o.EVENT_START_DATE ${sortOrder}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const binds: string[] = [accountId, userEmail];
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
      WITH account AS (
        SELECT ACCOUNT_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_ACCOUNT_CONTEXT
        WHERE ACCOUNT_ID = ?
        LIMIT 1
      )
      SELECT
        COUNT(DISTINCT er.EVENT_ID)                                               AS TOTAL_EVENTS,
        COUNT(DISTINCT CASE WHEN er.IS_PAST_EVENT = TRUE  THEN er.EVENT_ID END)  AS PAST_EVENTS,
        COUNT(DISTINCT CASE WHEN er.IS_PAST_EVENT = FALSE THEN er.EVENT_ID END)  AS UPCOMING_EVENTS
      FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS er
      JOIN account a ON UPPER(er.ACCOUNT_NAME) = UPPER(a.ACCOUNT_NAME)
      WHERE er.REGISTRATION_STATUS = 'Accepted'
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

  private mapRowToOrgEvent(row: OrgEventRow): OrgEvent {
    return {
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME,
      foundation: row.FOUNDATION ?? null,
      eventStartDate: formatDateToUTC(row.EVENT_START_DATE),
      eventEndDate: row.EVENT_END_DATE ? formatDateToUTC(row.EVENT_END_DATE) : null,
      eventLocation: row.EVENT_LOCATION ?? null,
      eventCity: row.EVENT_CITY ?? null,
      eventCountry: row.EVENT_COUNTRY ?? null,
      eventUrl: row.EVENT_URL ?? null,
      eventRegistrationUrl: row.EVENT_REGISTRATION_URL ?? null,
      orgAttendeeCount: row.ORG_ATTENDEE_COUNT || 0,
      isRegistered: !!row.IS_REGISTERED,
    };
  }
}
