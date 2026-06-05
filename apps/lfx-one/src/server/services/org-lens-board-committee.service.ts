// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  BoardSeat,
  CommitteeSeat,
  CommitteeServiceOrgSeat,
  CommitteeServiceOrgSeatPage,
  KeyContactEmployee,
  OrgMembershipBoardSeatsResponse,
  OrgMembershipCommitteeSeatsResponse,
  OrgMembershipKeyContactPerson,
  OrgMembershipReassignSeatResponse,
  OrgMembershipVotingHistoryResponse,
  ReassignCommitteeSeatRequest,
} from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgLensKeyContactsService } from './org-lens-key-contacts.service';

/**
 * Board & Committee tab service (spec 026, live data). Board/committee reads proxy to committee-service
 * `GET /committees/b2b-org/{orgUid}/seats` (user token → Heimdall `b2b_org#auditor`), splitting Board
 * vs other by `committee_category` (FR-003). Voting history is deferred (D12) with no live source, so
 * it returns an empty list. No mock fixture — committee-service owns the data.
 */
export class OrgLensBoardCommitteeService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly keyContactsService: OrgLensKeyContactsService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.keyContactsService = new OrgLensKeyContactsService();
  }

  /** Board seats: live committee-service seats with `committee_category === "Board"`. */
  public async getBoardSeats(req: Request, accountId: string, foundationId: string): Promise<OrgMembershipBoardSeatsResponse> {
    const seats = await this.fetchOrgSeats(req, accountId);
    const boardSeats = seats.filter((s) => s.committee_category === 'Board').map((s) => this.toBoardSeat(s));
    return { accountId, foundationId, boardSeats };
  }

  /** Committee seats: live committee-service seats with `committee_category !== "Board"`. */
  public async getCommitteeSeats(req: Request, accountId: string, foundationId: string): Promise<OrgMembershipCommitteeSeatsResponse> {
    const seats = await this.fetchOrgSeats(req, accountId);
    const committeeSeats = seats.filter((s) => s.committee_category !== 'Board').map((s) => this.toCommitteeSeat(s));
    return { accountId, foundationId, committeeSeats };
  }

  /** Voting history is deferred (D12) with no live source — returns an empty list. */
  public getVotingHistory(accountId: string, foundationId: string): OrgMembershipVotingHistoryResponse {
    return { accountId, foundationId, votingHistory: [] };
  }

  /** Org-wide people picker for the Reassign modal (spec 026): key contacts + committee members, deduped by lowercased email; fail-soft per source. */
  public async getOrgEmployees(req: Request, orgUid: string): Promise<KeyContactEmployee[]> {
    if (!orgUid || !isFilterSafeIdentifier(orgUid)) {
      return [];
    }

    const [keyContacts, seats] = await Promise.allSettled([this.keyContactsService.getEmployees(req, orgUid), this.fetchOrgSeats(req, orgUid)]);

    // Both sources down: re-throw so the controller maps the failure and the modal shows "search
    // unavailable" — don't collapse a full outage into a misleading empty 200.
    if (keyContacts.status === 'rejected' && seats.status === 'rejected') {
      throw keyContacts.reason;
    }

    // Key contacts first so their job-title/name enrichment wins on email collisions with a seat holder.
    const byEmail = new Map<string, KeyContactEmployee>();
    if (keyContacts.status === 'fulfilled') {
      for (const emp of keyContacts.value) {
        const key = emp.email.trim().toLowerCase();
        if (key && !byEmail.has(key)) {
          byEmail.set(key, emp);
        }
      }
    } else {
      logger.info(req, 'get_org_employees', 'key-contact source failed; serving committee members only', {
        org_uid: orgUid,
        error: keyContacts.reason instanceof Error ? keyContacts.reason.message : String(keyContacts.reason),
      });
    }

    if (seats.status === 'fulfilled') {
      for (const seat of seats.value) {
        const emp = this.seatToEmployee(seat);
        if (emp.email && !byEmail.has(emp.email)) {
          byEmail.set(emp.email, emp);
        }
      }
    } else {
      logger.info(req, 'get_org_employees', 'committee-member source failed; serving key contacts only', {
        org_uid: orgUid,
        error: seats.reason instanceof Error ? seats.reason.message : String(seats.reason),
      });
    }

    return [...byEmail.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /** Reassign a Membership-Entitlement seat (FR-006/FR-007): always proxies to committee-service (user token → Heimdall `b2b_org#writer`; entitlement guard upstream). */
  public async reassignSeat(
    req: Request,
    accountId: string,
    foundationId: string,
    seatId: string,
    body: ReassignCommitteeSeatRequest
  ): Promise<OrgMembershipReassignSeatResponse> {
    const upstreamPath = `/committees/b2b-org/${accountId}/seats/${seatId}/reassign`;
    logger.debug(req, 'reassign_committee_seat_proxy', 'Proxying reassign to committee-service', {
      org_uid: accountId,
      seat_id: seatId,
      committee_uid: body.committeeUid,
      upstream_path: upstreamPath,
    });
    // Verb mapping (tech-spec §4 / Batch 5 B5.7): the BFF surface is PATCH (controller route), but the
    // committee-service upstream defines reassign as PUT — so we deliberately issue PUT here. This is NOT a
    // bug: committee-service implements PUT /committees/b2b-org/{uid}/seats/{member_uid}/reassign.
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
    const seat = upstream.committee_category === 'Board' ? this.toBoardSeat(upstream) : this.toCommitteeSeat(upstream);
    logger.debug(req, 'reassign_committee_seat_proxy', 'committee-service returned reassigned seat', {
      org_uid: accountId,
      seat_id: seat.seatId,
      committee_category: upstream.committee_category,
    });
    return { accountId, foundationId, seat };
  }

  /** Proxy the org's committee seats from committee-service (user token forwarded; Heimdall gates `b2b_org#auditor`). */
  private async fetchOrgSeats(req: Request, orgUid: string): Promise<CommitteeServiceOrgSeat[]> {
    // TODO(spec 026 — perf follow-up): getBoardSeats + getCommitteeSeats both call this same upstream
    // read, and the card fetches both on initial load, so a page load triggers TWO identical
    // committee-service reads. Optimize via a single combined `GET .../seats` BFF endpoint (fetch once,
    // split board vs committee in the client) or request-scoped coalescing. Deferred while the tab is
    // WIP — the three-endpoint contract (FR-009) is kept for now.
    // TODO(spec 026 T014): resolve the project family (ProjectService.getFoundationProjectUids) and pass
    // project_uids so committee-service scopes seats to the foundation root + descendants; currently
    // org-only scope (committee-service filters by organization_id + any project_uids it receives).
    const upstreamPath = `/committees/b2b-org/${orgUid}/seats`;
    logger.debug(req, 'get_org_committee_seats_proxy', 'Proxying org committee seats read to committee-service', {
      org_uid: orgUid,
      upstream_path: upstreamPath,
    });

    // committee-service returns a paginated page { seats, page_token } (LFXV2-1865). The grouped view and
    // CSV export need the org's FULL roster, so drain every page by following the opaque cursor. The cap
    // is a safety stop against a pathological cursor loop (max 200 pages × 500 = 100k seats).
    const maxPages = 200;
    const seats: CommitteeServiceOrgSeat[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const params: Record<string, string> = { v: '1', page_size: '500' };
      if (pageToken) {
        params['page_token'] = pageToken;
      }
      const page = await this.microserviceProxy.proxyRequest<CommitteeServiceOrgSeatPage>(req, 'LFX_V2_COMMITTEE_SERVICE', upstreamPath, 'GET', params);
      if (page?.seats?.length) {
        seats.push(...page.seats);
      }
      pageToken = page?.page_token ?? undefined;
      pages += 1;
    } while (pageToken && pages < maxPages);

    logger.debug(req, 'get_org_committee_seats_proxy', 'committee-service returned org committee seats', {
      org_uid: orgUid,
      seat_count: seats.length,
      pages,
    });
    return seats;
  }

  // Upstream exposes a single identifier per row (`uid`, the committee_member uid). For live seats the
  // seat, the reassignment subject, and the person-in-seat are the *same* committee_member record, so
  // `seatId`, `memberUid`, and `person.personId` intentionally collapse to `uid`. The three fields are
  // kept distinct only because BoardSeat/CommitteeSeat/person reuse the spec 015/016 shape (where a
  // person is a separate key_contact); committee-service has no distinct seat/person id to map.
  private toBoardSeat(s: CommitteeServiceOrgSeat): BoardSeat {
    return {
      seatId: s.uid,
      memberUid: s.uid,
      committeeUid: s.committee_uid,
      person: this.toPerson(s),
      seatName: s.committee_name,
      tagLabel: s.voting_status,
      committeeCategory: s.committee_category,
      votingStatus: s.voting_status,
      appointedBy: s.appointed_by,
      isOrgEditable: s.is_org_editable,
      reason: s.reason ?? null,
    };
  }

  private toCommitteeSeat(s: CommitteeServiceOrgSeat): CommitteeSeat {
    return {
      seatId: s.uid,
      memberUid: s.uid,
      committeeUid: s.committee_uid,
      person: this.toPerson(s),
      committeeName: s.committee_name,
      role: s.role_name,
      committeeCategory: s.committee_category,
      votingStatus: s.voting_status,
      appointedBy: s.appointed_by,
      isOrgEditable: s.is_org_editable,
      reason: s.reason ?? null,
    };
  }

  private toPerson(s: CommitteeServiceOrgSeat): OrgMembershipKeyContactPerson {
    const fullName = `${s.first_name} ${s.last_name}`.trim();
    const initials = `${s.first_name.charAt(0)}${s.last_name.charAt(0)}`.toUpperCase();
    return {
      personId: s.uid,
      firstName: s.first_name,
      lastName: s.last_name,
      fullName,
      email: s.email,
      jobTitle: s.job_title ?? null,
      initials,
    };
  }

  // Maps a committee-service seat to the shared employee-picker shape. Email is lowercased so it
  // dedupes case-insensitively against the key-contact source (whose identity is also lowercased email).
  private seatToEmployee(s: CommitteeServiceOrgSeat): KeyContactEmployee {
    const firstName = (s.first_name ?? '').trim();
    const lastName = (s.last_name ?? '').trim();
    return {
      email: (s.email ?? '').trim().toLowerCase(),
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      jobTitle: s.job_title?.trim() ? s.job_title.trim() : null,
      initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
    };
  }
}
