// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ─── Tab ─────────────────────────────────────────────────────────────────────

export type GroupsTabId = 'all' | 'board' | 'other';

export interface GroupsTabConfig {
  readonly id: GroupsTabId;
  readonly label: string;
  readonly icon: string;
  readonly noun: string;
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export type GroupType = 'Board' | 'Working Group' | 'TAC' | 'Marketing Committee' | 'Other';
export type GroupVisibility = 'PUBLIC' | 'PRIVATE';
export type GroupsVotingFilter = 'all' | 'enabled' | 'disabled';
export type GroupsSortField = 'name' | 'type' | 'memberCount' | 'updatedAt';
export type GroupsSortDir = 'asc' | 'desc';

// ─── Data model ───────────────────────────────────────────────────────────────

export interface OrgGroup {
  id: string;
  name: string;
  description: string;
  type: GroupType;
  foundation: string;
  visibility: GroupVisibility;
  votingEnabled: boolean;
  memberCount: number;
  hasMailingList: boolean;
  hasChatChannel: boolean;
  updatedAt: Date;
}

export interface OrgGroupsStats {
  total: number;
  public: number;
  votingEnabled: number;
  boardCount: number;
  otherCount: number;
  foundationCount: number;
}

// ─── Filter state (maps 1-to-1 with query params) ─────────────────────────────

export interface GroupsFilterState {
  q: string;
  foundation: string;
  project: string;
  voting: GroupsVotingFilter;
}

// ─── Select option helpers ─────────────────────────────────────────────────────

export interface GroupsSelectOption {
  label: string;
  value: string;
}
