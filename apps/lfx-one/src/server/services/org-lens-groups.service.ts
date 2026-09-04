// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee, CommitteeServiceOrgSeat, OrgLensGroupsResponse, OrgLensGroupSummary } from '@lfx-one/shared/interfaces';
import { isBoardCategory, VALKEY_CACHE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import type { OrgLensReadQualification } from '../helpers/org-lens-read-access.helper';
import { enrichFoundationNames } from './committee-seat-assignment.mapper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';
import { ProjectService } from './project.service';
import { buildOrgGroupsCacheKey, withOrgGroupsCache } from './valkey.service';

/** Where a served Groups response came from — reported per request so the cold-load rate per org is measurable. */
type GroupsResultSource = 'fresh' | 'reused' | 'coalesced' | 'uncached';

/** Aggregates org seats (non-board) by committee, producing the Groups page roster. */
export class OrgLensGroupsService {
  /**
   * In-flight coalescing, keyed by the fully-built cache key rather than the org uid so two
   * differently-scoped resolutions could never collide. `withCache` is a plain read → fetch → write
   * with no dedup of its own, so without this every concurrent cold request runs its own full
   * ~34-second upstream drain. Same shape as `OrgMembershipResolverService`'s.
   *
   * Scope: **one process**. The deployment runs multiple non-sticky replicas, so a simultaneous
   * cold burst can still cost one drain per replica before any of them writes the shared entry —
   * the bound is the replica count, not one. Making it exactly one would need a distributed lease,
   * which is not worth the moving parts for a page loaded this rarely; the per-request
   * `result_source` signal is likewise per-process.
   */
  private static readonly groupsInFlight = new Map<string, Promise<OrgLensGroupsResponse>>();

  private readonly boardCommitteeService: OrgLensBoardCommitteeService;
  private readonly projectService: ProjectService;
  private readonly committeeService: CommitteeService;

  public constructor() {
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
    this.projectService = new ProjectService();
    this.committeeService = new CommitteeService();
  }

  /**
   * The Groups page roster, shared across callers for `ORG_LENS_GROUPS_TTL_SECONDS`.
   *
   * What is stored is this aggregate, not the seat roster underneath it. The roster exceeds
   * `MAX_VALUE_BYTES` for larger orgs, so its writes are refused for size and it is never actually
   * retained; the aggregate stays comfortably under the ceiling. Storing the smaller value is what
   * makes this page cacheable at all.
   *
   * `qualification` comes from `assertOrgLensRead`, which the controller runs *before* this call.
   * Only a caller with a grant resolved on this org is served the shared entry.
   */
  public async getGroups(req: Request, orgUid: string, qualification: OrgLensReadQualification): Promise<OrgLensGroupsResponse> {
    const startedAt = Date.now();
    const cacheKey = qualification === 'org-grant' ? buildOrgGroupsCacheKey(orgUid) : null;

    // Staff-only caller, or an org uid too unsafe to key on: resolve directly and store nothing.
    if (cacheKey === null) {
      const response = await this.resolveGroups(req, orgUid);
      this.logGroupsRequest(req, orgUid, response, startedAt, 'uncached');
      return response;
    }

    const inFlight = OrgLensGroupsService.groupsInFlight.get(cacheKey);
    if (inFlight) {
      const response = await inFlight;
      this.logGroupsRequest(req, orgUid, response, startedAt, 'coalesced');
      return response;
    }

    // Set by the fetcher, so it distinguishes a stored entry from one this request produced.
    let resolvedFresh = false;
    const pending = withOrgGroupsCache(
      orgUid,
      VALKEY_CACHE.ORG_LENS_GROUPS_TTL_SECONDS,
      () => {
        resolvedFresh = true;
        // A capped drain throws rather than returning a partial roster, so a rejected fetcher
        // writes nothing — the aggregate is only ever stored for a complete roster. That matters
        // more here than it did per-request: a truncated aggregate written once would be served
        // for the full window, with `total_groups`, `total_seats` and both filters quietly wrong.
        return this.resolveGroups(req, orgUid);
      },
      OrgLensGroupsService.isGroupsResponse
    );
    OrgLensGroupsService.groupsInFlight.set(cacheKey, pending);

    try {
      const response = await pending;
      this.logGroupsRequest(req, orgUid, response, startedAt, resolvedFresh ? 'fresh' : 'reused');
      return response;
    } finally {
      // Cleared in `finally` so a rejected drain can't poison every later request for this org.
      OrgLensGroupsService.groupsInFlight.delete(cacheKey);
    }
  }

  /**
   * Accepts a stored entry only if it still matches the current shape; a failing value is treated as
   * a miss rather than surfacing as a 500. `project_uid`, `project_slug` and `project_name` are
   * spread conditionally by `toGroupSummary`, so they must be optional here — requiring them would
   * turn every legitimate entry into a miss.
   */
  private static isGroupsResponse(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<OrgLensGroupsResponse>;
    if (typeof candidate.total_groups !== 'number' || typeof candidate.total_seats !== 'number') return false;
    if (!Array.isArray(candidate.groups)) return false;
    return candidate.groups.every((group) => {
      if (typeof group !== 'object' || group === null) return false;
      const g = group as Partial<OrgLensGroupSummary>;
      return typeof g.uid === 'string' && typeof g.name === 'string' && typeof g.category === 'string' && typeof g.org_seat_count === 'number';
    });
  }

  private logGroupsRequest(req: Request, orgUid: string, response: OrgLensGroupsResponse, startedAt: number, source: GroupsResultSource): void {
    logger.info(req, 'org_lens_groups_request', 'Served org groups', {
      org_uid: orgUid,
      total_groups: response.total_groups,
      total_seats: response.total_seats,
      duration_ms: Date.now() - startedAt,
      result_source: source,
    });
  }

  private async resolveGroups(req: Request, orgUid: string): Promise<OrgLensGroupsResponse> {
    // Uncached drain deliberately: this aggregate is retained far longer than the per-caller seats
    // window, so reading through that window would let a just-reassigned seat be baked into the
    // stored aggregate for the full retention period — defeating the discard-on-write above.
    const seats = await this.boardCommitteeService.fetchAllOrgSeatsUncached(req, orgUid);

    // Only non-board committees belong on the Groups page (boards live on the Memberships page).
    const nonBoardSeats = seats.filter((s) => !isBoardCategory(s.committee_category));

    const committeeMap = this.aggregateByCommittee(nonBoardSeats);

    // Two independent enrichment sources: the project-service index (live, keyed by project_uid)
    // is primary — the committee-service index only fills the gaps it misses (e.g. a project
    // entirely absent from the project index). committee_service.ProjectName is a write-time
    // snapshot resolved once at committee create/update with no rename subscriber, so it goes
    // stale on a project rename — it must stay secondary, not primary. Both sources fail soft to
    // an empty map. Resolved sequentially (not in parallel): the committee-index fan-out only
    // targets committees the project index actually missed, so on the common path where the
    // project index resolves everything, the second upstream call is skipped entirely rather than
    // firing — and discarding its result — on every single request.
    const foundationNames = await enrichFoundationNames(req, nonBoardSeats, this.projectService);
    const unresolvedCommitteeUids = Array.from(committeeMap.entries())
      .filter(([, groupSeats]) => !foundationNames.get(groupSeats[0]?.project_uid ?? ''))
      .map(([uid]) => uid);
    const committeesByUid = await this.getCommitteesByUid(req, unresolvedCommitteeUids);

    // Only worth an INFO line when the committee-index gap-filler actually had gaps to fill —
    // per .claude/rules/logging-patterns.md's worked example, which gates its enrichment INFO log
    // the same way, rather than firing one on every single request regardless of whether anything
    // happened.
    if (unresolvedCommitteeUids.length > 0) {
      const resolvedFromCommitteeIndex = unresolvedCommitteeUids.filter((uid) => committeesByUid.get(uid)?.project_name).length;
      logger.info(req, 'org_lens_groups_enrich', 'Enriched groups with project/committee names', {
        total_committees: committeeMap.size,
        gaps_from_project_index: unresolvedCommitteeUids.length,
        resolved_from_committee_index: resolvedFromCommitteeIndex,
        unresolved_after_both_sources: unresolvedCommitteeUids.length - resolvedFromCommitteeIndex,
      });
    }

    const groups: OrgLensGroupSummary[] = Array.from(committeeMap.entries()).map(([uid, groupSeats]) =>
      this.toGroupSummary(uid, groupSeats, foundationNames, committeesByUid)
    );

    // Primary sort: most org members first; secondary: alphabetical by name.
    groups.sort((a, b) => b.org_seat_count - a.org_seat_count || a.name.localeCompare(b.name));

    logger.debug(req, 'org_lens_groups_aggregate', 'Aggregated org groups', {
      total_seats: nonBoardSeats.length,
      total_groups: groups.length,
    });

    return {
      groups,
      total_groups: groups.length,
      total_seats: nonBoardSeats.length,
    };
  }

  /** Fail-soft wrapper around `CommitteeService.getCommitteesByIds` — a lookup failure degrades to
   *  an empty map, so the group keeps whatever the (primary) project index already resolved, or
   *  falls back to the slug in `toGroupSummary`, rather than failing the whole Groups page. */
  private async getCommitteesByUid(req: Request, committeeUids: Iterable<string>): Promise<Map<string, Committee>> {
    try {
      return await this.committeeService.getCommitteesByIds(req, Array.from(committeeUids));
    } catch (error) {
      logger.warning(req, 'org_lens_groups_committee_enrichment', 'Committee-index enrichment failed; falling back to project index / slug', {
        err: error,
      });
      return new Map();
    }
  }

  private aggregateByCommittee(seats: CommitteeServiceOrgSeat[]): Map<string, CommitteeServiceOrgSeat[]> {
    const map = new Map<string, CommitteeServiceOrgSeat[]>();
    for (const seat of seats) {
      const bucket = map.get(seat.committee_uid) ?? [];
      bucket.push(seat);
      map.set(seat.committee_uid, bucket);
    }
    return map;
  }

  private toGroupSummary(
    uid: string,
    seats: CommitteeServiceOrgSeat[],
    foundationNames: Map<string, string>,
    committeesByUid: Map<string, Committee>
  ): OrgLensGroupSummary {
    // aggregateByCommittee only adds to the map on push, so this is always true — guard is defensive.
    if (seats.length === 0) {
      return { uid, name: 'Unknown group', category: '', org_seat_count: 0 };
    }
    const first = seats[0];

    // Deduplicate by email so one person with multiple roles counts once for the seat count.
    const seenEmails = new Set<string>();
    for (const s of seats) {
      seenEmails.add((s.email ?? '').trim().toLowerCase());
    }

    // Only set project_name when enrichment actually resolved one — the slug fallback belongs to
    // the view model (OrgLensGroupVm.projectLabel), not this field, or project_name would silently
    // hold a slug and no longer mean what its name says. Precedence: the project-service index
    // (live) beats the committee-service index (a write-time snapshot that goes stale on rename —
    // see the comment in getGroups) — the committee index only fills gaps the project index misses.
    const projectName = foundationNames.get(first.project_uid ?? '') || committeesByUid.get(uid)?.project_name;

    return {
      uid,
      name: first.committee_name,
      category: first.committee_category,
      ...(first.project_uid ? { project_uid: first.project_uid } : {}),
      ...(first.project_slug ? { project_slug: first.project_slug } : {}),
      ...(projectName ? { project_name: projectName } : {}),
      org_seat_count: seenEmails.size,
    };
  }
}
