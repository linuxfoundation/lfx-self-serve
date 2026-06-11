// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  BoardMemberStats,
  CommitteeMemberAssignment,
  CommitteeServiceOrgSeat,
  OrgPeopleBoardMembersResponse,
  ReassignCommitteeMemberBody,
  ReassignCommitteeMemberResponse,
} from '@lfx-one/shared/interfaces';
import { isBoardCategory, isVotingStatus } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { enrichFoundationNames, toAssignment } from './committee-seat-assignment.mapper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';
import { ProjectService } from './project.service';

/** Org Lens People → Board tab: org-wide Board-ONLY roster (the inverse of the Committee tab) + single-seat reassign, reusing the shared committee-service drain + seat-mapper. */
export class OrgPeopleBoardMembersService {
  private readonly boardCommitteeService: OrgLensBoardCommitteeService;
  private readonly projectService: ProjectService;
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
    this.projectService = new ProjectService();
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Org-wide Board roster (FR-001/003/004): drain → KEEP Board → enrich foundation names → map → board stats. */
  public async getBoardMembers(req: Request, orgUid: string): Promise<OrgPeopleBoardMembersResponse> {
    // Org-wide drain: no project filter → committee-service's organization-only scope (every
    // foundation the org holds seats on); the shared drain enforces the 200-page fail-closed cap.
    const seats = await this.boardCommitteeService.fetchAllOrgSeats(req, orgUid);
    // KEEP only Board-category seats — the exact inverse of the Committee tab's `!isBoardCategory`.
    const board = seats.filter((s) => isBoardCategory(s.committee_category));

    const foundationNames = await enrichFoundationNames(req, board, this.projectService);
    const assignments = board.map((s) => toAssignment(s, foundationNames));
    const stats = this.computeStats(assignments);

    return { orgUid, assignments, stats };
  }

  /** Reassign one Membership-Entitlement board seat: proxies the committee-service atomic reassign. */
  public async reassignSeat(req: Request, orgUid: string, seatId: string, body: ReassignCommitteeMemberBody): Promise<ReassignCommitteeMemberResponse> {
    const upstreamPath = `/committees/b2b-org/${orgUid}/seats/${seatId}/reassign`;
    logger.debug(req, 'reassign_board_member_proxy', 'Proxying reassign to committee-service', {
      org_uid: orgUid,
      seat_id: seatId,
      committee_uid: body.committeeUid,
      upstream_path: upstreamPath,
    });
    // Verb mapping (matches `org-people-committee-members.service.ts`): the BFF surface is
    // PATCH (REST partial-update convention), but committee-service defines reassign as PUT — so we issue
    // PUT here deliberately. NOT a bug: committee-service implements PUT /committees/b2b-org/{uid}/seats/{member_uid}/reassign.
    const upstream = await this.microserviceProxy.proxyRequest<CommitteeServiceOrgSeat>(
      req,
      'LFX_V2_COMMITTEE_SERVICE',
      upstreamPath,
      'PUT',
      { v: '1' },
      {
        committee_uid: body.committeeUid,
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email,
      }
    );

    const foundationNames = await enrichFoundationNames(req, [upstream], this.projectService);
    const seat = toAssignment(upstream, foundationNames);
    logger.debug(req, 'reassign_board_member_proxy', 'committee-service returned reassigned seat', {
      org_uid: orgUid,
      seat_id: seat.seatId,
      committee_uid: seat.committeeUid,
    });
    return { orgUid, seat };
  }

  /** Filter-independent board stats (FR-004): distinct members / voting seats / non-voting seats / distinct foundations. */
  private computeStats(assignments: CommitteeMemberAssignment[]): BoardMemberStats {
    const memberKeys = new Set<string>();
    const foundations = new Set<string>();
    let votingCount = 0;
    let nonVotingCount = 0;
    for (const a of assignments) {
      // Match the table's grouping key so an email-less seat still counts as one distinct member.
      memberKeys.add(a.person.email || a.memberUid);
      // Count by projectUid, falling back to the foundation slug when the UID is missing so the tile
      // never shows 0 foundations while the table still renders foundation values (un-enriched seats).
      const foundationKey = a.projectUid || a.foundationSlug;
      if (foundationKey) foundations.add(foundationKey);
      if (isVotingStatus(a.votingStatus)) votingCount += 1;
      else nonVotingCount += 1;
    }
    return { totalBoardMembers: memberKeys.size, votingCount, nonVotingCount, foundationsCovered: foundations.size };
  }
}
