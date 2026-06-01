// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Canonical member-service role strings — 9 values. */
export type OrgKeyContactRole =
  | 'Billing Contact'
  | 'Marketing Contact'
  | 'Technical Contact'
  | 'Representative/Voting Contact'
  | 'Authorized Signatory'
  | 'Event Sponsorship Contact'
  | 'Legal Contact'
  | 'PR Contact'
  | 'PO Contact';

/** One row per real key_contact record on an active membership (PKC-3 — not cartesian). */
export interface OrgKeyContactAssignment {
  contactUid: string;
  membershipUid: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  title: string | null;
  // Wire-level: any string upstream may send. Narrow to OrgKeyContactRole via isCanonicalOrgKeyContactRole before indexing role-keyed maps.
  role: string;
  foundationSlug: string;
  foundationName: string | null;
  canEdit: boolean;
}

/** Account-level stat strip (FR-004 — filter-independent). */
export interface OrgKeyContactsStats {
  individualCount: number;
  foundationsCovered: number;
  unfilledRequiredRoleCount: number;
}

/** Bundled GET response for `/api/orgs/:orgUid/lens/people/key-contacts`. */
export interface OrgKeyContactsResponse {
  assignments: OrgKeyContactAssignment[];
  stats: OrgKeyContactsStats;
}

// ============================================================
// Client-only view types (NOT on the wire)
// ============================================================

export type OrgKeyContactSortColumn = 'name' | 'roles' | 'foundations';
export type OrgKeyContactSortDirection = 1 | -1;

export interface OrgKeyContactDropdownOption {
  label: string;
  value: string;
}

/** Person-grouped main-row view model (derived client-side from `assignments`). */
export interface OrgKeyContactPersonGroup {
  email: string;
  displayName: string;
  title: string | null;
  roles: string[];
  foundationCount: number;
  assignments: OrgKeyContactAssignment[];
  canEditAny: boolean;
}

/** Pre-decorated assignment for the expanded sub-table — pillClass + foundation rowspan flags computed once. */
export interface OrgKeyContactAssignmentVm extends OrgKeyContactAssignment {
  pillClass: string;
  showFoundationLabel: boolean;
  foundationLabel: string;
}

/** Pre-decorated role pill for the main-row roles cell — role + Tailwind pill class computed once. */
export interface OrgKeyContactRolePillVm {
  role: string;
  pillClass: string;
}

/** Pre-decorated person group — main-row VM with role pills and sorted decorated assignments ready for the template. */
export interface OrgKeyContactPersonGroupVm extends OrgKeyContactPersonGroup {
  rolePills: OrgKeyContactRolePillVm[];
  sortedAssignments: OrgKeyContactAssignmentVm[];
}
