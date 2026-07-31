// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { parseCommitteeActivityQuery } from '../helpers/committee-activity-query.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { CommitteeActivityService } from '../services/committee-activity.service';
import { logger } from '../services/logger.service';

/**
 * HTTP boundary for `GET /api/committees/:uid/activity` (LFXV2-1707).
 *
 * No explicit access-check call, unlike `CommitteeEngagementController` — every leg this endpoint
 * aggregates (past meetings, votes, surveys, documents) already goes through the same
 * FGA-enforced `MicroserviceProxyService.proxyRequest` the four source endpoints being merged use
 * on their own, forwarding `req.bearerToken` on every call. `committee-engagement` bypasses that
 * proxy to hit Snowflake directly, which is why it needs its own `assertCommitteeRead` gate; this
 * endpoint bypasses nothing, so the permission check is identical to the four reads it aggregates.
 */
export class CommitteeActivityController {
  private readonly service: CommitteeActivityService;

  public constructor() {
    this.service = new CommitteeActivityService();
  }

  public async getActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_committee_activity';
    const committeeUid = req.params['uid'];
    const startTime = logger.startOperation(req, operation, { committee_uid: committeeUid });
    try {
      if (!validateUidParameter(committeeUid, req, next, { operation, service: 'committee_activity_controller' })) {
        return;
      }
      const query = parseCommitteeActivityQuery(req, operation);

      const response = await this.service.getCommitteeActivity(req, committeeUid, query);

      logger.success(req, operation, startTime, { committee_uid: committeeUid, returned: response.data.length, has_more: !!response.page_token });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
