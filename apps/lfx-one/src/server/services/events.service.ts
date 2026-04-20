// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  COMING_SOON_SENTINEL,
  DEFAULT_EVENT_SORT_FIELD,
  DEFAULT_VISA_REQUEST_SORT_FIELD,
  VALID_EVENT_SORT_FIELDS,
  VALID_VISA_REQUEST_SORT_FIELDS,
  WHOLE_NUMBER_PATTERN,
} from '@lfx-one/shared/constants';
import {
  EventRow,
  EventSortOrder,
  EventsResponse,
  FoundationEvent,
  GetEventOrganizationsOptions,
  GetEventRequestsOptions,
  GetEventsOptions,
  GetMyEventsOptions,
  GetUpcomingCountriesResponse,
  MyEvent,
  MyEventOrganizationsResponse,
  MyEventRow,
  MyEventsResponse,
  TravelFundApplication,
  TravelFundApplicationResponse,
  TravelFundRequestsResponse,
  OrgSearchResponse,
  VisaRequest,
  VisaRequestApplication,
  VisaRequestApplicationResponse,
  VisaRequestRow,
  VisaRequestsResponse,
} from '@lfx-one/shared/interfaces';
import { formatDateToUTC } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { UserService } from './user.service';

export class EventsService {
  private snowflakeService: SnowflakeService;
  private userService: UserService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
    this.userService = new UserService();
  }

  public async getMyEvents(req: Request, userEmail: string, options: GetMyEventsOptions): Promise<MyEventsResponse> {
    const {
      isPast,
      eventId,
      projectName,
      searchQuery,
      role,
      status,
      sortField: rawSortField,
      pageSize,
      offset,
      sortOrder,
      registeredOnly,
      startDateFrom,
      startDateTo,
      country,
      affiliatedProjectSlugs,
    } = options;
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
      affiliated_project_count: affiliatedProjectSlugs?.length ?? 0,
      page_size: normalizedPageSize,
      offset: normalizedOffset,
      sort_order: normalizedSortOrder,
    });

    let sql: string;
    let binds: string[];

    if (isPast === false) {
      // Upcoming tab: show events from affiliated projects UNION user's registered events.
      // When affiliatedProjectSlugs is empty, use AND 1=0 so only registered events appear
      // (persona detection returned no affiliations or encountered an error).
      const eventIdFilter = eventId ? 'AND EVENT_ID = ?' : '';
      const projectNameFilter = projectName ? 'AND e.PROJECT_NAME = ?' : '';
      const searchQueryFilter = searchQuery ? 'AND e.EVENT_NAME ILIKE ?' : '';
      const roleFilterResult = role ? this.buildUpcomingRoleFilter(role) : { filter: '', binds: [] as string[] };
      const statusFilterResult = status ? this.buildUpcomingStatusFilter(status) : { filter: '', binds: [] as string[] };
      const startDateFromFilter = startDateFrom ? 'AND e.EVENT_START_DATE >= ?' : '';
      const startDateToFilter = startDateTo ? 'AND e.EVENT_START_DATE <= ?' : '';
      const countryFilter = country ? 'AND e.EVENT_COUNTRY = ?' : '';
      const registeredOnlyFilter = registeredOnly ? "AND r.EVENT_ID IS NOT NULL AND r.REGISTRATION_STATUS = 'Accepted'" : '';

      const slugs = affiliatedProjectSlugs ?? [];
      const hasAffiliatedSlugs = slugs.length > 0;
      const affiliatedFilter = hasAffiliatedSlugs ? `AND LOWER(PROJECT_SLUG) IN (${slugs.map(() => '?').join(', ')})` : 'AND 1=0';

      sql = `
        WITH affiliated_upcoming AS (
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
            ${affiliatedFilter}
          QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY EVENT_START_DATE) = 1
        ),
        registered_events AS (
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
          WHERE USER_EMAIL = ?
            AND IS_PAST_EVENT = FALSE
            AND REGISTRATION_STATUS = 'Accepted'
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
            AND REGISTRATION_STATUS = 'Accepted'
        ),
        combined AS (
          SELECT *, 1 AS source_priority FROM registered_events
          UNION ALL
          SELECT *, 2 AS source_priority FROM affiliated_upcoming
          QUALIFY ROW_NUMBER() OVER (PARTITION BY EVENT_ID ORDER BY source_priority) = 1
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
        FROM combined e
        LEFT JOIN user_reg r ON e.EVENT_ID = r.EVENT_ID
        WHERE 1=1
          ${projectNameFilter}
          ${searchQueryFilter}
          ${roleFilterResult.filter}
          ${statusFilterResult.filter}
          ${startDateFromFilter}
          ${startDateToFilter}
          ${countryFilter}
          ${registeredOnlyFilter}
        ORDER BY ${sortField} ${normalizedSortOrder}
        LIMIT ${normalizedPageSize} OFFSET ${normalizedOffset}
      `;

      const affiliatedUpcomingBinds: string[] = [...(eventId ? [eventId] : []), ...slugs];
      const registeredEventsBinds: string[] = [userEmail, ...(eventId ? [eventId] : [])];
      const userRegBinds: string[] = [userEmail];
      const whereBinds: string[] = [
        ...(projectName ? [projectName] : []),
        ...(searchQuery ? [`%${searchQuery}%`] : []),
        ...roleFilterResult.binds,
        ...statusFilterResult.binds,
        ...(startDateFrom ? [startDateFrom] : []),
        ...(startDateTo ? [startDateTo] : []),
        ...(country ? [country] : []),
      ];
      binds = [...affiliatedUpcomingBinds, ...registeredEventsBinds, ...userRegBinds, ...whereBinds];

      logger.debug(req, 'get_my_events', 'Upcoming events query binds', {
        affiliated_project_slugs: slugs,
        affiliated_filter_active: hasAffiliatedSlugs,
        user_email: '***',
        bind_count: binds.length,
      });
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
    const { projectName, isPast, affiliatedProjectSlugs } = options;

    logger.debug(req, 'get_event_organizations', 'Building organizations query', {
      has_project_name: !!projectName,
      is_past: isPast,
      affiliated_project_count: affiliatedProjectSlugs?.length ?? 0,
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
      // Upcoming tab: return foundations from events the user has registered for OR that belong
      // to affiliated projects. When affiliatedProjectSlugs is empty, show only registered foundations.
      const projectNameFilter = projectName ? 'AND PROJECT_NAME = ?' : '';
      const slugs = affiliatedProjectSlugs ?? [];
      const hasAffiliatedSlugs = slugs.length > 0;
      const affiliatedFilter = hasAffiliatedSlugs ? `OR LOWER(PROJECT_SLUG) IN (${slugs.map(() => '?').join(', ')})` : '';

      sql = `
        SELECT DISTINCT PROJECT_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
        WHERE IS_PAST_EVENT = FALSE
          AND ((USER_EMAIL = ? AND REGISTRATION_STATUS = 'Accepted') ${affiliatedFilter})
          ${projectNameFilter}
        ORDER BY PROJECT_NAME
      `;
      binds.push(userEmail);
      if (hasAffiliatedSlugs) binds.push(...slugs);
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

  public async getUpcomingCountries(req: Request): Promise<GetUpcomingCountriesResponse> {
    logger.debug(req, 'get_upcoming_countries', 'Fetching distinct countries for upcoming events');

    const sql = `
      SELECT DISTINCT EVENT_COUNTRY
      FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
      WHERE IS_PAST_EVENT = FALSE
        AND EVENT_COUNTRY IS NOT NULL
      ORDER BY EVENT_COUNTRY
    `;

    let result;
    try {
      result = await this.snowflakeService.execute<{ EVENT_COUNTRY: string }>(sql, []);
    } catch (error) {
      logger.warning(req, 'get_upcoming_countries', 'Snowflake query failed, returning empty countries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { data: [] };
    }

    const data = result.rows.map((row) => row.EVENT_COUNTRY);

    logger.debug(req, 'get_upcoming_countries', 'Fetched countries', { count: data.length });

    return { data };
  }

  public async getVisaRequests(req: Request, userEmail: string, options: GetEventRequestsOptions): Promise<VisaRequestsResponse> {
    return this.executeEventRequestsQuery(req, userEmail, options, 'VL_REQUEST_STATUS', 'VL_APPLICATION_DATE', 'get_visa_requests');
  }

  public async getTravelFundRequests(req: Request, userEmail: string, options: GetEventRequestsOptions): Promise<TravelFundRequestsResponse> {
    return this.executeEventRequestsQuery(req, userEmail, options, 'TF_REQUEST_STATUS', 'TF_APPLICATION_DATE', 'get_travel_fund_requests');
  }

  /**
   * Submit a visa letter application to the API Gateway user-service.
   */
  public async submitVisaRequestApplication(req: Request, payload: VisaRequestApplication): Promise<VisaRequestApplicationResponse> {
    logger.debug(req, 'submit_visa_request_application', 'Submitting visa letter application', {
      event_id: payload.eventId,
      event_name: payload.eventName,
    });

    const apiGwAudience = process.env['API_GW_AUDIENCE'];

    if (!apiGwAudience) {
      throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
        operation: 'submit_visa_request_application',
      });
    }

    if (!req.apiGatewayToken) {
      throw new MicroserviceError('API Gateway token not available', 503, 'API_GATEWAY_UNAVAILABLE', {
        operation: 'submit_visa_request_application',
      });
    }

    const { applicantInfo } = payload;
    // Derive the user's Salesforce ID from the authenticated session — never trust client-provided userId
    const profile = await this.userService.getApiGatewayProfile(req);
    const serverUserId = profile.ID;

    if (!serverUserId) {
      throw new MicroserviceError('Salesforce ID not found in API Gateway profile — cannot submit visa request', 422, 'SALESFORCE_ID_NOT_FOUND', {
        operation: 'submit_visa_request_application',
      });
    }

    const targetUrl = `${apiGwAudience.replace(/\/+$/, '')}/user-service/v1/users/${serverUserId}/visaletterrequests`;

    const missingFields: string[] = [];
    if (!applicantInfo.attendeeType) missingFields.push('attendeeType');
    if (!applicantInfo.attendeeAccommodationPaidBy) missingFields.push('attendeeAccommodationPaidBy');
    if (!applicantInfo.birthDate) missingFields.push('birthDate');
    if (!applicantInfo.citizenshipCountry) missingFields.push('citizenshipCountry');
    if (!applicantInfo.passportNumber) missingFields.push('passportNumber');
    if (!applicantInfo.organizationID) missingFields.push('organizationID');
    if (!applicantInfo.embassyCity) missingFields.push('embassyCity');
    if (missingFields.length > 0) {
      throw new MicroserviceError(`Missing required visa request fields: ${missingFields.join(', ')}`, 422, 'INVALID_REQUEST_FIELDS', {
        operation: 'submit_visa_request_application',
        errorBody: { missingFields },
      });
    }

    let eventID = payload.eventId;
    if (process.env['NODE_ENV'] !== 'production' && process.env['API_GW_DEV_EVENT_ID_OVERRIDE']) {
      logger.warning(req, 'submit_visa_request_application', 'Using API_GW_DEV_EVENT_ID_OVERRIDE (dev-only)', {
        override_event_id: process.env['API_GW_DEV_EVENT_ID_OVERRIDE'],
        original_event_id: payload.eventId,
      });
      eventID = process.env['API_GW_DEV_EVENT_ID_OVERRIDE'];
    }

    const body = {
      onBehalfRequest: false, // We're not including this in the form so we just default it
      attendeeAccommodationPaidBy: applicantInfo.attendeeAccommodationPaidBy,
      attendeeType: applicantInfo.attendeeType,
      birthCountry: applicantInfo.citizenshipCountry,
      birthDate: formatDateToUTC(applicantInfo.birthDate),
      email: applicantInfo.email,
      eventID: eventID,
      firstName: applicantInfo.firstName,
      lastName: applicantInfo.lastName,
      nameAsPerPassport: `${applicantInfo.firstName} ${applicantInfo.lastName}`,
      organizationID: applicantInfo.organizationID,
      passportNumber: applicantInfo.passportNumber,
      requestingUserID: serverUserId,
      userID: serverUserId,
      username: applicantInfo.email,
      City: applicantInfo.embassyCity,
      ...(applicantInfo.company && { jobTitle: applicantInfo.company }),
      ...(applicantInfo.mailingAddress && { addressLine01: applicantInfo.mailingAddress }),
      ...(applicantInfo.passportExpiryDate && {
        passportExpiryDate: formatDateToUTC(applicantInfo.passportExpiryDate),
      }),
    };

    logger.info(req, 'submit_visa_request_application', 'Calling API Gateway visa endpoint', {
      target_url: targetUrl,
      server_user_id: serverUserId,
      event_id: payload.eventId,
    });

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiGatewayToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      throw new MicroserviceError(`Visa letter API returned ${upstream.status}`, upstream.status, 'API_GATEWAY_ERROR', {
        operation: 'submit_visa_request_application',
        errorBody: errorText,
      });
    }

    logger.debug(req, 'submit_visa_request_application', 'Visa letter application submitted successfully', {
      event_id: payload.eventId,
    });

    return { success: true, message: 'Your visa letter application has been submitted successfully.' };
  }

  /**
   * Submit a travel fund application.
   */
  public async submitTravelFundApplication(req: Request, payload: TravelFundApplication): Promise<TravelFundApplicationResponse> {
    logger.debug(req, 'submit_travel_fund_application', 'Submitting travel fund application', {
      event_id: payload.eventId,
      event_name: payload.eventName,
      estimated_total: payload.expenses.estimatedTotal,
    });

    const apiGwAudience = process.env['API_GW_AUDIENCE'];

    if (!apiGwAudience) {
      throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
        operation: 'submit_travel_fund_application',
      });
    }

    if (!req.apiGatewayToken) {
      throw new MicroserviceError('API Gateway token not available', 503, 'API_GATEWAY_UNAVAILABLE', {
        operation: 'submit_travel_fund_application',
      });
    }

    // Derive the user's Salesforce ID from the authenticated session — never trust client-provided userId
    const profile = await this.userService.getApiGatewayProfile(req);
    const serverUserId = profile.ID;

    if (!serverUserId) {
      throw new MicroserviceError('Salesforce ID not found in API Gateway profile — cannot submit travel fund application', 422, 'SALESFORCE_ID_NOT_FOUND', {
        operation: 'submit_travel_fund_application',
      });
    }

    const targetUrl = `${apiGwAudience.replace(/\/+$/, '')}/user-service/v1/users/${serverUserId}/travelfundrequests`;

    const { aboutMe, expenses } = payload;

    // Parse numeric fields up-front so validation and body construction share the same values
    const rawNights = String(aboutMe.accommodationNumberOfNights).trim();
    const accommodationNumberOfNights = WHOLE_NUMBER_PATTERN.test(rawNights) ? Number(rawNights) : Number.NaN;
    const estimatedTotal = Number(expenses.estimatedTotal);

    const validationErrors: string[] = [];
    if (!aboutMe.citizenshipCountry) validationErrors.push('citizenshipCountry');
    if (!aboutMe.organizationID) validationErrors.push('organizationID');
    if (!aboutMe.travelFromCountry) validationErrors.push('travelFromCountry');
    if (!Number.isInteger(accommodationNumberOfNights) || accommodationNumberOfNights < 0 || accommodationNumberOfNights > 4) {
      validationErrors.push('accommodationNumberOfNights');
    }
    if (!Number.isFinite(estimatedTotal) || estimatedTotal <= 0) validationErrors.push('estimatedTotal');
    if (validationErrors.length > 0) {
      throw new MicroserviceError(`Invalid travel fund request fields: ${validationErrors.join(', ')}`, 422, 'INVALID_REQUEST_FIELDS', {
        operation: 'submit_travel_fund_application',
        errorBody: { validationErrors },
      });
    }

    let eventID = payload.eventId;
    if (process.env['NODE_ENV'] !== 'production' && process.env['API_GW_DEV_EVENT_ID_OVERRIDE']) {
      logger.warning(req, 'submit_travel_fund_application', 'Using API_GW_DEV_EVENT_ID_OVERRIDE (dev-only)', {
        override_event_id: process.env['API_GW_DEV_EVENT_ID_OVERRIDE'],
        original_event_id: payload.eventId,
      });
      eventID = process.env['API_GW_DEV_EVENT_ID_OVERRIDE'];
    }

    const body = {
      accommodationNumberOfNights,
      citizenshipCountry: aboutMe.citizenshipCountry,
      email: aboutMe.email,
      eventID: eventID,
      firstName: aboutMe.firstName,
      lastName: aboutMe.lastName,
      onBehalfRequest: false,
      organizationID: aboutMe.organizationID,
      requestingUserID: serverUserId,
      travelCostEstimationUSD: estimatedTotal,
      travelingFromCountry: aboutMe.travelFromCountry,
      userID: serverUserId,
      username: aboutMe.email,
      attendingOnBehalfOfOrg: aboutMe.attendingForCompany === 'yes',
      isDiversityLGBTQIAPlus: aboutMe.isLgbtqia,
      isDiversityOther: aboutMe.isDiversityOther,
      isDiversityPersonWithDisability: aboutMe.isPersonWithDisability,
      isDiversityPreferNotToAnswer: aboutMe.preferNotToAnswer,
      isDiversityWoman: aboutMe.isWoman,
      projectInvolvementDescription: aboutMe.openSourceInvolvement,
      publicProfileLink: aboutMe.profileLink,
      receivedTravelFundingLast12Months: aboutMe.canReceiveFunds === 'yes',
      willingToWriteBlogOnEvent: aboutMe.willingToBlog === 'yes',
    };

    logger.info(req, 'submit_travel_fund_application', 'Calling API Gateway travel fund endpoint', {
      target_url: targetUrl,
      server_user_id: serverUserId,
      event_id: payload.eventId,
    });

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiGatewayToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      logger.debug(req, 'submit_travel_fund_application', 'Upstream fetch failed', { err });
      throw new MicroserviceError('Travel fund API request failed', 503, 'API_GATEWAY_UNAVAILABLE', {
        operation: 'submit_travel_fund_application',
        errorBody: err instanceof Error ? err.message : String(err),
      });
    }

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      throw new MicroserviceError(`Travel fund API returned ${upstream.status}`, upstream.status, 'API_GATEWAY_ERROR', {
        operation: 'submit_travel_fund_application',
        errorBody: errorText,
      });
    }

    logger.debug(req, 'submit_travel_fund_application', 'Travel fund application submitted successfully', {
      event_id: payload.eventId,
    });

    return { success: true, message: 'Your travel fund application has been submitted successfully.' };
  }

  /**
   * Search organizations by name via the API Gateway organization-service.
   * Returns only ID and Name from the upstream response.
   */
  public async searchOrganizations(req: Request, name: string): Promise<OrgSearchResponse> {
    logger.debug(req, 'search_organizations', 'Searching organizations by name', { name });

    const apiGwAudience = process.env['API_GW_AUDIENCE'];

    if (!apiGwAudience) {
      throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
        operation: 'search_organizations',
      });
    }

    if (!req.apiGatewayToken) {
      throw new MicroserviceError('API Gateway token not available', 503, 'API_GATEWAY_UNAVAILABLE', {
        operation: 'search_organizations',
      });
    }

    const targetUrl = `${apiGwAudience.replace(/\/+$/, '')}/organization-service/v1/orgs/search?name=${encodeURIComponent(name)}`;

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${req.apiGatewayToken}`,
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      logger.warning(req, 'search_organizations', 'Upstream fetch failed, returning empty', {
        name_length: name.length,
        err,
      });
      return { data: [] };
    }

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '');
      logger.warning(req, 'search_organizations', 'Upstream returned non-OK status, returning empty', {
        status: upstream.status,
        name_length: name.length,
        errorBody: errorText.slice(0, 500),
      });
      return { data: [] };
    }

    let json: { Data?: { ID?: string; Name?: string }[] } = {};
    try {
      const rawBody = await upstream.text();
      json = rawBody ? JSON.parse(rawBody) : {};
    } catch (err) {
      logger.warning(req, 'search_organizations', 'Upstream returned invalid JSON, returning empty', {
        name_length: name.length,
        err,
      });
      return { data: [] };
    }

    const items = json.Data ?? [];

    const data = items
      .filter((item): item is { ID: string; Name: string } => typeof item.ID === 'string' && typeof item.Name === 'string')
      .map((item) => ({ id: item.ID, name: item.Name }));

    logger.debug(req, 'search_organizations', 'Organization search complete', { result_count: data.length });

    return { data };
  }

  private async executeEventRequestsQuery(
    req: Request,
    userEmail: string,
    options: GetEventRequestsOptions,
    statusColumn: string,
    applicationDateColumn: string,
    operationName: string
  ): Promise<VisaRequestsResponse> {
    const { eventId, projectName, searchQuery, status, sortField: rawSortField, pageSize, offset, sortOrder } = options;
    const sortField = rawSortField && VALID_VISA_REQUEST_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_VISA_REQUEST_SORT_FIELD;
    const normalizedSortOrder: EventSortOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
    const normalizedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    logger.debug(req, operationName, 'Building event requests query', {
      has_event_id: !!eventId,
      has_project_name: !!projectName,
      has_search_query: !!searchQuery,
      status,
      page_size: normalizedPageSize,
      offset: normalizedOffset,
      sort_order: normalizedSortOrder,
    });

    const eventIdFilter = eventId ? 'AND EVENT_ID = ?' : '';
    const projectNameFilter = projectName ? 'AND PROJECT_NAME = ?' : '';
    const searchQueryFilter = searchQuery ? 'AND EVENT_NAME ILIKE ?' : '';
    const statusFilter = status ? `AND ${statusColumn} = ?` : '';

    const sql = `
      SELECT
        EVENT_ID,
        EVENT_NAME,
        EVENT_URL,
        EVENT_LOCATION,
        EVENT_CITY,
        EVENT_COUNTRY,
        ${applicationDateColumn} AS APPLICATION_DATE,
        ${statusColumn} AS REQUEST_STATUS,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
      WHERE ${statusColumn} IS NOT NULL
        AND USER_EMAIL = ?
        ${eventIdFilter}
        ${projectNameFilter}
        ${searchQueryFilter}
        ${statusFilter}
      -- sortField is validated against VALID_VISA_REQUEST_SORT_FIELDS allowlist above; safe to interpolate
      ORDER BY ${sortField} ${normalizedSortOrder}
      LIMIT ${normalizedPageSize} OFFSET ${normalizedOffset}
    `;

    const binds: string[] = [userEmail];
    if (eventId) binds.push(eventId);
    if (projectName) binds.push(projectName);
    if (searchQuery) binds.push(`%${searchQuery}%`);
    if (status) binds.push(status);

    logger.debug(req, operationName, 'Executing event requests query', { bind_count: binds.length });

    let result;
    try {
      result = await this.snowflakeService.execute<VisaRequestRow>(sql, binds);
    } catch (error) {
      logger.warning(req, operationName, 'Snowflake query failed, returning empty results', {
        error: error instanceof Error ? error.message : String(error),
        page_size: normalizedPageSize,
        offset: normalizedOffset,
      });
      return { data: [], total: 0, pageSize: normalizedPageSize, offset: normalizedOffset };
    }

    const total = result.rows.length > 0 ? result.rows[0].TOTAL_RECORDS : 0;
    const data = result.rows.map((row) => this.mapRowToVisaRequest(row));

    logger.debug(req, operationName, 'Fetched event requests', { count: data.length, total });

    return { data, total, pageSize: normalizedPageSize, offset: normalizedOffset };
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

  private mapRowToVisaRequest(row: VisaRequestRow): VisaRequest {
    return {
      id: row.EVENT_ID,
      name: row.EVENT_NAME,
      url: row.EVENT_URL ?? '',
      location: this.formatLocation(row.EVENT_LOCATION, row.EVENT_CITY, row.EVENT_COUNTRY),
      applicationDate: row.APPLICATION_DATE
        ? new Date(row.APPLICATION_DATE).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—',
      status: row.REQUEST_STATUS,
    };
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
      startDate: new Date(row.EVENT_START_DATE).toISOString(),
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
