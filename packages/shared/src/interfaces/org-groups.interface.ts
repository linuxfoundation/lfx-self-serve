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
  /** Human-readable foundation/project name resolved from the project index (keyed by
   *  project_uid) or, failing that, the committee index (keyed by committee uid) — absent when
   *  neither resolves one; consumers should fall back to project_slug (see OrgLensGroupVm.projectLabel). */
  project_name?: string;
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

/** View-model used by the org-groups list — extends the API summary with pre-computed display fields. */
export interface OrgLensGroupVm extends OrgLensGroupSummary {
  cls: GroupBehavioralClass;
  /** Pre-computed `project_name || project_slug` display label — empty string when neither is set. */
  projectLabel: string;
  /** Pre-computed row `aria-label`: name, behavioral class, seat count, and projectLabel when set. */
  ariaLabel: string;
  /** Pre-computed accessible name for the foundation link (only rendered when project_slug is
   *  set) — distinguishes it from the row's own aria-label so screen-reader users can tell the
   *  two link targets apart. Empty string when projectLabel is empty. */
  projectAriaLabel: string;
}

/** One non-zero behavioral-class tile rendered in the org-groups stat strip. */
export interface OrgLensGroupClassTile {
  cls: GroupBehavioralClass;
  count: number;
}
