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

/** Zero-valued envelope — `toSignal` initialValue + the no-account / no-seats fallback. */
export const EMPTY_ORG_PEOPLE_COMMITTEE_MEMBERS_RESPONSE: OrgPeopleCommitteeMembersResponse = {
  orgUid: '',
  assignments: [],
  stats: { individualCount: 0, committeeCount: 0, foundationsCovered: 0 },
};

/**
 * Tailwind pill classes for a seat's voting status. A real voting status (e.g. "Voting Rep")
 * gets an emerald pill; "Non-voting" / "None" / empty gets a neutral slate pill — matching the
 * spec-027 wireframe (Non-voting rendered as a gray pill).
 */
export function votingStatusPillClass(status: string | null | undefined): string {
  const s = (status ?? '').trim().toLowerCase();
  const isVoting = s.length > 0 && s !== 'non-voting' && s !== 'none';
  return isVoting ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-slate-50 text-slate-600';
}
