// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isBoardCategory, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  BoardSeat,
  CommitteeSeat,
  CommitteeServiceOrgSeat,
  CommitteeServiceOrgSeatPage,
  KeyContactEmployee,
  OrgMembershipKeyContactPerson,
  OrgMembershipReassignSeatResponse,
  OrgMembershipSeatsResponse,
  OrgMembershipVotingHistoryResponse,
  ReassignCommitteeSeatRequest,
} from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgLensKeyContactsService } from './org-lens-key-contacts.service';
import { OrgLensMembershipsService } from './org-lens-memberships.service';
import { ProjectService } from './project.service';
import { withPerUserCache } from './valkey.service';

/**
 * Picker roster bound (FR-006 typeahead): cap the org-wide seat drain so opening the Reassign modal
 * doesn't pull the full cross-foundation roster (up to the 200-page × 500 = 100k safety cap) just to
 * feed a client-filtered typeahead. Key contacts are always included in full; committee members beyond
 * this bound are omitted from the suggestions (manual entry still works).
 */
const PICKER_MAX_SEAT_PAGES = 4;

/** Board & Committee tab service (spec 026, live data): proxies live committee-service seats (user token → Heimdall `b2b_org#auditor`), splits Board vs other by `committee_category` (FR-003); voting history deferred (D12, empty list); no mock fixture — committee-service owns the data. */
export class OrgLensBoardCommitteeService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly keyContactsService: OrgLensKeyContactsService;
  private readonly projectService: ProjectService;
  private readonly membershipsService: OrgLensMembershipsService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.keyContactsService = new OrgLensKeyContactsService();
    this.projectService = new ProjectService();
    this.membershipsService = new OrgLensMembershipsService();
  }

  /** Combined board + committee seats (spec 026, single-read perf follow-up): resolves the foundation family + drains committee-service once, splits Board vs committee by `committee_category` (FR-003); empty lists when the family can't resolve (never the org-wide roster). */
  public async getSeats(req: Request, accountId: string, foundationId: string): Promise<OrgMembershipSeatsResponse> {
    const projectUids = await this.resolveFamilyProjectUids(req, accountId, foundationId);
    if (!projectUids?.length) {
      return { accountId, foundationId, boardSeats: [], committeeSeats: [] };
    }
    const seats = await this.fetchOrgSeats(req, accountId, { projectUids });
    const boardSeats = seats.filter((s) => isBoardCategory(s.committee_category)).map((s) => this.toBoardSeat(s));
    const committeeSeats = seats.filter((s) => !isBoardCategory(s.committee_category)).map((s) => this.toCommitteeSeat(s));
    return { accountId, foundationId, boardSeats, committeeSeats };
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

    // Picker path: bound the org-wide seat drain (typeahead degrades to a best-effort list rather than
    // pulling the full cross-foundation roster on every modal open). Key contacts are still fetched in full.
    const [keyContacts, seats] = await Promise.allSettled([
      this.keyContactsService.getEmployees(req, orgUid),
      this.fetchOrgSeats(req, orgUid, { maxPages: PICKER_MAX_SEAT_PAGES, allowTruncation: true }),
    ]);

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
        err: keyContacts.reason,
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
        err: seats.reason,
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
    const seat = isBoardCategory(upstream.committee_category) ? this.toBoardSeat(upstream) : this.toCommitteeSeat(upstream);
    logger.debug(req, 'reassign_committee_seat_proxy', 'committee-service returned reassigned seat', {
      org_uid: accountId,
      seat_id: seat.seatId,
      committee_category: upstream.committee_category,
    });
    return { accountId, foundationId, seat };
  }

  /** Org-wide seat drain (no project filter) for the People Committee/Board tabs and the directory picker, cached per caller + org so the single full-roster drain is shared across consumers; only the full, non-truncated drain is cached here — the bounded picker and project-scoped `getSeats` paths bypass this cache so a truncated/differently-scoped result is never served as the full roster. */
  public async fetchAllOrgSeats(req: Request, orgUid: string): Promise<CommitteeServiceOrgSeat[]> {
    const username = getEffectiveUsername(req) ?? '';
    return withPerUserCache(
      VALKEY_CACHE.ORG_SEATS_NAMESPACE,
      username,
      orgUid,
      VALKEY_CACHE.ORG_LENS_PERUSER_TTL_SECONDS,
      () => this.fetchOrgSeats(req, orgUid),
      isOrgSeatArray
    );
  }

  /** Resolve the membership's project family (foundation root + descendants) for seat scoping (spec 026 T007a): SFID → slug (getFoundationSlug) → uid (getProjectIdBySlug) → family (getFoundationProjectUids); `undefined` when unresolvable so callers return an EMPTY list, never the org-wide roster. */
  private async resolveFamilyProjectUids(req: Request, orgUid: string, foundationId: string): Promise<string[] | undefined> {
    try {
      const slug = await this.membershipsService.getFoundationSlug(orgUid, foundationId);
      if (!slug) {
        return undefined;
      }
      const { exists, uid } = await this.projectService.getProjectIdBySlug(req, slug);
      if (!exists || !uid) {
        return undefined;
      }
      const family = await this.projectService.getFoundationProjectUids(req, uid);
      return family.length ? family : undefined;
    } catch (error) {
      // Deliberate fail-soft (spec 026 decision): a resolution error degrades to an empty board (200),
      // NOT a retryable 5xx — same outcome as "no match", so a project-metadata blip never leaks the
      // org-wide roster nor 500s the tab. Trade-off: a transient outage shows an empty board.
      logger.warning(req, 'get_org_committee_seats_proxy', 'project-family resolution failed; returning empty seat list', {
        org_uid: orgUid,
        foundation_id: foundationId,
        err: error,
      });
      return undefined;
    }
  }

  /**
   * Proxy the org's committee seats from committee-service (user token forwarded; Heimdall gates `b2b_org#auditor`).
   * The board/committee tabs always pass a resolved `projectUids` family (root + descendants, spec 026 T014) and
   * drain every page (fail-closed on the safety cap so a truncated roster never ships). The org-wide call (no
   * `projectUids`) is used by the Reassign people picker (`getOrgEmployees`), and — spec 027 — by the public
   * `fetchAllOrgSeats` wrapper for the org-wide People → Committee tab read.
   */
  private async fetchOrgSeats(
    req: Request,
    orgUid: string,
    options: { projectUids?: string[]; maxPages?: number; allowTruncation?: boolean } = {}
  ): Promise<CommitteeServiceOrgSeat[]> {
    const { projectUids, maxPages = 200, allowTruncation = false } = options;
    const upstreamPath = `/committees/b2b-org/${orgUid}/seats`;
    logger.debug(req, 'get_org_committee_seats_proxy', 'Proxying org committee seats read to committee-service', {
      org_uid: orgUid,
      upstream_path: upstreamPath,
      project_uids_count: projectUids?.length ?? 0,
      max_pages: maxPages,
    });

    // committee-service returns a paginated page { seats, page_token } (LFXV2-1865). The grouped view and CSV
    // export need the org's FULL (foundation-scoped) roster, so they drain every page by following the opaque
    // cursor up to `maxPages` (default 200 × 500 = 100k safety stop against a pathological cursor loop). The
    // picker passes a much smaller bound and tolerates truncation (see below).
    const seats: CommitteeServiceOrgSeat[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      // ApiClientService serializes array params as repeated keys (project_uids=a&project_uids=b), which
      // the committee-service read contract accepts (filters organization_id + project_uid ∈ {family}).
      const params: Record<string, string | string[]> = { v: '1', page_size: '500' };
      if (projectUids?.length) {
        params['project_uids'] = projectUids;
      }
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

    // Cursor still advancing at the page bound. The picker (`allowTruncation`) accepts a bounded best-effort
    // list — it's a typeahead and key contacts are loaded in full — so we stop and return what we have. Every
    // other caller fails closed: returning a TRUNCATED roster would silently corrupt grouping + the CSV export.
    if (pageToken) {
      if (allowTruncation) {
        logger.debug(req, 'get_org_committee_seats_proxy', 'org seat fetch hit its page bound; returning a bounded best-effort roster (picker typeahead)', {
          org_uid: orgUid,
          max_pages: maxPages,
          seat_count: seats.length,
        });
      } else {
        logger.warning(req, 'get_org_committee_seats_proxy', 'org committee seats pagination exceeded the page cap; refusing to return a truncated roster', {
          org_uid: orgUid,
          max_pages: maxPages,
          seat_count: seats.length,
        });
        throw new Error(`org committee seats pagination exceeded the ${maxPages}-page safety cap for org ${orgUid}`);
      }
    }

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
    const firstName = s.first_name ?? '';
    const lastName = s.last_name ?? '';
    const email = s.email ?? '';
    const name = `${firstName} ${lastName}`.trim();
    // Members added by email before their profile resolves have no name upstream — fall back to the email
    // as the display name (and derive initials from it) so the row is identifiable instead of blank.
    const fullName = name || email;
    const nameInitials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    const initials =
      nameInitials ||
      email
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 2)
        .toUpperCase();
    return {
      personId: s.uid,
      firstName,
      lastName,
      fullName,
      email,
      jobTitle: s.job_title ?? null,
      initials,
    };
  }

  // Maps a committee-service seat to the shared employee-picker shape. Email is lowercased so it
  // dedupes case-insensitively against the key-contact source (whose identity is also lowercased email).
  private seatToEmployee(s: CommitteeServiceOrgSeat): KeyContactEmployee {
    const firstName = (s.first_name ?? '').trim();
    const lastName = (s.last_name ?? '').trim();
    const email = (s.email ?? '').trim().toLowerCase();
    const name = `${firstName} ${lastName}`.trim();
    const nameInitials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    // Email-only members (no name upstream yet) would otherwise render as blank suggestion rows in the
    // picker — fall back to the email as the display name and derive initials from it (mirrors toPerson).
    return {
      email,
      firstName,
      lastName,
      fullName: name || email,
      jobTitle: s.job_title?.trim() ? s.job_title.trim() : null,
      initials:
        nameInitials ||
        email
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 2)
          .toUpperCase(),
    };
  }
}

/** Rejects a corrupt/legacy seat entry whose elements aren't non-null objects (degrades to a miss before seat fields are read). */
function isOrgSeatArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => el !== null && typeof el === 'object' && !Array.isArray(el));
}
