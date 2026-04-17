// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { CertificateService } from '../services/certificate.service';
import {
  DEFAULT_EVENTS_PAGE_SIZE,
  MAX_EVENTS_PAGE_SIZE,
  VALID_EVENT_SORT_ORDERS,
  VALID_EVENT_STATUS_VALUES,
  VALID_MY_EVENT_STATUS_VALUES,
} from '@lfx-one/shared/constants';
import {
  EventSortOrder,
  EventStatusFilter,
  GetEventOrganizationsOptions,
  GetEventRequestsOptions,
  GetEventsOptions,
  GetUpcomingCountriesResponse,
  OrgSearchResponse,
  TravelFundApplication,
  TravelFundRequestsResponse,
  VisaRequestApplication,
  VisaRequestsResponse,
} from '@lfx-one/shared/interfaces';
import { EventsService } from '../services/events.service';
import { PersonaDetectionService } from '../services/persona-detection.service';
import { getEffectiveEmail, getEffectiveName } from '../utils/auth-helper';

export class EventsController {
  private readonly eventsService = new EventsService();
  private readonly certificateService = new CertificateService();
  private readonly personaDetectionService = new PersonaDetectionService();

  /**
   * GET /api/events
   * Get paginated events for the authenticated user
   * Query params: isPast (bool), eventId (string), pageSize (number), offset (number), sortOrder (ASC|DESC)
   */
  public async getMyEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_events', {
      has_query: Object.keys(req.query).length > 0,
    });

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_my_events',
        });
      }

      const rawPageSize = parseInt(String(req.query['pageSize'] ?? DEFAULT_EVENTS_PAGE_SIZE), 10);
      const rawOffset = parseInt(String(req.query['offset'] ?? 0), 10);
      const rawSortOrder = String(req.query['sortOrder'] ?? 'ASC').toUpperCase() as EventSortOrder;
      const rawIsPast = req.query['isPast'];
      const eventId = req.query['eventId'] ? String(req.query['eventId']) : undefined;
      const projectName = req.query['projectName'] ? String(req.query['projectName']) : undefined;
      const searchQuery = req.query['searchQuery'] ? String(req.query['searchQuery']).trim() : undefined;
      const role = req.query['role'] ? String(req.query['role']) : undefined;
      const rawMyEventStatus = req.query['status'] ? String(req.query['status']) : undefined;
      const status = rawMyEventStatus && VALID_MY_EVENT_STATUS_VALUES.has(rawMyEventStatus) ? rawMyEventStatus : undefined;
      const sortField = req.query['sortField'] ? String(req.query['sortField']) : undefined;
      const registeredOnly = req.query['registeredOnly'] === 'true';
      const startDateFrom = req.query['startDateFrom'] ? String(req.query['startDateFrom']) : undefined;
      const startDateTo = req.query['startDateTo'] ? String(req.query['startDateTo']) : undefined;
      const country = req.query['country'] ? String(req.query['country']) : undefined;

      const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_EVENTS_PAGE_SIZE ? rawPageSize : DEFAULT_EVENTS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const sortOrder: EventSortOrder = VALID_EVENT_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'ASC';
      let isPast: boolean | undefined;
      if (rawIsPast === 'true') {
        isPast = true;
      } else if (rawIsPast === 'false') {
        isPast = false;
      }

      // For upcoming events, fetch affiliated project slugs server-side from the persona service.
      // Slugs are used because PROJECT_SLUG is the shared key between the persona service and datalake.
      // This ensures client-supplied values cannot be used to access events from arbitrary projects.
      let affiliatedProjectSlugs: string[] | undefined;
      if (isPast === false) {
        affiliatedProjectSlugs = await this.personaDetectionService.getAffiliatedProjectSlugs(req);
      }

      const response = await this.eventsService.getMyEvents(req, userEmail, {
        isPast,
        eventId,
        projectName,
        searchQuery,
        role,
        status,
        sortField,
        pageSize,
        offset,
        sortOrder,
        registeredOnly,
        startDateFrom,
        startDateTo,
        country,
        affiliatedProjectSlugs,
      });

      logger.success(req, 'get_my_events', startTime, {
        result_count: response.data.length,
        total: response.total,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/events/all
   * Get paginated events from ANALYTICS.SILVER_DIM.EVENTS (not user-scoped)
   * Query params: isPast (bool), eventId (string), projectName (string|string[]), searchQuery (string),
   *               pageSize (number), offset (number), sortOrder (ASC|DESC), sortField (string)
   */
  public async getEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_events', {
      has_query: Object.keys(req.query).length > 0,
    });

    try {
      const rawPageSize = parseInt(String(req.query['pageSize'] ?? DEFAULT_EVENTS_PAGE_SIZE), 10);
      const rawOffset = parseInt(String(req.query['offset'] ?? 0), 10);
      const rawSortOrder = String(req.query['sortOrder'] ?? 'ASC').toUpperCase() as EventSortOrder;
      const rawIsPast = req.query['isPast'];
      const eventId = req.query['eventId'] ? String(req.query['eventId']) : undefined;
      const rawProjectNames = req.query['projectName'];
      let projectNames: string[] | undefined;
      if (Array.isArray(rawProjectNames)) {
        projectNames = rawProjectNames.map(String).filter(Boolean);
      } else if (rawProjectNames) {
        projectNames = [String(rawProjectNames)];
      }
      const searchQuery = req.query['searchQuery'] ? String(req.query['searchQuery']).trim() : undefined;
      const rawStatus = req.query['status'] ? String(req.query['status']) : undefined;
      const status = rawStatus && VALID_EVENT_STATUS_VALUES.has(rawStatus) ? (rawStatus as EventStatusFilter) : undefined;
      const sortField = req.query['sortField'] ? String(req.query['sortField']) : undefined;

      const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_EVENTS_PAGE_SIZE ? rawPageSize : DEFAULT_EVENTS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const sortOrder: EventSortOrder = VALID_EVENT_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'ASC';
      let isPast: boolean | undefined;
      if (rawIsPast === 'true') {
        isPast = true;
      } else if (rawIsPast === 'false') {
        isPast = false;
      }

      const options: GetEventsOptions = {
        isPast,
        eventId,
        projectNames,
        searchQuery,
        status,
        sortField,
        pageSize,
        offset,
        sortOrder,
      };

      const response = await this.eventsService.getEvents(req, options);

      logger.success(req, 'get_events', startTime, {
        result_count: response.data.length,
        total: response.total,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/events/organizations
   * Get distinct organization names (ACCOUNT_NAME) for the authenticated user's events
   * Query params: projectName (string)
   */
  public async getEventOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_event_organizations', {
      has_query: Object.keys(req.query).length > 0,
    });

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_event_organizations',
        });
      }

      const rawIsPast = req.query['isPast'];
      let isPast: boolean | undefined;
      if (rawIsPast === 'true') {
        isPast = true;
      } else if (rawIsPast === 'false') {
        isPast = false;
      }

      // For upcoming events, fetch affiliated project slugs server-side from the persona service.
      let affiliatedProjectSlugs: string[] | undefined;
      if (isPast === false) {
        affiliatedProjectSlugs = await this.personaDetectionService.getAffiliatedProjectSlugs(req);
      }

      const options: GetEventOrganizationsOptions = {
        projectName: req.query['projectName'] ? String(req.query['projectName']) : undefined,
        isPast,
        affiliatedProjectSlugs,
      };

      const response = await this.eventsService.getEventOrganizations(req, userEmail, options);

      logger.success(req, 'get_event_organizations', startTime, {
        result_count: response.data.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/events/visa-requests
   * Get paginated visa letter requests for the authenticated user
   * Query params: eventId (string), projectName (string), searchQuery (string), status (string),
   *               sortField (string), pageSize (number), offset (number), sortOrder (ASC|DESC)
   */
  public async getVisaRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.handleEventRequestsEndpoint(req, res, next, 'get_visa_requests', (r, email, opts) => this.eventsService.getVisaRequests(r, email, opts));
  }

  /**
   * GET /api/events/travel-fund-requests
   * Get paginated travel fund requests for the authenticated user
   * Query params: eventId (string), projectName (string), searchQuery (string), status (string),
   *               sortField (string), pageSize (number), offset (number), sortOrder (ASC|DESC)
   */
  public async getTravelFundRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.handleEventRequestsEndpoint(req, res, next, 'get_travel_fund_requests', (r, email, opts) =>
      this.eventsService.getTravelFundRequests(r, email, opts)
    );
  }

  /**
   * GET /api/events/countries
   * Get distinct country names for upcoming events (for the location filter dropdown)
   */
  public async getUpcomingCountries(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_upcoming_countries', {});

    try {
      const response: GetUpcomingCountriesResponse = await this.eventsService.getUpcomingCountries(req);

      logger.success(req, 'get_upcoming_countries', startTime, { result_count: response.data.length });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/events/certificate
   * Download attendance certificate as a PDF for the authenticated user
   * Query params: eventId (string, required)
   */
  public async getCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const eventId = req.query['eventId'] ? String(req.query['eventId']) : undefined;

    const startTime = logger.startOperation(req, 'get_certificate', { event_id: eventId });

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_certificate',
        });
      }

      if (!eventId) {
        throw ServiceValidationError.forField('eventId', 'eventId query parameter is required', {
          operation: 'get_certificate',
          service: 'events_controller',
          path: req.path,
        });
      }

      const userName = getEffectiveName(req) || userEmail;

      const pdfBuffer = await this.certificateService.generateCertificate(req, {
        eventId,
        userEmail,
        userName,
      });

      logger.success(req, 'get_certificate', startTime, { event_id: eventId });

      const safeEventId = String(eventId).replace(/[^a-zA-Z0-9_-]/g, '');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="certificate-${safeEventId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/events/search-organizations
   * Search organizations by name via the API Gateway organization-service.
   * Query params: name (string, required)
   */
  public async searchOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const name = req.query['name'] ? String(req.query['name']).trim() : '';

    const startTime = logger.startOperation(req, 'search_organizations', { name });

    try {
      if (!name) {
        throw ServiceValidationError.forField('name', 'name query parameter is required', {
          operation: 'search_organizations',
          service: 'events_controller',
          path: req.path,
        });
      }

      const response: OrgSearchResponse = await this.eventsService.searchOrganizations(req, name);

      logger.success(req, 'search_organizations', startTime, { result_count: response.data.length });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/events/visa-applications
   * Submit a visa letter application
   */
  public async submitVisaRequestApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'submit_visa_request_application', {});

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'submit_visa_request_application' });
      }

      const payload = req.body as VisaRequestApplication;

      if (!payload?.eventId) {
        throw ServiceValidationError.forField('eventId', 'eventId is required', { operation: 'submit_visa_request_application' });
      }

      if (!payload?.applicantInfo) {
        throw ServiceValidationError.forField('applicantInfo', 'applicantInfo is required', { operation: 'submit_visa_request_application' });
      }

      if (!payload?.termsAccepted) {
        throw ServiceValidationError.forField('termsAccepted', 'termsAccepted must be true', { operation: 'submit_visa_request_application' });
      }

      // Overwrite client-provided email with session email for data integrity
      payload.applicantInfo.email = userEmail;

      const result = await this.eventsService.submitVisaRequestApplication(req, payload);
      logger.success(req, 'submit_visa_request_application', startTime, { event_id: payload.eventId });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/events/travel-fund-applications
   * Submit a travel fund application
   */
  public async submitTravelFundApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'submit_travel_fund_application', {});

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'submit_travel_fund_application' });
      }

      const payload = req.body as TravelFundApplication;

      if (!payload?.eventId) {
        throw ServiceValidationError.forField('eventId', 'eventId is required', { operation: 'submit_travel_fund_application' });
      }

      if (!payload?.aboutMe) {
        throw ServiceValidationError.forField('aboutMe', 'aboutMe is required', { operation: 'submit_travel_fund_application' });
      }

      if (!payload?.termsAccepted) {
        throw ServiceValidationError.forField('termsAccepted', 'termsAccepted must be true', { operation: 'submit_travel_fund_application' });
      }

      if (!payload?.expenses) {
        throw ServiceValidationError.forField('expenses', 'expenses is required', { operation: 'submit_travel_fund_application' });
      }

      // Overwrite client-provided email with session email for data integrity
      payload.aboutMe.email = userEmail;

      const result = await this.eventsService.submitTravelFundApplication(req, payload);
      logger.success(req, 'submit_travel_fund_application', startTime, { event_id: payload.eventId });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  private async handleEventRequestsEndpoint(
    req: Request,
    res: Response,
    next: NextFunction,
    operationName: string,
    fetchFn: (req: Request, userEmail: string, options: GetEventRequestsOptions) => Promise<VisaRequestsResponse | TravelFundRequestsResponse>
  ): Promise<void> {
    const startTime = logger.startOperation(req, operationName, {
      has_query: Object.keys(req.query).length > 0,
    });

    try {
      const userEmail = getEffectiveEmail(req);

      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: operationName });
      }

      const rawPageSize = parseInt(String(req.query['pageSize'] ?? DEFAULT_EVENTS_PAGE_SIZE), 10);
      const rawOffset = parseInt(String(req.query['offset'] ?? 0), 10);
      const rawSortOrder = String(req.query['sortOrder'] ?? 'DESC').toUpperCase() as EventSortOrder;

      const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_EVENTS_PAGE_SIZE ? rawPageSize : DEFAULT_EVENTS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const sortOrder: EventSortOrder = VALID_EVENT_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'DESC';

      const options: GetEventRequestsOptions = {
        eventId: req.query['eventId'] ? String(req.query['eventId']) : undefined,
        projectName: req.query['projectName'] ? String(req.query['projectName']) : undefined,
        searchQuery: req.query['searchQuery'] ? String(req.query['searchQuery']).trim() : undefined,
        status: req.query['status'] ? String(req.query['status']) : undefined,
        sortField: req.query['sortField'] ? String(req.query['sortField']) : undefined,
        pageSize,
        offset,
        sortOrder,
      };

      const response = await fetchFn(req, userEmail, options);

      logger.success(req, operationName, startTime, {
        result_count: response.data.length,
        total: response.total,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
