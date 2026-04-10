// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { COMING_SOON_SENTINEL, DEFAULT_EVENT_SORT_FIELD, VALID_EVENT_SORT_FIELDS } from '@lfx-one/shared/constants';
import {
  EventRow,
  EventSortOrder,
  EventsResponse,
  FoundationEvent,
  GetEventOrganizationsOptions,
  GetEventsOptions,
  GetMyEventsOptions,
  MyEvent,
  MyEventOrganizationsResponse,
  MyEventRow,
  MyEventsResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

export class EventsService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getMyEvents(req: Request, userEmail: string, options: GetMyEventsOptions): Promise<MyEventsResponse> {
    const { isPast, eventId, projectName, searchQuery, role, status, sortField: rawSortField, pageSize, offset, sortOrder } = options;
    const sortField = rawSortField && VALID_EVENT_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_EVENT_SORT_FIELD;
    const normalizedSortOrder: EventSortOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
    const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    logger.debug(req, 'get_my_events', 'Building events query', {
      is_past: isPast,
      has_event_id: !!eventId,
      has_project_name: !!projectName,
      has_search_query: !!searchQuery,
      role,
      page_size: normalizedPageSize,
      offset: normalizedOffset,
      sort_order: normalizedSortOrder,
    });

    let sql: string;
    let binds: string[];

    if (isPast === false) {
      // Upcoming tab: show all upcoming events (registered by current user OR discoverable),
      // LEFT JOIN user's registrations so unregistered events show with null user-specific fields.
      const eventIdFilter = eventId ? 'AND EVENT_ID = ?' : '';
      const projectNameFilter = projectName ? 'AND e.PROJECT_NAME = ?' : '';
      const searchQueryFilter = searchQuery ? 'AND e.EVENT_NAME ILIKE ?' : '';
      const roleFilterResult = role ? this.buildUpcomingRoleFilter(role) : { filter: '', binds: [] as string[] };
      const statusFilterResult = status ? this.buildUpcomingStatusFilter(status) : { filter: '', binds: [] as string[] };

      sql = `
        WITH all_upcoming AS (
          SELECT
            EVENT_ID,
            EVENT_NAME,
            EVENT_START_DATE,
            EVENT_END_DATE,
            EVENT_LOCATION,
            EVENT_CITY,
            EVENT_COUNTRY,
            PROJECT_ID,
            PROJECT_NAME,
            PROJECT_SLUG,
            ACCOUNT_NAME,
            ACCOUNT_LOGO_URL,
            EVENT_URL,
            EVENT_REGISTRATION_URL
          FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
          WHERE IS_PAST_EVENT = FALSE
            ${eventIdFilter}
          QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY EVENT_START_DATE) = 1
        ),
        user_reg AS (
          SELECT
            EVENT_ID,
            USER_ROLE,
            REGISTRATION_STATUS,
            TF_REQUEST_STATUS,
            VL_REQUEST_STATUS,
            GROSS_REVENUE,
            TAX_AMOUNT,
            NET_REVENUE,
            USER_ATTENDED
          FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
          WHERE USER_EMAIL = ?
            AND IS_PAST_EVENT = FALSE
        )
        SELECT
          e.EVENT_ID,
          e.EVENT_NAME,
          e.EVENT_START_DATE,
          e.EVENT_END_DATE,
          e.EVENT_LOCATION,
          e.EVENT_CITY,
          e.EVENT_COUNTRY,
          e.PROJECT_ID,
          e.PROJECT_NAME,
          e.PROJECT_SLUG,
          e.ACCOUNT_NAME,
          e.ACCOUNT_LOGO_URL,
          e.EVENT_URL,
          e.EVENT_REGISTRATION_URL,
          r.USER_ROLE,
          r.REGISTRATION_STATUS,
          r.TF_REQUEST_STATUS,
          r.VL_REQUEST_STATUS,
          r.GROSS_REVENUE,
          r.TAX_AMOUNT,
          r.NET_REVENUE,
          r.USER_ATTENDED,
          (r.EVENT_ID IS NOT NULL) AS IS_REGISTERED,
          FALSE AS IS_PAST_EVENT,
          COUNT(*) OVER() AS TOTAL_RECORDS
        FROM all_upcoming e
        LEFT JOIN user_reg r ON e.EVENT_ID = r.EVENT_ID
        WHERE 1=1
          ${projectNameFilter}
          ${searchQueryFilter}
          ${roleFilterResult.filter}
          ${statusFilterResult.filter}
        ORDER BY ${sortField} ${normalizedSortOrder}
        LIMIT ${normalizedPageSize} OFFSET ${normalizedOffset}
      `;

      binds = [];
      if (eventId) binds.push(eventId);
      binds.push(userEmail);
      if (projectName) binds.push(projectName);
      if (searchQuery) binds.push(`%${searchQuery}%`);
      binds.push(...roleFilterResult.binds);
      binds.push(...statusFilterResult.binds);
    } else {
      // Past tab (or no isPast filter): show only the user's own registered events.
      const isPastFilter = isPast !== undefined ? `AND IS_PAST_EVENT = ${isPast ? 'TRUE' : 'FALSE'}` : '';
      const eventIdFilter = eventId ? 'AND EVENT_ID = ?' : '';
      const projectNameFilter = projectName ? 'AND PROJECT_NAME = ?' : '';
      const searchQueryFilter = searchQuery ? 'AND EVENT_NAME ILIKE ?' : '';
      const roleFilterResult = role ? this.buildRoleFilter(role) : { filter: '', binds: [] as string[] };
      const statusFilterResult = status ? this.buildStatusFilter(status) : { filter: '', binds: [] as string[] };

      sql = `
        SELECT
          EVENT_ID,
          EVENT_NAME,
          EVENT_START_DATE,
          EVENT_END_DATE,
          EVENT_LOCATION,
          EVENT_CITY,
          EVENT_COUNTRY,
          PROJECT_ID,
          PROJECT_NAME,
          PROJECT_SLUG,
          ACCOUNT_NAME,
          ACCOUNT_LOGO_URL,
          USER_ROLE,
          REGISTRATION_STATUS,
          TF_REQUEST_STATUS,
          VL_REQUEST_STATUS,
          GROSS_REVENUE,
          TAX_AMOUNT,
          NET_REVENUE,
          IS_PAST_EVENT,
          EVENT_URL,
          EVENT_REGISTRATION_URL,
          USER_ATTENDED,
          TRUE AS IS_REGISTERED,
          COUNT(*) OVER() AS TOTAL_RECORDS
        FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
        WHERE USER_EMAIL = ?
          ${isPastFilter}
          ${eventIdFilter}
          ${projectNameFilter}
          ${searchQueryFilter}
          ${roleFilterResult.filter}
          ${statusFilterResult.filter}
        ORDER BY ${sortField} ${normalizedSortOrder}
        LIMIT ${normalizedPageSize} OFFSET ${normalizedOffset}
      `;

      binds = [userEmail];
      if (eventId) binds.push(eventId);
      if (projectName) binds.push(projectName);
      if (searchQuery) binds.push(`%${searchQuery}%`);
      binds.push(...roleFilterResult.binds);
      binds.push(...statusFilterResult.binds);
    }

    logger.debug(req, 'get_my_events', 'Executing events query', { bind_count: binds.length });

    let result;
    try {
      result = await this.snowflakeService.execute<MyEventRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_my_events', 'Snowflake query failed, returning empty events', {
        error: error instanceof Error ? error.message : String(error),
        page_size: normalizedPageSize,
        offset: normalizedOffset,
      });
      return { data: [], total: 0, pageSize: normalizedPageSize, offset: normalizedOffset };
    }

    const total = result.rows.length > 0 ? result.rows[0].TOTAL_RECORDS : 0;
    const data = result.rows.map((row) => this.mapRowToEvent(row));

    logger.debug(req, 'get_my_events', 'Fetched events', { count: data.length, total });

    return { data, total, pageSize: normalizedPageSize, offset: normalizedOffset };
  }

  public async getEvents(req: Request, options: GetEventsOptions): Promise<EventsResponse> {
    const { isPast, eventId, projectNames, searchQuery, status, sortField: rawSortField, pageSize, offset, sortOrder } = options;
    const sortField = rawSortField && VALID_EVENT_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_EVENT_SORT_FIELD;
    const normalizedSortOrder: EventSortOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
    const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    logger.debug(req, 'get_events', 'Building events query', {
      is_past: isPast,
      has_event_id: !!eventId,
      project_names_count: projectNames?.length ?? 0,
      has_search_query: !!searchQuery,
      status,
      page_size: normalizedPageSize,
      offset: normalizedOffset,
      sort_order: normalizedSortOrder,
    });

    const isPastFilter = isPast !== undefined ? `AND EVENT_IS_PAST = ${isPast ? 'TRUE' : 'FALSE'}` : '';
    const eventIdFilter = eventId ? 'AND EVENT_ID = ?' : '';
    const projectNamesFilter = projectNames && projectNames.length > 0 ? `AND PROJECT_NAME IN (${projectNames.map(() => '?').join(', ')})` : '';
    const searchQueryFilter = searchQuery ? 'AND EVENT_NAME ILIKE ?' : '';
    let statusFilter = '';
    if (status === COMING_SOON_SENTINEL) {
      statusFilter = "AND EVENT_STATUS IN ('Pending', 'Planned')";
    } else if (status) {
      statusFilter = 'AND EVENT_STATUS = ?';
    }

    const sql = `
      SELECT
        E.EVENT_ID,
        EVENT_NAME,
        EVENT_CATEGORY,
        EVENT_START_DATE,
        EVENT_END_DATE,
        EVENT_LOCATION,
        EVENT_CITY,
        EVENT_COUNTRY,
        EVENT_STATUS,
        EVENT_IS_PAST AS IS_PAST_EVENT,
        ANY_VALUE(EVENT_URL) AS EVENT_URL,
        ANY_VALUE(EVENT_REGISTRATION_URL) AS EVENT_REGISTRATION_URL,
        ANY_VALUE(ATTENDEES) AS ATTENDEES,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM ANALYTICS.SILVER_DIM.EVENTS E
      LEFT JOIN (SELECT EVENT_ID, COUNT(REGISTRATION_ID) AS ATTENDEES
      FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS WHERE IS_PAST_EVENT = TRUE AND USER_ATTENDED = TRUE GROUP BY EVENT_ID) EA
        ON E.EVENT_ID = EA.EVENT_ID
      WHERE EVENT_STATUS IN ('Planned', 'Pending', 'Completed', 'Active')
        ${isPastFilter}
        ${eventIdFilter}
        ${projectNamesFilter}
        ${searchQueryFilter}
        ${statusFilter}
      GROUP BY
        E.EVENT_ID,
        EVENT_NAME,
        EVENT_CATEGORY,
        EVENT_START_DATE,
        EVENT_END_DATE,
        EVENT_LOCATION,
        EVENT_CITY,
        EVENT_COUNTRY,
        EVENT_STATUS,
        EVENT_IS_PAST
      ORDER BY ${sortField} ${normalizedSortOrder}
      LIMIT ${normalizedPageSize} OFFSET ${normalizedOffset}
    `;

    const binds: string[] = [];
    if (eventId) binds.push(eventId);
    if (projectNames && projectNames.length > 0) binds.push(...projectNames);
    if (searchQuery) binds.push(`%${searchQuery}%`);
    if (status && status !== COMING_SOON_SENTINEL) binds.push(status);

    logger.debug(req, 'get_events', 'Executing events query', { bind_count: binds.length });

    let result;
    try {
      result = await this.snowflakeService.execute<EventRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_events', 'Snowflake query failed, returning empty events', {
        error: error instanceof Error ? error.message : String(error),
        page_size: normalizedPageSize,
        offset: normalizedOffset,
      });
      return { data: [], total: 0, pageSize: normalizedPageSize, offset: normalizedOffset };
    }

    const total = result.rows.length > 0 ? result.rows[0].TOTAL_RECORDS : 0;
    const data = result.rows.map((row) => this.mapRowToFoundationEvent(row));

    logger.debug(req, 'get_events', 'Fetched events', { count: data.length, total });

    return { data, total, pageSize: normalizedPageSize, offset: normalizedOffset };
  }

  public async getEventOrganizations(req: Request, userEmail: string, options: GetEventOrganizationsOptions): Promise<MyEventOrganizationsResponse> {
    const { projectName, isPast } = options;

    logger.debug(req, 'get_event_organizations', 'Building organizations query', {
      has_project_name: !!projectName,
      is_past: isPast,
    });

    let sql: string;
    const binds: string[] = [];

    if (isPast === true) {
      // Past tab: return only foundations from the authenticated user's registered past events.
      const projectNameFilter = projectName ? 'AND PROJECT_NAME = ?' : '';
      sql = `
        SELECT DISTINCT PROJECT_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
        WHERE USER_EMAIL = ?
          AND IS_PAST_EVENT = TRUE
          ${projectNameFilter}
        ORDER BY PROJECT_NAME
      `;
      binds.push(userEmail);
      if (projectName) binds.push(projectName);
    } else {
      // Upcoming tab: return all distinct project names from upcoming events so the foundation
      // filter dropdown includes both the user's registered foundations and discoverable ones.
      const projectNameFilter = projectName ? 'AND PROJECT_NAME = ?' : '';
      sql = `
        SELECT DISTINCT PROJECT_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
        WHERE IS_PAST_EVENT = FALSE
          ${projectNameFilter}
        ORDER BY PROJECT_NAME
      `;
      if (projectName) binds.push(projectName);
    }

    logger.debug(req, 'get_event_organizations', 'Executing organizations query', { bind_count: binds.length });

    let result;
    try {
      result = await this.snowflakeService.execute<{ PROJECT_NAME: string }>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_event_organizations', 'Snowflake query failed, returning empty organizations', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { data: [] };
    }

    const data = result.rows.map((row) => row.PROJECT_NAME);

    logger.debug(req, 'get_event_organizations', 'Fetched organizations', { count: data.length });

    return { data };
  }

  /** Status filter for the past events query (unqualified column names, no IS NULL support). */
  private buildStatusFilter(status: string): { filter: string; binds: string[] } {
    switch (status) {
      case 'registered':
        return { filter: 'AND REGISTRATION_STATUS = ?', binds: ['Accepted'] };
      case 'attended':
        return { filter: 'AND USER_ATTENDED = 1', binds: [] };
      default:
        return { filter: '', binds: [] };
    }
  }

  /** Role filter for the past events query (unqualified column names). */
  private buildRoleFilter(role: string): { filter: string; binds: string[] } {
    switch (role) {
      case 'attendee':
        return { filter: 'AND USER_ROLE = ?', binds: ['Attendee'] };
      case 'registered':
        return { filter: 'AND USER_ROLE = ?', binds: ['Registered'] };
      case 'speaker':
        return { filter: 'AND USER_ROLE = ?', binds: ['Speaker'] };
      case 'sponsor':
        return { filter: 'AND USER_ROLE = ?', binds: ['Sponsor'] };
      default:
        return { filter: '', binds: [] };
    }
  }

  /**
   * Status filter for the upcoming events query (LEFT JOIN — uses `r.` alias).
   * 'not-registered' matches rows where the user has no registration (r.EVENT_ID IS NULL).
   */
  private buildUpcomingStatusFilter(status: string): { filter: string; binds: string[] } {
    switch (status) {
      case 'registered':
        return { filter: 'AND r.EVENT_ID IS NOT NULL AND r.REGISTRATION_STATUS = ?', binds: ['Accepted'] };
      case 'attended':
        return { filter: 'AND r.USER_ATTENDED = 1', binds: [] };
      case 'not-registered':
        return { filter: 'AND r.EVENT_ID IS NULL', binds: [] };
      default:
        return { filter: '', binds: [] };
    }
  }

  /**
   * Role filter for the upcoming events query (LEFT JOIN — uses `r.` alias).
   * Applying a role filter naturally excludes unregistered events since r.USER_ROLE is NULL for them.
   */
  private buildUpcomingRoleFilter(role: string): { filter: string; binds: string[] } {
    switch (role) {
      case 'attendee':
        return { filter: 'AND r.USER_ROLE = ?', binds: ['Attendee'] };
      case 'registered':
        return { filter: 'AND r.USER_ROLE = ?', binds: ['Registered'] };
      case 'speaker':
        return { filter: 'AND r.USER_ROLE = ?', binds: ['Speaker'] };
      case 'sponsor':
        return { filter: 'AND r.USER_ROLE = ?', binds: ['Sponsor'] };
      default:
        return { filter: '', binds: [] };
    }
  }

  private mapRowToFoundationEvent(row: EventRow): FoundationEvent {
    return {
      id: row.EVENT_ID,
      name: row.EVENT_NAME,
      category: row.EVENT_CATEGORY,
      url: row.EVENT_URL ?? '',
      registrationUrl: row.EVENT_REGISTRATION_URL ?? null,
      date: this.formatDateRange(row.EVENT_START_DATE, row.EVENT_END_DATE),
      location: this.formatLocation(row.EVENT_LOCATION, row.EVENT_CITY, row.EVENT_COUNTRY),
      status: row.EVENT_STATUS ?? null,
      isPast: row.IS_PAST_EVENT,
      attendees: row.ATTENDEES ?? null,
    };
  }

  private mapRowToEvent(row: MyEventRow): MyEvent {
    // Status simplification: The query filters (buildStatusFilter / buildUpcomingStatusFilter) ensure
    // only rows with REGISTRATION_STATUS = 'Accepted' (or LEFT JOINed nulls for upcoming discovery)
    // reach this mapper. If new REGISTRATION_STATUS values are added to Snowflake, this mapping
    // should be updated to derive status from row.REGISTRATION_STATUS directly.
    let status: string;
    if (!row.IS_REGISTERED) {
      status = 'Not Registered';
    } else if (row.IS_PAST_EVENT && row.USER_ATTENDED) {
      status = 'Attended';
    } else {
      status = 'Registered';
    }

    return {
      id: row.EVENT_ID,
      name: row.EVENT_NAME,
      url: row.EVENT_URL ?? '',
      registrationUrl: row.EVENT_REGISTRATION_URL ?? null,
      foundation: row.PROJECT_NAME,
      date: this.formatDateRange(row.EVENT_START_DATE, row.EVENT_END_DATE),
      location: this.formatLocation(row.EVENT_LOCATION, row.EVENT_CITY, row.EVENT_COUNTRY),
      role: row.USER_ROLE ?? '',
      status,
      isRegistered: row.IS_REGISTERED,
    };
  }

  private formatDateRange(start: Date | string, end: Date | string | null): string {
    const startDate = new Date(start);
    const singleDateFormat = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (!end) {
      return singleDateFormat;
    }

    const endDate = new Date(end);
    const sameDay = startDate.toDateString() === endDate.toDateString();

    if (sameDay) {
      return singleDateFormat;
    }

    const sameMonthYear = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();

    if (sameMonthYear) {
      const month = startDate.toLocaleDateString('en-US', { month: 'short' });
      return `${month} ${startDate.getDate()} – ${endDate.getDate()}, ${startDate.getFullYear()}`;
    }

    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }

  private formatLocation(location: string | null, city: string | null, country: string | null): string {
    if (city && country) return `${city}, ${country}`;
    if (location) return location;
    return city ?? country ?? 'Virtual';
  }
}
