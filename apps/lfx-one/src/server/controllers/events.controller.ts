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
import { EventSortOrder, EventStatusFilter, GetEventOrganizationsOptions, GetEventsOptions } from '@lfx-one/shared/interfaces';
import { EventsService } from '../services/events.service';

export class EventsController {
  private readonly eventsService = new EventsService();
  private readonly certificateService = new CertificateService();

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
      const userEmail = (req.oidc?.user?.['email'] as string)?.toLowerCase();

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

      const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_EVENTS_PAGE_SIZE ? rawPageSize : DEFAULT_EVENTS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const sortOrder: EventSortOrder = VALID_EVENT_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'ASC';
      let isPast: boolean | undefined;
      if (rawIsPast === 'true') {
        isPast = true;
      } else if (rawIsPast === 'false') {
        isPast = false;
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
      const userEmail = (req.oidc?.user?.['email'] as string)?.toLowerCase();

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

      const options: GetEventOrganizationsOptions = {
        projectName: req.query['projectName'] ? String(req.query['projectName']) : undefined,
        isPast,
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
   * GET /api/events/certificate
   * Download attendance certificate as a PDF for the authenticated user
   * Query params: eventId (string, required)
   */
  public async getCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const eventId = req.query['eventId'] ? String(req.query['eventId']) : undefined;

    const startTime = logger.startOperation(req, 'get_certificate', { event_id: eventId });

    try {
      const userEmail = (req.oidc?.user?.['email'] as string)?.toLowerCase();

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

      const userName = (req.oidc?.user?.['name'] as string) || userEmail;

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
}
