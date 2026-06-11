// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BoardMembersSortColumn, OrgDropdownOption, OrgPeopleBoardMembersResponse } from '../interfaces';

/** Default sort column for the People → Board table (FR-021). */
export const ORG_PEOPLE_BOARD_MEMBERS_DEFAULT_SORT_COLUMN: BoardMembersSortColumn = 'name';

/** Stat-tile labels (header + skeleton), in display order, matching the screenshot (FR-004). */
export const ORG_PEOPLE_BOARD_STAT_LABELS: readonly string[] = ['Total Board Members', 'Voting', 'Non-voting', 'Foundations with a board member'];

/** Table provenance caption (FR-024). */
export const ORG_PEOPLE_BOARD_SOURCE_CAPTION = 'Source: LFX Membership Board Representatives';

/** "All Statuses" dropdown options for the voting-status filter (FR-007). */
export const ORG_PEOPLE_BOARD_STATUS_OPTIONS: readonly OrgDropdownOption[] = [
  { label: 'All Statuses', value: '' },
  { label: 'Voting', value: 'voting' },
  { label: 'Non-voting', value: 'non-voting' },
];

/** Zero-valued envelope — `toSignal` initialValue + the no-account / no-seats fallback. */
export const EMPTY_ORG_PEOPLE_BOARD_MEMBERS_RESPONSE: OrgPeopleBoardMembersResponse = {
  orgUid: '',
  assignments: [],
  stats: { totalBoardMembers: 0, votingCount: 0, nonVotingCount: 0, foundationsCovered: 0 },
};
