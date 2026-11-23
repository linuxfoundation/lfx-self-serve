// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_EVENTS_PAGE_SIZE,
  MAX_EVENTS_PAGE_SIZE,
  ORG_EVENTS_COMPANY_QUERY_PARAM,
  SALESFORCE_ACCOUNT_ID_PATTERN,
  VALID_ORG_EVENT_STATUS_VALUES,
} from '@lfx-one/shared/constants';
import type { GetOrgEventsOptions, OrgEventsFamilyScope } from '@lfx-one/shared/interfaces';
import { isOrgRollUpSegment } from '@lfx-one/shared/utils/org-lens-url.utils';
import type { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseOrgEventsFilters } from '../helpers/org-events-filters.helper';
import { resolveOrgLensRollUp } from '../helpers/org-lens-roll-up.helper';
import { getStringQueryParam, parseOffsetPagination } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensEventsService } from '../services/org-lens-events.service';
import { getEffectiveEmail } from '../utils/auth-helper';

/** HTTP boundary for GET /api/orgs/:accountId/lens/events. */
export class OrgLensEventsController {
  private readonly service: OrgLensEventsService;

  public constructor() {
    this.service = new OrgLensEventsService();
  }

  /** GET /api/orgs/:accountId/lens/events/summary */
  public async getOrgEventsSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_events_summary', { account_id: accountId });

    try {
      this.assertEventsTarget(accountId, 'get_org_lens_events_summary');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_events_summary' });
      }

      const filters = parseOrgEventsFilters(req, 'get_org_lens_events_summary');
      const summary = isOrgRollUpSegment(accountId)
        ? await this.service.getFamilyOrgEventsSummary(req, await this.familyScope(req, accountId, 'get_org_lens_events_summary'), filters)
        : await this.service.getOrgEventsSummary(req, accountId, filters);

      logger.success(req, 'get_org_lens_events_summary', startTime, { account_id: accountId });

      res.setHeader('Cache-Control', 'no-store');
      res.json(summary);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/events */
  public async getOrgEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_events', { account_id: accountId });

    try {
      this.assertEventsTarget(accountId, 'get_org_lens_events');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_events' });
      }

      const { pageSize, offset } = parseOffsetPagination(req, { defaultPageSize: DEFAULT_EVENTS_PAGE_SIZE, maxPageSize: MAX_EVENTS_PAGE_SIZE });
      const rawSortOrder = String(req.query['sortOrder'] ?? 'ASC').toUpperCase();
      const rawIsPast = req.query['isPast'];
      const rawStatus = getStringQueryParam(req, 'status');
      const rawSortField = getStringQueryParam(req, 'sortField') ?? 'EVENT_START_DATE';

      const sortOrder = rawSortOrder === 'DESC' ? 'DESC' : 'ASC';
      const isPast = rawIsPast === 'true';
      const status = rawStatus && VALID_ORG_EVENT_STATUS_VALUES.has(rawStatus) ? rawStatus : null;
      const sortField = rawSortField;

      const filters = parseOrgEventsFilters(req, 'get_org_lens_events');

      const options: GetOrgEventsOptions = {
        isPast,
        searchQuery: getStringQueryParam(req, 'searchQuery'),
        status,
        pageSize,
        offset,
        sortField,
        sortOrder,
        participation: filters.participation,
        eventScope: filters.scope,
        foundation: filters.foundation,
        range: filters.range,
      };

      const response = isOrgRollUpSegment(accountId)
        ? await this.service.getFamilyOrgEvents(req, await this.familyScope(req, accountId, 'get_org_lens_events'), options)
        : await this.service.getOrgEvents(req, accountId, options);

