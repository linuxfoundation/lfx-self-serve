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

    // Two independent enrichment sources, resolved in parallel: the committee-service index
    // (per-committee, always populated for every committee the org holds a seat on) is tried
    // first, falling back to the project-service index (keyed by project_uid, but has gaps —
    // e.g. some projects are absent from that index entirely). Both fail soft to an empty map.
    const [foundationNames, committeesByUid] = await Promise.all([
      enrichFoundationNames(req, nonBoardSeats, this.projectService),
      this.getCommitteesByUid(req, committeeMap.keys()),
    ]);

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
   *  an empty map (falls through to the project-index / slug fallback in `toGroupSummary`) rather
   *  than failing the whole Groups page. */
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
    // hold a slug and no longer mean what its name says. Precedence: the committee-service index
    // (per-committee, no gaps observed) beats the project-service index (keyed by project_uid,
    // has known gaps — e.g. projects absent from that index entirely).
    const projectName = committeesByUid.get(uid)?.project_name || foundationNames.get(first.project_uid ?? '');

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
