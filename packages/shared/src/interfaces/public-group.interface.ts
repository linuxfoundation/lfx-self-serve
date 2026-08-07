// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVisibility } from '../enums/committee.enum';

import { BehavioralClassDisplayConfig, JoinMode } from './committee.interface';

export interface PublicGroupMember {
  name: string;
  organization?: string;
  role?: string;
  profile_url?: string;
  avatar_url?: string;
}

export interface PublicGroupMeeting {
  uid: string;
  title: string;
  starts_at: string;
  ends_at?: string;
  timezone?: string;
  url?: string;
}

export interface PublicGroupLinks {
  website?: string | null;
  mailing_list?: string | null;
  calendar?: string | null;
}

export interface PublicGroupContext {
  scope: 'foundation' | 'project';
  foundation_uid: string;
  foundation_name: string;
  foundation_slug: string;
  foundation_logo_url?: string;
  project_uid?: string;
  project_name?: string;
  project_slug?: string;
  project_logo_url?: string;
}

/** OCG or other external source linked to this group. */
export interface PublicGroupExternalSource {
  provider: 'ocg';
  entity_type: 'community' | 'group' | 'event';
  label: string;
  url: string;
  external_id?: string;
  external_category?: string;
  external_region?: string;
}

/** Public-safe group summary returned by the directory endpoints. */
export interface PublicGroupSummary {
  uid: string;
  /** URL-safe slug for the group (may be absent if upstream does not return one). */
  slug?: string;
  name: string;
  display_name?: string;
  description?: string;
  /** Raw category string from the committee service (e.g. "Working Group"). */
  category: string;
  /** Pre-computed behavioral class derived from `category`. */
  behavioral_class: string;
  context: PublicGroupContext;
  join_mode?: JoinMode;
  total_members?: number;
  website?: string | null;
  mailing_list?: string | null;
  has_public_calendar?: boolean;
  external_sources?: PublicGroupExternalSource[];
}

/** Response envelope returned by `GET /public/api/foundations/:uid/groups` and `GET /public/api/projects/:uid/groups`. */
export interface PublicGroupDirectoryResponse {
  groups: PublicGroupSummary[];
  total: number;
}

/** Frontend view model — extends PublicGroupSummary with pre-computed display metadata. */
export interface PublicGroupDirectoryVm extends PublicGroupSummary {
  classConfig: BehavioralClassDisplayConfig;
  joinLabel: string | undefined;
}

export interface PublicGroupDetail {
  uid: string;
  name: string;
  sso_group_name?: string;
  description?: string;
  category: string;
  join_mode?: JoinMode;
  total_members: number;
  context: PublicGroupContext;
  chairs: PublicGroupMember[];
  links: PublicGroupLinks;
  upcoming_meetings: PublicGroupMeeting[];
  cadence?: string;
  calendar_url?: string;
  member_visibility?: CommitteeMemberVisibility;
  is_member?: boolean;
  my_role?: string;
}
