// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensBoardCommitteeService } from '../services/org-lens-board-committee.service';

/**
 * HTTP boundary for the three Board & Committee SSR endpoints (spec 016 FR-009).
 * Validation: UUID_REGEX for `orgUid` (uuid-only refactor), FOUNDATION_ID_PATTERN
 * for `foundationId` (FR-009j). Structured `logger.startOperation` lifecycle
 * logging per the existing org-lens convention. `Cache-Control: no-store` on
 * every response. (Board & Committee data is currently a mock fixture keyed by the
 * org identifier echoed in the response envelope.)
 */
export class OrgLensBoardCommitteeController {
  private readonly service: OrgLensBoardCommitteeService;

  public constructor() {
    this.service = new OrgLensBoardCommitteeService();
  }

  /** GET /api/orgs/:orgUid/lens/memberships/:foundationId/board-seats */
  public async getBoardSeats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_board_seats', {
      org_uid: orgUid,
      foundation_id: foundationId,
    });

    try {
      assertOrgUid(orgUid, 'get_board_seats');
      this.assertFoundationId(foundationId, 'get_board_seats');

      const response = this.service.getBoardSeats(orgUid, foundationId);

      logger.success(req, 'get_board_seats', startTime, {
        org_uid: orgUid,
        foundation_id: foundationId,
        row_count: response.boardSeats.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/memberships/:foundationId/committee-seats */
  public async getCommitteeSeats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_committee_seats', {
      org_uid: orgUid,
      foundation_id: foundationId,
    });

    try {
      assertOrgUid(orgUid, 'get_committee_seats');
      this.assertFoundationId(foundationId, 'get_committee_seats');

      const response = this.service.getCommitteeSeats(orgUid, foundationId);

      logger.success(req, 'get_committee_seats', startTime, {
        org_uid: orgUid,
        foundation_id: foundationId,
        row_count: response.committeeSeats.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/memberships/:foundationId/voting-history */
  public async getVotingHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_voting_history', {
      org_uid: orgUid,
      foundation_id: foundationId,
    });

    try {
      assertOrgUid(orgUid, 'get_voting_history');
      this.assertFoundationId(foundationId, 'get_voting_history');

      const response = this.service.getVotingHistory(orgUid, foundationId);

      logger.success(req, 'get_voting_history', startTime, {
        org_uid: orgUid,
        foundation_id: foundationId,
        row_count: response.votingHistory.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private assertFoundationId(foundationId: string | undefined, operation: string): asserts foundationId is string {
    if (!foundationId || typeof foundationId !== 'string') {
      throw ServiceValidationError.forField('foundationId', 'foundationId path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(foundationId)) {
      throw ServiceValidationError.forField('foundationId', 'Invalid foundationId format', { operation });
    }
  }
}
