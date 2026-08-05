// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeServiceOrgSeat, OrgLensGroupsResponse, OrgLensGroupSummary } from '@lfx-one/shared/interfaces';
import { isBoardCategory } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { logger } from './logger.service';
import { OrgLensBoardCommitteeService } from './org-lens-board-committee.service';

/** Aggregates org seats (non-board) by committee, producing the Groups page roster. */
export class OrgLensGroupsService {
  private readonly boardCommitteeService: OrgLensBoardCommitteeService;

  public constructor() {
    this.boardCommitteeService = new OrgLensBoardCommitteeService();
  }

  public async getGroups(req: Request, orgUid: string): Promise<OrgLensGroupsResponse> {
    const seats = await this.boardCommitteeService.fetchAllOrgSeats(req, orgUid);

    // Only non-board committees belong on the Groups page (boards live on the Memberships page).
    const nonBoardSeats = seats.filter((s) => !isBoardCategory(s.committee_category));

    const committeeMap = this.aggregateByCommittee(nonBoardSeats);

    const groups: OrgLensGroupSummary[] = Array.from(committeeMap.entries()).map(([uid, groupSeats]) => this.toGroupSummary(uid, groupSeats));

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

  private aggregateByCommittee(seats: CommitteeServiceOrgSeat[]): Map<string, CommitteeServiceOrgSeat[]> {
    const map = new Map<string, CommitteeServiceOrgSeat[]>();
    for (const seat of seats) {
      const bucket = map.get(seat.committee_uid) ?? [];
      bucket.push(seat);
      map.set(seat.committee_uid, bucket);
    }
    return map;
  }

  private toGroupSummary(uid: string, seats: CommitteeServiceOrgSeat[]): OrgLensGroupSummary {
    // aggregateByCommittee only adds to the map on push, so this is always true — guard is defensive.
    if (seats.length === 0) {
      return { uid, name: uid, category: '', org_seat_count: 0 };
    }
    const first = seats[0];

    // Deduplicate by email so one person with multiple roles counts once for the seat count.
    const seenEmails = new Set<string>();
    for (const s of seats) {
      seenEmails.add(s.email);
    }

    return {
      uid,
      name: first.committee_name,
      category: first.committee_category,
      ...(first.project_uid ? { project_uid: first.project_uid } : {}),
      ...(first.project_slug ? { project_slug: first.project_slug } : {}),
      org_seat_count: seenEmails.size,
    };
  }
}
