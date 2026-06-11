// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Spec 027 — client-only view-model types for the People → Committee tab. Derived from the wire
// `CommitteeMemberAssignment[]` on render; NOT part of the BFF envelope.

import type { CommitteeMemberAssignment } from './org-people-committee-members.interface';

/** Sortable columns on the main table (FR-021). */
export type CommitteeMembersSortColumn = 'name' | 'foundations' | 'committees';

/** Sort direction — 1 ascending, -1 descending. */
export type CommitteeMembersSortDirection = 1 | -1;

/** One person row — derived by grouping assignments by lowercased email, falling back to the seat `memberUid` when email is blank (first-wins for display fields). */
export interface CommitteeMemberPersonGroup {
  /** Group identity key — the person's lowercased email, or the seat `memberUid` fallback when email is blank. Not guaranteed to be an email. */
  email: string;
  displayName: string;
  jobTitle: string | null;
  initials: string;
  /** Distinct foundation names this person holds seats on, sorted A→Z. */
  foundationLabels: string[];
  /** Count of distinct `committeeUid` across this person's assignments. */
  committeeCount: number;
  /** Count of assignments where `isOrgEditable === true` — drives the main-row Reassign pencil enable. */
  editableCount: number;
  /** Raw assignments (unsorted) — consumed by the modal + the decorated sub-rows. */
  assignments: CommitteeMemberAssignment[];
}

/** A sub-row decorated for the expanded view — pill class + foundation-rowspan flag computed once. */
export interface CommitteeMemberAssignmentVm extends CommitteeMemberAssignment {
  votingStatusPillClass: string;
  /** True only on the first sub-row of each foundation block (so the label renders once per group). */
  showFoundationLabel: boolean;
  /** Precomputed tooltip for the sub-row Edit pencil — encodes (canEdit × isOrgEditable × reason) so the template stays a flat binding (no nested ternary). */
  editTooltip: string;
}

/** A person group with its sub-rows pre-sorted (foundation A→Z, then committee A→Z) + decorated. */
export interface CommitteeMemberPersonGroupVm extends CommitteeMemberPersonGroup {
  sortedAssignments: CommitteeMemberAssignmentVm[];
  /** Precomputed tooltip for the main-row Reassign pencil — encodes (canEdit × editableCount) so the template stays a flat binding (no nested ternary). */
  reassignTooltip: string;
}
