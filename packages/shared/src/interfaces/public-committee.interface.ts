// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Public-safe committee member representation.
 * Strips emails, internal IDs, and other private fields.
 */
export interface PublicCommitteeMember {
  name: string;
  organization?: string;
  role?: string;
}

/**
 * Public-safe meeting schedule information.
 */
export interface PublicCommitteeMeeting {
  time: string;
  timezone: string;
  duration: number;
  recurrence?: string;
  video_link?: string;
}

/**
 * External links associated with a committee.
 */
export interface PublicCommitteeLinks {
  website?: string;
  mailing_list_url?: string;
  chat_channel_url?: string;
}

/**
 * Public-safe committee representation for unauthenticated consumers.
 * Used by foundation websites and external integrations.
 */
export interface PublicCommittee {
  uid: string;
  name: string;
  description?: string;
  category: string;
  chairs: PublicCommitteeMember[];
  members: PublicCommitteeMember[];
  total_members: number;
  meeting_schedule?: PublicCommitteeMeeting;
  external_links: PublicCommitteeLinks;
}
