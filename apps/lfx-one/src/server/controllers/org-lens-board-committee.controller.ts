// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';
import type { ReassignCommitteeSeatRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensBoardCommitteeService } from '../services/org-lens-board-committee.service';

/**
 * HTTP boundary for the three Board & Committee SSR endpoints (spec 016 FR-009).
 * Validation: `assertOrgUid` (SALESFORCE_ACCOUNT_ID_PATTERN, spec 002) for the org
 * account id `orgUid`, FOUNDATION_ID_PATTERN for `foundationId` (FR-009j).
 * Structured `logger.startOperation` lifecycle
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

      const response = await this.service.getBoardSeats(req, orgUid, foundationId);

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

      const response = await this.service.getCommitteeSeats(req, orgUid, foundationId);

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

  /** PATCH /api/orgs/:orgUid/lens/memberships/:foundationId/committee-seats/:seatId/reassign */
  public async reassignSeat(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const seatId = req.params['seatId'];
    const startTime = logger.startOperation(req, 'reassign_committee_seat', {
      org_uid: orgUid,
      foundation_id: foundationId,
      seat_id: seatId,
    });

    try {
      assertOrgUid(orgUid, 'reassign_committee_seat');
      this.assertFoundationId(foundationId, 'reassign_committee_seat');
      const body = this.assertReassignBody(req.body, 'reassign_committee_seat');

      const response = await this.service.reassignSeat(req, orgUid, foundationId, seatId, body);

      logger.success(req, 'reassign_committee_seat', startTime, {
        org_uid: orgUid,
        foundation_id: foundationId,
        seat_id: seatId,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private assertReassignBody(body: unknown, operation: string): ReassignCommitteeSeatRequest {
    const b = (body ?? {}) as Partial<ReassignCommitteeSeatRequest>;
    if (!b.committeeUid || !b.email || !b.firstName || !b.lastName) {
      throw ServiceValidationError.forField('body', 'committeeUid, firstName, lastName and email are required', { operation });
    }
    return { committeeUid: b.committeeUid, firstName: b.firstName, lastName: b.lastName, email: b.email };
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
