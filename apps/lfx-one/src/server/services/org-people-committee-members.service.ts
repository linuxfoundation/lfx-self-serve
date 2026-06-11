// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CommitteeMemberAssignment,
  CommitteeMemberPerson,
  CommitteeMemberStats,
  CommitteeServiceOrgSeat,
  OrgPeopleCommitteeMembersResponse,
  ReassignCommitteeMemberBody,
  ReassignCommitteeMemberResponse,
} from '@lfx-one/shared/interfaces';
import { isBoardCategory } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';
import { ProjectService } from './project.service';

/**
 * Org Lens People → Committee tab (spec 027): serves the org-wide NON-Board roster (Board excluded, FR-003)
 * and proxies single-seat reassigns, reusing the spec-026 drain/reassign with foundation enrichment (D-003).
 */
export class OrgPeopleCommitteeMembersService {
  private readonly boardCommitteeService: OrgLensBoardCommitteeService;
  private readonly projectService: ProjectService;
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
    this.projectService = new ProjectService();
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Org-wide non-Board roster (FR-001/003/004): drain → exclude Board → enrich foundation names → map → stats. */
  public async getCommitteeMembers(req: Request, orgUid: string): Promise<OrgPeopleCommitteeMembersResponse> {
    // Org-wide drain: no project filter → committee-service's organization-only scope (every
    // foundation the org holds seats on); the shared drain enforces the 200-page fail-closed cap.
    const seats = await this.boardCommitteeService.fetchAllOrgSeats(req, orgUid);
    const nonBoard = seats.filter((s) => !isBoardCategory(s.committee_category));

    const foundationNames = await this.enrichFoundationNames(req, nonBoard);
    const assignments = nonBoard.map((s) => this.toAssignment(s, foundationNames));
    const stats = this.computeStats(assignments);

    return { orgUid, assignments, stats };
  }

  /** Reassign one Membership-Entitlement seat (FR-017): proxies the spec-026 committee-service atomic reassign. */
  public async reassignSeat(req: Request, orgUid: string, seatId: string, body: ReassignCommitteeMemberBody): Promise<ReassignCommitteeMemberResponse> {
    const upstreamPath = `/committees/b2b-org/${orgUid}/seats/${seatId}/reassign`;
    logger.debug(req, 'reassign_committee_member_proxy', 'Proxying reassign to committee-service', {
      org_uid: orgUid,
      seat_id: seatId,
      committee_uid: body.committeeUid,
      upstream_path: upstreamPath,
    });
    // Verb mapping (matches spec 026 `org-lens-board-committee.service.ts`): the BFF surface is PATCH
    // (REST partial-update convention), but committee-service defines reassign as PUT — so we issue PUT
    // here deliberately. NOT a bug: committee-service implements PUT /committees/b2b-org/{uid}/seats/{member_uid}/reassign.
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

    const foundationNames = await this.enrichFoundationNames(req, [upstream]);
    const seat = this.toAssignment(upstream, foundationNames);
    logger.debug(req, 'reassign_committee_member_proxy', 'committee-service returned reassigned seat', {
      org_uid: orgUid,
      seat_id: seat.seatId,
      committee_uid: seat.committeeUid,
    });
    return { orgUid, seat };
  }

  /**
   * D-003 foundation-name enrichment: collect distinct `project_uid`s, batch-fetch projects via the
   * existing `ProjectService.getProjectsByIds` (chunks 100/req, FGA-aware), project to `Map<uid, name>`.
   * Fail-soft: on error log a warning and return an empty map (each seat falls back to its `project_slug`).
   */
  private async enrichFoundationNames(req: Request, seats: CommitteeServiceOrgSeat[]): Promise<Map<string, string>> {
    const uids = [...new Set(seats.map((s) => s.project_uid).filter((u): u is string => !!u))];
    if (uids.length === 0) {
      return new Map();
    }
    try {
      const byUid = await this.projectService.getProjectsByIds(req, uids);
      const names = new Map<string, string>();
      for (const [uid, project] of byUid) {
        if (project?.name) {
          names.set(uid, project.name);
        }
      }
      return names;
    } catch (error) {
      logger.warning(req, 'enrich_foundation_names', 'project-name enrichment failed; falling back to project_slug', {
        uid_count: uids.length,
        err: error,
      });
      return new Map();
    }
  }

  /** Map an upstream seat to the People-tab `CommitteeMemberAssignment` (camelCase + person envelope + foundation). */
  private toAssignment(s: CommitteeServiceOrgSeat, foundationNames: Map<string, string>): CommitteeMemberAssignment {
    const projectUid = s.project_uid ?? '';
    const foundationSlug = s.project_slug ?? '';
    return {
      seatId: s.uid,
      memberUid: s.uid,
      committeeUid: s.committee_uid,
      committeeName: s.committee_name,
      committeeCategory: s.committee_category,
      projectUid,
      foundationSlug,
      foundationName: foundationNames.get(projectUid) || foundationSlug,
      role: s.role_name ?? '',
      votingStatus: s.voting_status ?? '',
      appointedBy: s.appointed_by ?? '',
      isOrgEditable: s.is_org_editable,
      reason: s.reason ?? null,
      person: this.toPerson(s),
    };
  }

  private toPerson(s: CommitteeServiceOrgSeat): CommitteeMemberPerson {
    const firstName = (s.first_name ?? '').trim();
    const lastName = (s.last_name ?? '').trim();
    const email = (s.email ?? '').trim().toLowerCase();
    const name = `${firstName} ${lastName}`.trim();
    // Members added by email before their profile resolves have no name upstream — fall back to the
    // email as the display name (and derive initials from it) so the row is identifiable, not blank.
    const fullName = name || email;
    const nameInitials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    const initials =
      nameInitials ||
      email
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 2)
        .toUpperCase();
    return {
      email,
      firstName,
      lastName,
      fullName,
      jobTitle: s.job_title?.trim() ? s.job_title.trim() : null,
      initials,
    };
  }

  /** Filter-independent stats (FR-004): distinct emails / committees / foundations across the FULL roster. */
  private computeStats(assignments: CommitteeMemberAssignment[]): CommitteeMemberStats {
    const emails = new Set<string>();
    const committees = new Set<string>();
    const foundations = new Set<string>();
    for (const a of assignments) {
      if (a.person.email) emails.add(a.person.email);
      if (a.committeeUid) committees.add(a.committeeUid);
      // Count by projectUid, but fall back to the foundation slug when the UID is missing so the tile
      // never shows 0 foundations while the table still renders foundation values (un-enriched seats).
      const foundationKey = a.projectUid || a.foundationSlug;
      if (foundationKey) foundations.add(foundationKey);
    }
    return { individualCount: emails.size, committeeCount: committees.size, foundationsCovered: foundations.size };
  }
}
