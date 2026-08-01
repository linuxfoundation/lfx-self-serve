// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVisibility } from '../enums/committee.enum';

import { JoinMode } from './committee.interface';

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

export interface PublicGroupDetail {
  uid: string;
  name: string;
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