      logger.success(req, 'get_org_lens_events', startTime, {
        account_id: accountId,
        result_count: response.data.length,
        total: response.total,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/events/foundations */
  public async getOrgEventFoundations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_event_foundations', { account_id: accountId });

    try {
      this.assertEventsTarget(accountId, 'get_org_lens_event_foundations');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_event_foundations' });
      }

      const { scope } = parseOrgEventsFilters(req, 'get_org_lens_event_foundations');
      const response = isOrgRollUpSegment(accountId)
        ? await this.service.getFamilyOrgEventFoundations(req, await this.familyScope(req, accountId, 'get_org_lens_event_foundations'), { scope })
        : await this.service.getOrgEventFoundations(req, accountId, { scope });

      logger.success(req, 'get_org_lens_event_foundations', startTime, { account_id: accountId, result_count: response.data.length });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/events/:eventId/attendees */
  public async getEventAttendees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const eventId = req.params['eventId'];
    const startTime = logger.startOperation(req, 'get_event_attendees', { account_id: accountId, event_id: eventId });

    try {
      this.assertEventsTarget(accountId, 'get_event_attendees');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_event_attendees' });
      }

      if (!eventId || typeof eventId !== 'string') {
        throw ServiceValidationError.forField('eventId', 'eventId path parameter is required', { operation: 'get_event_attendees' });
      }

      const { participation } = parseOrgEventsFilters(req, 'get_event_attendees');
      const searchQuery = getStringQueryParam(req, 'searchQuery');
      const target = isOrgRollUpSegment(accountId) ? await this.rollUpDrawerAccount(req, accountId, 'get_event_attendees') : accountId;
      const response = await this.service.getEventAttendees(req, target, eventId, { participation, searchQuery });

      logger.success(req, 'get_event_attendees', startTime, { account_id: accountId, event_id: eventId, count: response.total });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/events/:eventId/speakers */
  public async getEventSpeakers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const eventId = req.params['eventId'];
    const startTime = logger.startOperation(req, 'get_event_speakers', { account_id: accountId, event_id: eventId });

    try {
      this.assertEventsTarget(accountId, 'get_event_speakers');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_event_speakers' });
      }

      if (!eventId || typeof eventId !== 'string') {
        throw ServiceValidationError.forField('eventId', 'eventId path parameter is required', { operation: 'get_event_speakers' });
      }

      const searchQuery = getStringQueryParam(req, 'searchQuery');
      const target = isOrgRollUpSegment(accountId) ? await this.rollUpDrawerAccount(req, accountId, 'get_event_speakers') : accountId;
      const response = await this.service.getEventSpeakers(req, target, eventId, searchQuery ?? undefined);

      logger.success(req, 'get_event_speakers', startTime, {
        account_id: accountId,
        event_id: eventId,
        accepted: response.acceptedCount,
        submitted: response.submittedCount,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private async familyScope(req: Request, rollUpKey: string, operation: string): Promise<OrgEventsFamilyScope> {
    const rollUp = await resolveOrgLensRollUp(req, rollUpKey, operation);
    const company = getStringQueryParam(req, ORG_EVENTS_COMPANY_QUERY_PARAM) || undefined;
    if (company && !rollUp.members.some((member) => member.accountId === company)) {
      throw ServiceValidationError.forField(ORG_EVENTS_COMPANY_QUERY_PARAM, 'company must be an organization in this roll-up', { operation });
    }
    return this.service.familyScope(rollUp, company);
  }

  private async rollUpDrawerAccount(req: Request, rollUpKey: string, operation: string): Promise<string> {
    const company = getStringQueryParam(req, ORG_EVENTS_COMPANY_QUERY_PARAM);
    if (!company) {
      throw ServiceValidationError.forField(ORG_EVENTS_COMPANY_QUERY_PARAM, 'company is required for a roll-up drawer', { operation });
    }
    await this.familyScope(req, rollUpKey, operation);
    return company;
  }

  private assertEventsTarget(accountId: string | undefined, operation: string): asserts accountId is string {
    if (!accountId || typeof accountId !== 'string') {
      throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', { operation });
    }
    if (!isOrgRollUpSegment(accountId) && !SALESFORCE_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', { operation });
    }
  }
}
