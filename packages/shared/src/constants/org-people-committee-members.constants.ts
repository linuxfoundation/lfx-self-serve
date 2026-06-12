// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeMembersSortColumn, OrgPeopleCommitteeMembersResponse } from '../interfaces';

/** committee-service `committee_category` value that the People → Committee tab EXCLUDES (FR-003). Compared case-insensitively. */
export const COMMITTEE_CATEGORY_BOARD = 'Board';

/** True when a seat's committee_category is the Board category (case-insensitive, whitespace-trimmed). */
export function isBoardCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === COMMITTEE_CATEGORY_BOARD.toLowerCase();
}

/** Default sort column for the People → Committee table (FR-021). */
export const ORG_PEOPLE_COMMITTEE_MEMBERS_DEFAULT_SORT_COLUMN: CommitteeMembersSortColumn = 'name';

/** Main-row Reassign pencil tooltip — writer can edit, but the person holds no org-reassignable seats. */
export const REASSIGN_TOOLTIP_NO_EDITABLE_SEATS = 'No org-reassignable seats for this person';
/** Main-row Reassign pencil tooltip — writer can edit and the person has ≥ 1 reassignable seat. */
export const REASSIGN_TOOLTIP_DEFAULT = 'Reassign committee roles';
/** Sub-row Edit pencil tooltip — writer can edit this org-editable seat. */
export const EDIT_TOOLTIP_DEFAULT = 'Edit committee role';
/** Sub-row Edit pencil tooltip — seat is foundation-controlled and not editable here (fallback when no upstream reason). */
export const EDIT_TOOLTIP_NOT_ORG_EDITABLE = 'This seat is foundation-controlled and not editable here.';

/** Zero-valued envelope — `toSignal` initialValue + the no-account / no-seats fallback. */
export const EMPTY_ORG_PEOPLE_COMMITTEE_MEMBERS_RESPONSE: OrgPeopleCommitteeMembersResponse = {
  orgUid: '',
  assignments: [],
  stats: { individualCount: 0, committeeCount: 0, foundationsCovered: 0 },
};

/** True when a voting status is VOTING (non-empty, not "non-voting"/"none"); the single classifier shared by the pill + Board stat tiles + Board "All Statuses" filter (D-102). */
export function isVotingStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s.length > 0 && s !== 'non-voting' && s !== 'none';
}

/** Tailwind pill classes for a voting status — emerald when voting, neutral slate when "Non-voting"/"None"/empty. Delegates to `isVotingStatus` (D-102). */
export function votingStatusPillClass(status: string | null | undefined): string {
  return isVotingStatus(status) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-50 text-slate-600';
}
