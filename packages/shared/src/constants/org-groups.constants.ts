// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GroupsSelectOption, GroupsTabConfig, GroupsTabId, GroupsVotingFilter } from '../interfaces';

/** Groups page tabs in visible order (`all` is the default). */
export const GROUPS_TABS: readonly GroupsTabConfig[] = [
  { id: 'all', label: 'All', icon: 'fa-light fa-users-rectangle', noun: 'all groups' },
  { id: 'board', label: 'Board', icon: 'fa-light fa-user-tie', noun: 'board groups' },
  { id: 'other', label: 'Other', icon: 'fa-light fa-sitemap', noun: 'other groups' },
] as const;

/** Default tab — URL drops `?tab=` when active to keep deep links clean. */
export const DEFAULT_GROUPS_TAB_ID: GroupsTabId = 'all';

/** Derived from GROUPS_TABS; used to validate `?tab=` query-param input. */
export const VALID_GROUPS_TAB_IDS: ReadonlySet<GroupsTabId> = new Set(GROUPS_TABS.map((t) => t.id));

/** Pagination page-size options available in the groups table. */
export const GROUPS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50] as const;

/** Default page size for the groups table. */
export const GROUPS_DEFAULT_PAGE_SIZE = 25;

/** Voting-status filter options for the shared filter bar. */
export const GROUPS_VOTING_OPTIONS: readonly GroupsSelectOption[] = [
  { label: 'All', value: 'all' satisfies GroupsVotingFilter },
  { label: 'Voting Enabled', value: 'enabled' satisfies GroupsVotingFilter },
  { label: 'Non-Voting', value: 'disabled' satisfies GroupsVotingFilter },
] as const;
