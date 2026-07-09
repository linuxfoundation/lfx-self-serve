// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_MEETINGS_PAGE_SIZE, MAX_MEETINGS_PAGE_SIZE, SALESFORCE_ACCOUNT_ID_PATTERN, VALID_ORG_MEETING_TYPE_VALUES } from '@lfx-one/shared/constants';
import type { GetOrgUpcomingMeetingsOptions, OrgMeetingType } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensMeetingsService } from '../services/org-lens-meetings.service';
import { getEffectiveEmail } from '../utils/auth-helper';

/** HTTP boundary for the org-lens meetings endpoints (summary, list, projects). */
export class OrgLensMeetingsController {
  private readonly service: OrgLensMeetingsService;

  public constructor() {
    this.service = new OrgLensMeetingsService();
  }

  public async getOrgMeetingsSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_meetings_summary', { account_id: accountId });

    try {
      this.assertAccountId(accountId, 'get_org_lens_meetings_summary');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_meetings_summary' });
      }

      const summary = await this.service.getOrgMeetingsSummary(req, accountId);

      logger.success(req, 'get_org_lens_meetings_summary', startTime, { account_id: accountId });

      res.setHeader('Cache-Control', 'no-store');
      res.json(summary);
    } catch (error) {
      next(error);
    }
  }

  public async getOrgUpcomingMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_meetings', { account_id: accountId });

    try {
      this.assertAccountId(accountId, 'get_org_lens_meetings');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_meetings' });
      }

      const rawPageSize = Math.trunc(Number(req.query['pageSize'] ?? DEFAULT_MEETINGS_PAGE_SIZE));
      const rawOffset = Math.trunc(Number(req.query['offset'] ?? 0));
      const rawType = getStringQueryParam(req, 'type');

      const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_MEETINGS_PAGE_SIZE ? rawPageSize : DEFAULT_MEETINGS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const type = rawType && VALID_ORG_MEETING_TYPE_VALUES.has(rawType as OrgMeetingType) ? (rawType as OrgMeetingType) : null;

      const options: GetOrgUpcomingMeetingsOptions = {
        searchQuery: getStringQueryParam(req, 'searchQuery') ?? null,
        project: getStringQueryParam(req, 'project') ?? null,
        type,
        pendingRsvpOnly: getStringQueryParam(req, 'pendingRsvpOnly') === 'true',
        pageSize,
        offset,
      };

      const response = await this.service.getOrgUpcomingMeetings(req, accountId, options);

      logger.success(req, 'get_org_lens_meetings', startTime, {
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

  public async getMeetingProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_meeting_projects', { account_id: accountId });

    try {
      this.assertAccountId(accountId, 'get_org_lens_meeting_projects');

      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_lens_meeting_projects' });
      }

      const response = await this.service.getOrgMeetingProjects(req, accountId);

      logger.success(req, 'get_org_lens_meeting_projects', startTime, { account_id: accountId, result_count: response.projects.length });

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
