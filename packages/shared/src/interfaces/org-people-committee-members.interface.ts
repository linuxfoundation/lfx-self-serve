// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Spec 027 — Org Lens People → Committee tab. Wire (BFF ↔ client) types for the org-wide,
// non-Board committee-member roster, plus the bulk Reassign and single Edit modal contracts.
// The seat data is read live from committee-service (spec 026 endpoints, reused) and re-shaped
// into a People-tab-friendly envelope by the BFF.

/** The seat holder, mirroring the spec-024 key-contact person shape so the table + modals reuse the same UI primitives. */
export interface CommitteeMemberPerson {
  /** Canonical identity — lowercased email; the per-person grouping key. */
  email: string;
  firstName: string;
  lastName: string;
  /** `"${firstName} ${lastName}".trim()` with a fallback to the email when both names are blank. */
  fullName: string;
  jobTitle: string | null;
  initials: string;
  avatarUrl?: string | null;
}

/** One committee seat held by one person on one (non-Board) committee in one foundation. */
export interface CommitteeMemberAssignment {
  /** = the upstream committee_member uid; identical to `memberUid` (kept distinct only for spec-026 parity). */
  seatId: string;
  /** The reassignment subject (== `seatId`). */
  memberUid: string;
  /** The seat's committee — required for the reassign body. */
  committeeUid: string;
  committeeName: string;
  /** Guaranteed NOT to equal "Board" (case-insensitive) — the BFF excludes Board seats from this tab. */
  committeeCategory: string;
  /** Foundation (project) identity — the filter-dropdown key. May be empty for un-tagged members. */
  projectUid: string;
  /** Foundation slug (= upstream project_slug). Display fallback when the name can't be enriched. */
  foundationSlug: string;
  /** Human-readable foundation name — BFF-enriched; falls back to `foundationSlug`. */
  foundationName: string;
  role: string;
  /** Voting status string (e.g. "Voting Rep", "Non-voting"); empty when none. */
  votingStatus: string;
  appointedBy: string;
  /** Endpoint-computed: `appointed_by ≡ "Membership Entitlement"`. The client never re-derives this. */
  isOrgEditable: boolean;
  /** Why the seat is not org-editable (null when editable). */
  reason: string | null;
  person: CommitteeMemberPerson;
}

/** Filter-independent stat tiles, computed once at the BFF from the full (unfiltered) roster. */
export interface CommitteeMemberStats {
  /** Distinct lowercased emails. */
  individualCount: number;
  /** Distinct `committeeUid`. */
  committeeCount: number;
  /** Distinct `projectUid` (foundations with committee members). */
  foundationsCovered: number;
}

/** Response envelope for `GET /api/orgs/:orgUid/lens/people/committee-members`. */
export interface OrgPeopleCommitteeMembersResponse {
  orgUid: string;
  assignments: CommitteeMemberAssignment[];
  stats: CommitteeMemberStats;
}

/** Body for `PATCH /api/orgs/:orgUid/lens/people/committee-members/:seatId/reassign` (one per seat). */
export interface ReassignCommitteeMemberBody {
  /** Identifies the seat's committee (the upstream PUT requires it in the body). */
  committeeUid: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Response from the single-seat reassign proxy — the freshly-created seat (role/voting/appointment preserved). */
export interface ReassignCommitteeMemberResponse {
  orgUid: string;
  seat: CommitteeMemberAssignment;
}

// ============================================================
// Bulk "Reassign Committee Roles" modal contracts (one person, N entitlement seats)
// ============================================================

/** Stable per-role checkbox key — `${memberUid}` (1:1 with seatId). */
export type ReassignCommitteeRolesRoleKey = string;

/** One checkbox row in the bulk modal — represents the person's hold on one Membership-Entitlement seat. */
export interface ReassignCommitteeRolesRoleOption {
  key: ReassignCommitteeRolesRoleKey;
  memberUid: string;
  committeeUid: string;
  committeeName: string;
  foundationName: string;
  votingStatus: string;
  /** Tailwind pill classes for the voting-status badge. */
  votingStatusPillClass: string;
}

/** Avatar/name/email summary for the orange "current member" card in the modal header. */
export interface ReassignCommitteeRolesPersonRef {
  fullName: string;
  email: string;
  initials: string;
  avatarUrl?: string | null;
}

/** Dialog input — the person being replaced, their entitlement-seat catalog, the org uid, and a pessimistic submit callback. */
export interface ReassignCommitteeRolesDialogData {
  person: ReassignCommitteeRolesPersonRef;
  /** All Membership-Entitlement seats for the person; pre-selected by default. */
  roles: ReassignCommitteeRolesRoleOption[];
  orgUid: string;
  /** Performs the fan-out write; resolves on all-success, rejects with Error(message) on partial/total failure. */
  submit: (intent: ReassignCommitteeRolesSubmitEvent) => Promise<void>;
}

/** Modal → parent submit payload. The parent fans out one PUT per selected role. */
export interface ReassignCommitteeRolesSubmitEvent {
  newPerson: { email: string; firstName: string; lastName: string };
  /** The user's final checkbox state (≥ 1 role). */
  selected: ReassignCommitteeRolesRoleOption[];
}

/** Cancel → null; on save the parent already drove the write through `submit`. */
export type ReassignCommitteeRolesDialogResult = null;

// ============================================================
// Single "Edit Committee Role" modal contracts (one seat)
// ============================================================

/** Dialog input — the one seat being edited, the org uid, and a pessimistic submit callback. */
export interface EditCommitteeRoleDialogData {
  assignment: CommitteeMemberAssignment;
  orgUid: string;
  submit: (intent: EditCommitteeRoleSubmitEvent) => Promise<void>;
}

/** Modal → parent submit payload for the single-seat reassign. */
export interface EditCommitteeRoleSubmitEvent {
  memberUid: string;
  committeeUid: string;
  newPerson: { email: string; firstName: string; lastName: string };
}

/** Cancel → null; on save the parent already drove the write through `submit`. */
export type EditCommitteeRoleDialogResult = null;
