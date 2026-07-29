// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertCommitteeRead } from '../helpers/committee-read-access.helper';
import { parseCommitteeEngagementWindow } from '../helpers/committee-engagement-window.helper';
import { logger } from '../services/logger.service';
import { CommitteeEngagementService } from '../services/committee-engagement.service';

/**
 * HTTP boundary for `GET /api/committees/:uid/engagement` (LFXV2-1705).
 *
 * Validates the path/query params, then verifies the caller's grant on the committee *before*
 * touching Snowflake — `:uid` is the analytics filter, not the authorization. Order matters: cheap,
 * no-I/O validation (param presence, window format) runs before the one upstream access-check call,
 * so a malformed request never spends a round trip it was always going to reject.
 */
export class CommitteeEngagementController {
  private readonly service: CommitteeEngagementService;

  public constructor() {
    this.service = new CommitteeEngagementService();
  }

  public async getEngagement(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_committee_engagement';
    const committeeUid = req.params['uid'];
    const startTime = logger.startOperation(req, operation, { committee_uid: committeeUid });
    try {
      if (!committeeUid) {
        throw ServiceValidationError.forField('uid', 'Committee uid path parameter is required', { operation });
      }
      const window = parseCommitteeEngagementWindow(req.query['window'], operation);
      await assertCommitteeRead(req, committeeUid, operation);

      const response = await this.service.getCommitteeEngagement(req, committeeUid, window);
      logger.success(req, operation, startTime, { committee_uid: committeeUid, window, member_count: response.members.length });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
