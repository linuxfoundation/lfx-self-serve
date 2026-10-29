// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgMembershipKeyContactType } from './org-memberships.interface';
import type { OrgCompanyEmailsStatus } from './org-people.interface';

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
  avatarUrl?: string | null;
  /**
   * LFID username, the drawer's only address-lookup key; never resolve the person from `email`.
   * Null means "not available from this view", not "no company address".
   */
  username?: string | null;
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

/**
 * Outcome of narrowing the org-wide assignments to one person. Follows `OrgCompanyEmailsStatus`, and for
 * the same reason: an empty list only means "none on record" when the lookup actually established who the
 * person is and could check every assignment.
 *
 * `resolved`: the person was identified and every assignment was checked, so an empty list is a verified
 * "holds no roles". `unidentified`: no usable identity, or only a partial one that matched nothing — the
 * assignments upstream records without a username could not be ruled in or out. `failed`: the identity
 * lookup errored, so the answer is retryable rather than a fact about the person. A missing status must be
 * treated as `failed`, never as `resolved`.
 */
export type OrgPersonKeyContactsStatus = 'resolved' | 'unidentified' | 'failed';

/**
 * Per-person GET response for `/api/orgs/:orgUid/lens/people/:personKey/key-contacts` and its
 * `by-username` twin — the org-wide assignments narrowed to one person. No stats: the stat strip is an
 * account-level figure that means nothing on a single person.
 */
export interface OrgPersonKeyContactsResponse {
  assignments: OrgKeyContactAssignment[];
  status: OrgPersonKeyContactsStatus;
}

/** The identity a per-person narrowing runs on. The address status is carried, not just the addresses,
 *  because "matched nothing" means different things depending on whether the addresses were trustworthy. */
export interface OrgPersonKeyContactsIdentity {
  username?: string | null;
  emails?: readonly string[];
  emailsStatus: OrgCompanyEmailsStatus;
}

/**
 * Internal roles-fetch result for `PersonDetailDrawerService`, mirroring `OrgDrawerDetailResult`: the
 * wire response plus whether the read itself failed, which is a different state from an identified person
 * with no roles.
 */
export interface OrgDrawerKeyContactsResult extends OrgPersonKeyContactsResponse {
  error: boolean;
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
  /** Two-letter initials from the structured first/last name, falling back to the first two alphanumerics of the display name; '' when none are usable so the avatar shows its icon fallback. */
  initials: string;
  title: string | null;
  roles: string[];
  foundationCount: number;
  assignments: OrgKeyContactAssignment[];
  avatarUrl: string | null;
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

// LFXV2-2067 — reassign-modal contracts.

/** Stable identifier used by the modal's checkbox state map. `${membershipUid}:${contactType}`. */
export type ReassignKeyContactRolesRoleKey = string;

/** One checkbox row in the Reassign Key Contact Roles modal — represents the current person's
 *  hold on a (membership, role-TYPE). The contactUid is the existing key_contact UID that gets
 *  PUT-replaced when the user confirms. */
export interface ReassignKeyContactRolesRoleOption {
  key: ReassignKeyContactRolesRoleKey;
  contactUid: string;
  contactType: OrgMembershipKeyContactType;
  /** Display role name (e.g. "Marketing Contact"). */
  role: string;
  /** Tailwind pill classes for the role badge — reused from the parent table's helper. */
  pillClass: string;
  foundationSlug: string;
  foundationName: string;
}

/** Avatar/name/email summary for the orange "current contact" card in the modal header. */
export interface ReassignKeyContactRolesPersonRef {
  fullName: string;
  email: string;
  initials: string;
  /** LF username used by the drawer for address lookup. Null when upstream records none. */
  username?: string | null;
}

/** Dialog input — the parent supplies the person being replaced, the role catalog (one row per
 *  current assignment), the org uuid for the employee-search corpus, and a pessimistic submit
 *  callback that performs the fan-out write and resolves only when the affected rows are saved. */
export interface ReassignKeyContactRolesDialogData {
  person: ReassignKeyContactRolesPersonRef;
  roles: ReassignKeyContactRolesRoleOption[];
  orgUid: string;
  submit: (intent: ReassignKeyContactRolesSubmitEvent) => Promise<void>;
}

/** Modal → parent submit payload. The parent fans out N PUTs (one per selected role) using the
 *  slug-keyed write proxy and resolves the Promise on all-success; partial failure rejects with
 *  Error(message) so the modal stays open with an inline error. */
export interface ReassignKeyContactRolesSubmitEvent {
  newPerson: {
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
  };
  selected: ReassignKeyContactRolesRoleOption[];
}

/** Dialog returns null on cancel; on save the parent already drove the write through `submit`,
 *  so the resolved value carries no payload. */
export type ReassignKeyContactRolesDialogResult = null;
