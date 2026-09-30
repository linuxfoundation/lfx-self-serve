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

/** Bounds the project uids listed in one `org_lens_groups_enrich` line, so an outage (every project missing) can't bloat it. */
const MAX_LOGGED_MISSING_PROJECT_UIDS = 50;

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
   *
   * Because every such caller receives the same entry, it carries only foundation names every
   * caller may read: `project_name` is set only for projects confirmed public at fill time (see
   * `resolveGroups`). A group under a private foundation, or one whose visibility could not be
   * confirmed, shows its slug to everyone, including callers who could read the name.
   */
  public async getGroups(req: Request, orgUid: string, qualification: OrgLensReadQualification): Promise<OrgLensGroupsResponse> {
    const startedAt = Date.now();
    const cacheKey = qualification === 'org-grant' ? buildOrgGroupsCacheKey(orgUid) : null;

    // Auditor-entitled caller (no grant resolved on this org), or an org uid too unsafe to key on:
    // resolve directly and store nothing. `resolveGroups` applies the same public-only naming rule
    // here, so one caller never sees different names depending on how their access was resolved.
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

    // Foundation names: this aggregate is shared by every org-grant caller of the org, but both name
    // sources below read under the token of whichever caller fills it. A private project's name must
    // not reach callers without `viewer` on that project, so `project_name` is set only for projects
    // confirmed public at fill time (`publicUids`: every caller holds `viewer` on them).
    // `freshVisibility` makes that confirmation come from this fill's own lookups — the project
    // index, then a capped direct project read for projects the index did not return — never from
    // the per-pod public-name cache, whose entries can be up to 5 min old. A project that is private,
    // or whose visibility could not be confirmed, gets no name from either source and falls back to
    // its slug in the UI.
    //
    // Two sources, for public projects only: project-service (the index, or the direct read; live,
    // keyed by project_uid) is primary — the committee-service index only fills the names it misses.
    // committee_service.ProjectName is a write-time snapshot resolved once at committee create/update
    // with no rename subscriber, so it goes stale on a project rename — it must stay secondary, not
    // primary. Both sources fail soft to an empty map. Resolved sequentially (not in parallel): the
    // committee-index fan-out only targets committees of public projects project-service left
    // unnamed, so on the common path the second upstream call is skipped entirely rather than firing
    // — and discarding its result — on every single request.
    const {
      names: foundationNames,
      publicUids,
      privateUids,
      confirmedByDirectRead,
    } = await enrichFoundationNames(req, nonBoardSeats, this.projectService, { freshVisibility: true });
    const committeeProjectUids = Array.from(committeeMap.entries()).map(([uid, groupSeats]) => [uid, groupSeats[0]?.project_uid ?? ''] as const);
    const unresolvedCommitteeUids = committeeProjectUids
      .filter(([, projectUid]) => publicUids.has(projectUid) && !foundationNames.get(projectUid))
      .map(([uid]) => uid);
    const committeesByUid = await this.getCommitteesByUid(req, unresolvedCommitteeUids);

    // Committees left without a name, by why: the project is private; its visibility is unknown (the
    // project index did not return it and no direct read confirmed it); or the seat carries no project.
    let withheldPrivate = 0;
    let missingFromProjectIndex = 0;
    let noProjectUid = 0;
    const missingProjectUids = new Set<string>();
    for (const [, projectUid] of committeeProjectUids) {
      if (!projectUid) {
        noProjectUid++;
      } else if (privateUids.has(projectUid)) {
        withheldPrivate++;
      } else if (!publicUids.has(projectUid)) {
        missingFromProjectIndex++;
        missingProjectUids.add(projectUid);
      }
    }

    // Only worth an INFO line when something was left unnamed or withheld — per
    // .claude/rules/logging-patterns.md's worked example, which gates its enrichment INFO log the same
    // way, rather than firing one on every single request regardless of whether anything happened.
    // `confirmed_by_direct_read` counts projects; the other counts are committees. Project uids are
    // not personal data; they are listed so a missing project can be checked in the index.
    if (unresolvedCommitteeUids.length > 0 || withheldPrivate > 0 || missingFromProjectIndex > 0 || noProjectUid > 0) {
      const resolvedFromCommitteeIndex = unresolvedCommitteeUids.filter((uid) => committeesByUid.get(uid)?.project_name).length;
      logger.info(req, 'org_lens_groups_enrich', 'Enriched groups with project/committee names', {
        total_committees: committeeMap.size,
        gaps_from_project_index: unresolvedCommitteeUids.length,
        resolved_from_committee_index: resolvedFromCommitteeIndex,
        unresolved_after_both_sources: unresolvedCommitteeUids.length - resolvedFromCommitteeIndex,
        withheld_private: withheldPrivate,
        missing_from_project_index: missingFromProjectIndex,
        missing_from_project_index_uids: Array.from(missingProjectUids).slice(0, MAX_LOGGED_MISSING_PROJECT_UIDS),
        no_project_uid: noProjectUid,
        confirmed_by_direct_read: confirmedByDirectRead,
      });
    }

    const groups: OrgLensGroupSummary[] = Array.from(committeeMap.entries()).map(([uid, groupSeats]) =>
      this.toGroupSummary(uid, groupSeats, foundationNames, publicUids, committeesByUid)
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
    publicUids: Set<string>,
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
    // hold a slug and no longer mean what its name says. Only a project confirmed public at fill time
    // is named: this summary is stored in the org-shared aggregate, and either source may hold a
    // private project's name read under the filling caller's token. Precedence: project-service
    // (index or direct read; live) beats the committee-service index (a write-time snapshot that goes
    // stale on rename — see the comment in resolveGroups) — the committee index only fills its gaps.
    // A seat with no project_uid stays unnamed even when the committee index carries a project_name:
    // with no project there is no visibility to confirm, so that snapshot name could be a private one.
    const projectUid = first.project_uid ?? '';
    const projectName = publicUids.has(projectUid) ? foundationNames.get(projectUid) || committeesByUid.get(uid)?.project_name : undefined;

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
