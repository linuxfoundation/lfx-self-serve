// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MyDocumentItem } from './my-document.interface';
import type { Vote } from './poll.interface';
import type { Survey } from './survey.interface';

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
  parentProject: string;
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

// ─── Privacy split (mirrors the org-meetings privacy pattern, LFXV2-1901) ─────

export type OrgPrivateGroupsRollupBucket = 'Board' | 'Working Group' | 'Other';

/** Label/icon/style badge for a rollup bucket, pre-derived from `ORG_GROUPS_ROLLUP_TYPE_BADGES` (avoids method calls in the template). */
export interface OrgGroupsRollupTypeBadge {
  readonly label: string;
  readonly icon: string;
  readonly badgeClass: string;
}

export interface OrgPrivateGroupsRollupTypeBadgeVm {
  readonly bucket: OrgPrivateGroupsRollupBucket;
  readonly count: number;
  readonly badge: OrgGroupsRollupTypeBadge;
}

export interface OrgPrivateGroupsRollupVm {
  readonly totalCount: number;
  readonly typeBadges: readonly OrgPrivateGroupsRollupTypeBadgeVm[];
  readonly projectCount: number;
  readonly foundationCount: number;
  readonly memberCount: number;
}

export interface OrgGroupsPrivacySplit {
  readonly visible: readonly OrgGroup[];
  readonly rollup: OrgPrivateGroupsRollupVm | null;
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

export type GroupDetailTabId = 'overview' | 'members' | 'votes' | 'meetings' | 'surveys' | 'documents';

export interface GroupDetailTabConfig {
  readonly id: GroupDetailTabId;
  readonly label: string;
  readonly icon: string;
}

export interface GroupChair {
  id: string;
  name: string;
  initials: string;
  role: string; // 'Chair' | 'Vice Chair' | ... — drives avatar color, like committee chair.role.name
}

export interface GroupMember {
  id: string;
  name: string;
  email: string;
  organizationName: string;
  role: string;
  votingStatus?: string;
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
  description?: string;
  isRecurring?: boolean;
  hasRecording?: boolean;
  hasTranscripts?: boolean;
  isPrivate?: boolean;
}

export interface OrgGroupDetail extends OrgGroup {
  parentProjectId: string;
  createdAt: Date;
  organizationCount: number;
  meetingCount: number;
  openSurveyCount: number;
  inviteOnly: boolean;
  chairs: GroupChair[];
  nextMeetings: GroupMeeting[];
  pastMeetings: GroupMeeting[];
  members: GroupMember[];
  votes: Vote[];
  surveys: Survey[];
  documents: MyDocumentItem[];
  mailingListName?: string;
  mailingListSubscribers?: number;
  mailingListIsPrivate?: boolean;
  chatChannelUrl?: string;
  websiteUrl?: string;
}
