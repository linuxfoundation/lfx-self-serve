// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';
import type { OrgLensEmployeesResponse, ReassignCommitteeSeatRequest } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
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

  /** GET /api/orgs/:orgUid/lens/memberships/:foundationId/seats — combined board + committee seats (single committee-service read, spec 026 TODO #1). */
  public async getSeats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_membership_seats', {
      org_uid: orgUid,
      foundation_id: foundationId,
    });

    try {
      assertOrgUid(orgUid, 'get_membership_seats');
      this.assertFoundationId(foundationId, 'get_membership_seats');

      const response = await this.service.getSeats(req, orgUid, foundationId);

      logger.success(req, 'get_membership_seats', startTime, {
        org_uid: orgUid,
        foundation_id: foundationId,
        board_count: response.boardSeats.length,
        committee_count: response.committeeSeats.length,
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

  /** GET /api/orgs/:orgUid/lens/employees — org-wide people picker (key contacts + committee members) for the Reassign modal. */
  public async getEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_employees', { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, 'get_org_employees');

      const employees = await this.service.getOrgEmployees(req, orgUid);

      logger.success(req, 'get_org_employees', startTime, {
        org_uid: orgUid,
        row_count: employees.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ orgUid, employees } satisfies OrgLensEmployeesResponse);
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
      this.assertSeatId(seatId, 'reassign_committee_seat');
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

  /** Validate the seat id from the URL against the filter-safe allowlist before it is interpolated into the upstream committee-service path (400, not an upstream 5xx). */
  private assertSeatId(seatId: string | undefined, operation: string): asserts seatId is string {
    if (!seatId || !isFilterSafeIdentifier(seatId)) {
      throw ServiceValidationError.forField('seatId', 'seatId path parameter is required and must be a valid identifier', { operation });
    }
  }

  private assertReassignBody(body: unknown, operation: string): ReassignCommitteeSeatRequest {
    const b = (body ?? {}) as Partial<ReassignCommitteeSeatRequest>;
    // Normalize before validating: trim everything and lowercase the email so a manual-entry casing
    // mismatch doesn't reach committee-service, and validate committeeUid against the identifier allowlist.
    const committeeUid = typeof b.committeeUid === 'string' ? b.committeeUid.trim() : '';
    const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : '';
    const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';

    if (!committeeUid || !email || !firstName || !lastName) {
      throw ServiceValidationError.forField('body', 'committeeUid, firstName, lastName and email are required', { operation });
    }
    if (!isFilterSafeIdentifier(committeeUid)) {
      throw ServiceValidationError.forField('committeeUid', 'committeeUid must be a valid identifier', { operation });
    }
    return { committeeUid, firstName, lastName, email };
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
