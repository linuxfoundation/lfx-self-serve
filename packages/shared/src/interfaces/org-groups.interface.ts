// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** A single member representing the org in a working group / committee. */
export interface OrgLensGroupRepresentative {
  name: string;
  role: string;
}

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
  /** Up to 3 representatives — used for an avatar/name preview row in the UI. */
  representative_members: OrgLensGroupRepresentative[];
}

/** Response envelope for `GET /api/orgs/:orgUid/lens/groups`. */
export interface OrgLensGroupsResponse {
  groups: OrgLensGroupSummary[];
  total_groups: number;
  /** Total seat rows (not deduped — one person in two committees = 2 seats). */
  total_seats: number;
}
