// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN, SALESFORCE_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgLensBoardCommitteeService } from '../services/org-lens-board-committee.service';

/**
 * HTTP boundary for the three Board & Committee SSR endpoints (spec 016 FR-009).
 * Validation: SALESFORCE_ACCOUNT_ID_PATTERN for `accountId`, FOUNDATION_ID_PATTERN
 * for `foundationId` (FR-009j). Structured `logger.startOperation` lifecycle
 * logging per the existing org-lens convention. `Cache-Control: no-store` on
 * every response.
 */
export class OrgLensBoardCommitteeController {
  private readonly service: OrgLensBoardCommitteeService;

  public constructor() {
    this.service = new OrgLensBoardCommitteeService();
  }

  /** GET /api/orgs/:accountId/lens/memberships/:foundationId/board-seats */
  public async getBoardSeats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_board_seats', {
      account_id: accountId,
      foundation_id: foundationId,
    });

    try {
      this.assertAccountId(accountId, 'get_board_seats');
      this.assertFoundationId(foundationId, 'get_board_seats');

      const response = this.service.getBoardSeats(accountId, foundationId);

      logger.success(req, 'get_board_seats', startTime, {
        account_id: accountId,
        foundation_id: foundationId,
        row_count: response.boardSeats.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/memberships/:foundationId/committee-seats */
  public async getCommitteeSeats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_committee_seats', {
      account_id: accountId,
      foundation_id: foundationId,
    });

    try {
      this.assertAccountId(accountId, 'get_committee_seats');
      this.assertFoundationId(foundationId, 'get_committee_seats');

      const response = this.service.getCommitteeSeats(accountId, foundationId);

      logger.success(req, 'get_committee_seats', startTime, {
        account_id: accountId,
        foundation_id: foundationId,
        row_count: response.committeeSeats.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/memberships/:foundationId/voting-history */
  public async getVotingHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_voting_history', {
      account_id: accountId,
      foundation_id: foundationId,
    });

    try {
      this.assertAccountId(accountId, 'get_voting_history');
      this.assertFoundationId(foundationId, 'get_voting_history');

      const response = this.service.getVotingHistory(accountId, foundationId);

      logger.success(req, 'get_voting_history', startTime, {
        account_id: accountId,
        foundation_id: foundationId,
        row_count: response.votingHistory.length,
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

  private assertFoundationId(foundationId: string | undefined, operation: string): asserts foundationId is string {
    if (!foundationId || typeof foundationId !== 'string') {
      throw ServiceValidationError.forField('foundationId', 'foundationId path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(foundationId)) {
      throw ServiceValidationError.forField('foundationId', 'Invalid foundationId format', { operation });
    }
  }
}
