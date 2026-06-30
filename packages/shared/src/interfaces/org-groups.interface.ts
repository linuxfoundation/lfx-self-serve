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
  voting: GroupsVotingFilter;
}

// ─── Select option helpers ─────────────────────────────────────────────────────

export interface GroupsSelectOption {
  label: string;
  value: string;
}

// ─── Group detail ─────────────────────────────────────────────────────────────

export type GroupDetailTabId = 'overview' | 'votes' | 'meetings' | 'surveys' | 'documents';

export interface GroupDetailTabConfig {
  readonly id: GroupDetailTabId;
  readonly label: string;
  readonly icon: string;
}

export interface GroupChair {
  id: string;
  name: string;
  initials: string;
  avatarColor: string; // tailwind bg class e.g. 'bg-violet-500'
}

export interface GroupMeeting {
  id: string;
  title: string;
  monthAbbr: string; // 'DEC'
  day: number; // 15
  dayOfWeek: string; // 'Mon'
  time: string; // '4:00 PM'
  durationMin: number; // 45
  projectName: string;
  meetingType: string;
  hasReminder: boolean;
  hasAiSummary: boolean;
}

export interface OrgGroupDetail extends OrgGroup {
  parentProject: string;
  parentProjectId: string;
  createdAt: Date;
  organizationCount: number;
  meetingCount: number;
  activeVoteCount: number;
  openSurveyCount: number;
  inviteOnly: boolean;
  chairs: GroupChair[];
  nextMeetings: GroupMeeting[];
  pastMeetings: GroupMeeting[];
  mailingListName?: string;
  mailingListSubscribers?: number;
  mailingListIsPrivate?: boolean;
}
