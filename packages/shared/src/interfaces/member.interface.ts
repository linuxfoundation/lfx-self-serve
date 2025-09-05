// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberAppointedBy, CommitteeMemberRole, CommitteeMemberStatus, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';

/**
 * Committee member entity with complete profile and role information
 * @description Represents an individual member of a committee with their role, voting status, and tenure
 */
export interface CommitteeMember {
  /** Unique member identifier */
  uid: string;
  /** Committee UID this member belongs to */
  committee_uid: string;
  /** Committee name for display purposes */
  committee_name: string;
  /** Member's username/handle */
  username?: string;
  /** Member's email address */
  email: string;
  /** Member's first name */
  first_name: string;
  /** Member's last name */
  last_name: string;
  /** Member's job title */
  job_title?: string;
  /** Who appointed this member to their role */
  appointed_by?: CommitteeMemberAppointedBy;
  /** Member status */
  status?: CommitteeMemberStatus;
  /** Member's role within the committee */
  role?: {
    /** Role name */
    name: CommitteeMemberRole;
    /** Start date of role assignment (ISO string) */
    start_date?: string;
    /** End date of role assignment (ISO string) */
    end_date?: string;
  } | null;
  /** Member's voting eligibility and status */
  voting?: {
    /** Voting status */
    status: CommitteeMemberVotingStatus;
    /** Start date of voting eligibility (ISO string) */
    start_date?: string;
    /** End date of voting eligibility (ISO string) */
    end_date?: string;
  } | null;
  /** Member's agency affiliation */
  agency?: string;
  /** Member's country */
  country?: string;
  /** Member's organization information */
  organization?: {
    /** Organization name */
    name: string;
    /** Organization website URL */
    website?: string;
  };
  /** Timestamp when member was added to committee */
  created_at: string;
  /** Timestamp when member information was last updated */
  updated_at: string;
}

/**
 * Data required to create a new committee member
 * @description Input payload for adding members to committees
 */
export interface CreateCommitteeMemberRequest {
  /** Member's email address (required) */
  email: string;
  /** Member's username/handle */
  username?: string | null;
  /** Member's first name */
  first_name?: string | null;
  /** Member's last name */
  last_name?: string | null;
  /** Member's job title */
  job_title?: string | null;
  /** Member's role within the committee */
  role?: {
    /** Role name */
    name: CommitteeMemberRole;
    /** Start date of role assignment (ISO date string) */
    start_date?: string | null;
    /** End date of role assignment (ISO date string) */
    end_date?: string | null;
  } | null;
  /** Who appointed this member to their role */
  appointed_by?: CommitteeMemberAppointedBy | null;
  /** Member status */
  status?: CommitteeMemberStatus | null;
  /** Member's voting eligibility and status */
  voting?: {
    /** Voting status */
    status: CommitteeMemberVotingStatus;
    /** Start date of voting eligibility (ISO date string) */
    start_date?: string | null;
    /** End date of voting eligibility (ISO date string) */
    end_date?: string | null;
  } | null;
  /** Member's agency affiliation */
  agency?: string | null;
  /** Member's country */
  country?: string | null;
  /** Member's organization information */
  organization?: {
    /** Organization name */
    name?: string | null;
    /** Organization website URL */
    website?: string | null;
  } | null;
}
