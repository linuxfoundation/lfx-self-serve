// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_EVENTS_PAGE_SIZE, MAX_EVENTS_PAGE_SIZE, SALESFORCE_ACCOUNT_ID_PATTERN, VALID_ORG_EVENT_STATUS_VALUES } from '@lfx-one/shared/constants';
import type { GetOrgEventsOptions } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
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
      this.assertAccountId(accountId, 'get_org_lens_events_summary');

      if (!getEffectiveEmail(req)) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_events_summary' });
      }

      const summary = await this.service.getOrgEventsSummary(req, accountId);

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
      this.assertAccountId(accountId, 'get_org_lens_events');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_events' });
      }

      const rawPageSize = Number(req.query['pageSize'] ?? DEFAULT_EVENTS_PAGE_SIZE);
      const rawOffset = Number(req.query['offset'] ?? 0);
      const rawSortOrder = String(req.query['sortOrder'] ?? 'ASC').toUpperCase();
      const rawIsPast = req.query['isPast'];
      const rawStatus = getStringQueryParam(req, 'status');

      const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_EVENTS_PAGE_SIZE ? rawPageSize : DEFAULT_EVENTS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const sortOrder = rawSortOrder === 'DESC' ? 'DESC' : 'ASC';
      const isPast = rawIsPast === 'true';
      const status = rawStatus && VALID_ORG_EVENT_STATUS_VALUES.has(rawStatus) ? rawStatus : null;

      const options: GetOrgEventsOptions = {
        isPast,
        searchQuery: getStringQueryParam(req, 'searchQuery'),
        status,
        pageSize,
        offset,
        sortOrder,
      };

      const response = await this.service.getOrgEvents(req, accountId, userEmail, options);

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

  private assertAccountId(accountId: string | undefined, operation: string): asserts accountId is string {
    if (!accountId || typeof accountId !== 'string') {
      throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', { operation });
    }
    if (!SALESFORCE_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', { operation });
    }
  }
}
