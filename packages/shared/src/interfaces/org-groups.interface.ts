// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GroupBehavioralClass } from './committee.interface';

/** One working group / committee the org participates in (non-board committees only). */
export interface OrgLensGroupSummary {
  uid: string;
  name: string;
  /** Raw category string from the committee-service (e.g. "Working Group", "Special Interest Group"). */
  category: string;
  project_uid?: string;
  project_slug?: string;
  /** Distinct org employees holding seats in this committee (deduped by email). */
  org_seat_count: number;
}

/** Response envelope for `GET /api/orgs/:orgUid/lens/groups`. */
export interface OrgLensGroupsResponse {
  groups: OrgLensGroupSummary[];
  total_groups: number;
  /** Total seat rows (not deduped — one person in two committees = 2 seats). */
  total_seats: number;
}

/** View-model used by the org-groups list — extends the API summary with the pre-computed behavioral class. */
export interface OrgLensGroupVm extends OrgLensGroupSummary {
  cls: GroupBehavioralClass;
}
