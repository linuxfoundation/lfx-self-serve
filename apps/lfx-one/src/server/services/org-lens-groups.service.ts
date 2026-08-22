// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee, CommitteeServiceOrgSeat, OrgLensGroupsResponse, OrgLensGroupSummary } from '@lfx-one/shared/interfaces';
import { isBoardCategory } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { enrichFoundationNames } from './committee-seat-assignment.mapper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';
import { ProjectService } from './project.service';

/** Aggregates org seats (non-board) by committee, producing the Groups page roster. */
export class OrgLensGroupsService {
  private readonly boardCommitteeService: OrgLensBoardCommitteeService;
  private readonly projectService: ProjectService;
  private readonly committeeService: CommitteeService;

  public constructor() {
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
    this.projectService = new ProjectService();
    this.committeeService = new CommitteeService();
  }

  public async getGroups(req: Request, orgUid: string): Promise<OrgLensGroupsResponse> {
    const seats = await this.boardCommitteeService.fetchAllOrgSeats(req, orgUid);

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
    // matches meeting.service.ts's enrich_committees precedent of gating enrichment INFO logs
    // rather than firing one on every single request regardless of whether anything happened.
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
