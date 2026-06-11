// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Org Lens People → Board tab. Wire (BFF ↔ client) + client view-model types for the org-wide,
// Board-ONLY roster. A board seat is a committee seat whose category is Board, so the per-seat wire
// shape is reused verbatim from `org-people-committee-members.interface.ts`; only the stats shape,
// the per-person aggregation (voting counts), and the response envelope differ here.

import type { CommitteeMemberAssignment } from './org-people-committee-members.interface';
import type { CommitteeMemberAssignmentVm } from './org-people-committee-members.internal.interface';

/** Filter-independent board stat tiles, computed once at the BFF from the full (unfiltered) roster (FR-004). */
export interface BoardMemberStats {
  /** Distinct board members (lowercased emails). */
  totalBoardMembers: number;
  /** Count of board seats classified as voting (`isVotingStatus`). */
  votingCount: number;
  /** Count of board seats classified as non-voting. */
  nonVotingCount: number;
  /** Distinct `projectUid` (foundations with a board member). */
  foundationsCovered: number;
}

/** Response envelope for `GET /api/orgs/:orgUid/lens/people/board-members`. Every assignment is a Board-category seat. */
export interface OrgPeopleBoardMembersResponse {
  orgUid: string;
  /** One record per Board seat; `isBoardCategory(committeeCategory) === true` for every entry. */
  assignments: CommitteeMemberAssignment[];
  stats: BoardMemberStats;
}

/** Sortable columns on the Board table (FR-021). Voting Status is categorical — not sortable. */
export type BoardMembersSortColumn = 'name' | 'foundations';

/** Sort direction — 1 ascending, -1 descending. */
export type BoardMembersSortDirection = 1 | -1;

/** A voting-status pill rendered in the main-row Voting Status cell (single verbatim pill, or aggregate count pills). */
export interface BoardVotingPill {
  label: string;
  pillClass: string;
}

/** One person row — derived by grouping assignments by lowercased email (first-wins display fields). */
export interface BoardMemberPersonGroup {
  /** Group identity key — lowercased email, or the seat `memberUid` fallback when email is blank. */
  email: string;
  displayName: string;
  jobTitle: string | null;
  initials: string;
  /** Distinct foundation names this person holds a board seat on, sorted A→Z. */
  foundationLabels: string[];
  /** Count of this person's board seats classified as voting. */
  votingCount: number;
  /** Count of this person's board seats classified as non-voting. */
  nonVotingCount: number;
  /** Count of assignments where `isOrgEditable === true` — drives the main-row Reassign affordance. */
  editableCount: number;
  /** Raw assignments (unsorted) — consumed by the modal + the decorated sub-rows. */
  assignments: CommitteeMemberAssignment[];
}

/** Dialog input for the "Why can't I edit this member?" modal — the explanation text to render (FR-009/FR-012 affordance). */
export interface WhyCantEditBoardDialogData {
  reason: string;
}

/** A person group with sub-rows pre-sorted (foundation A→Z, then board/committee A→Z) + decorated. */
export interface BoardMemberPersonGroupVm extends BoardMemberPersonGroup {
  sortedAssignments: CommitteeMemberAssignmentVm[];
  /** Voting Status cell content: one verbatim pill for a single-seat person, else aggregate count pills. */
  votingPills: BoardVotingPill[];
  /** Precomputed tooltip/explanation for the main-row Reassign affordance ("Why can't I edit?" copy when disabled). */
  reassignTooltip: string;
}
