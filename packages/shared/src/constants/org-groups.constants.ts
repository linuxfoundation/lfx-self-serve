// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  GroupDetailTabConfig,
  GroupDetailTabId,
  GroupsSelectOption,
  GroupsTabConfig,
  GroupsTabId,
  GroupsVotingFilter,
  OrgGroupsRollupTypeBadge,
  OrgPrivateGroupsRollupBucket,
} from '../interfaces';

/** Groups page tabs in visible order (`all` is the default). */
export const GROUPS_TABS: readonly GroupsTabConfig[] = [
  { id: 'all', label: 'All', icon: '', noun: 'all groups' },
  { id: 'board', label: 'Board', icon: 'fa-light fa-gavel', noun: 'board groups' },
  { id: 'other', label: 'Other', icon: 'fa-light fa-layer-group', noun: 'other groups' },
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
  { label: 'All Voting Status', value: 'all' satisfies GroupsVotingFilter },
  { label: 'Voting Enabled', value: 'enabled' satisfies GroupsVotingFilter },
  { label: 'Non-Voting', value: 'disabled' satisfies GroupsVotingFilter },
] as const;

/** Derived from GROUPS_VOTING_OPTIONS; used to validate `?voting=` query-param input. */
export const VALID_GROUPS_VOTING_FILTERS: ReadonlySet<GroupsVotingFilter> = new Set<GroupsVotingFilter>(
  GROUPS_VOTING_OPTIONS.map((o) => o.value as GroupsVotingFilter)
);

/** Group detail page tabs in visible order. */
export const DETAIL_TABS: readonly GroupDetailTabConfig[] = [
  { id: 'overview', label: 'Overview', icon: 'fa-light fa-gauge' },
  { id: 'members', label: 'Members', icon: 'fa-light fa-users' },
  { id: 'votes', label: 'Votes', icon: 'fa-light fa-check-to-slot' },
  { id: 'meetings', label: 'Meetings', icon: 'fa-light fa-calendar' },
  { id: 'surveys', label: 'Surveys', icon: 'fa-light fa-chart-simple' },
  { id: 'documents', label: 'Documents', icon: 'fa-light fa-folder-open' },
] as const;

/** Default tab for group detail — overview is shown on initial load. */
export const DEFAULT_DETAIL_TAB_ID: GroupDetailTabId = 'overview';

/** Label/icon/style badge per rollup bucket, shared by the org-groups private-rollup card (mirrors ORG_MEETING_TYPE_LABELS, LFXV2-1901). */
export const ORG_GROUPS_ROLLUP_TYPE_BADGES: Record<OrgPrivateGroupsRollupBucket, OrgGroupsRollupTypeBadge> = {
  Board: { label: 'Board', icon: 'fa-light fa-gavel', badgeClass: 'border border-violet-400 text-violet-600' },
  'Working Group': { label: 'Working Group', icon: 'fa-light fa-users-gear', badgeClass: 'border border-amber-400 text-amber-600' },
  Other: { label: 'Other', icon: 'fa-light fa-layer-group', badgeClass: 'bg-gray-100 text-gray-600' },
};

/**
 * Chair-avatar background color on the group detail page, keyed by whether the chair's role is
 * exactly 'Chair'. Hardcoded hex (not a `lfxColors` scale) to exactly match production's own
 * committee-overview chair-avatar design (`committee-overview.component.html`) — same
 * escape-valve pattern as `VOTE_COLOR` in calendar-colors.constants.ts.
 */
export const CHAIR_AVATAR_COLOR = {
  chair: '#6366f1',
  other: '#f59e0b',
} as const;
