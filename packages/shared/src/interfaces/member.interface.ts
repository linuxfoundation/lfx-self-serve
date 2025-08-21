// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Committee member entity with complete profile and role information
 * @description Represents an individual member of a committee with their role, voting status, and tenure
 */
export interface CommitteeMember {
  /** Unique member identifier */
  id: string;
  /** Timestamp when member was added to committee */
  created_at: string;
  /** Timestamp when member information was last updated */
  updated_at?: string;
  /** Member's first name */
  first_name?: string;
  /** Member's last name */
  last_name?: string;
  /** Member's email address */
  email?: string;
  /** Member's job title */
  job_title?: string;
  /** Member's organization name */
  organization?: string;
  /** Organization website URL */
  organization_url?: string;
  /** Member's role within the committee (Chair, Secretary, etc.) */
  role?: string;
  /** Voting status (Voting Rep, Observer, etc.) */
  voting_status?: string;
  /** Who appointed this member to their role */
  appointed_by?: string;
  /** Start date of current role (ISO string) */
  role_start?: string;
  /** End date of current role (ISO string) */
  role_end?: string;
  /** Start date of current voting status (ISO string) */
  voting_status_start?: string;
  /** End date of current voting status (ISO string) */
  voting_status_end?: string;
  /** Committee ID this member belongs to */
  committee_id: string;
}

/**
 * Data required to create a new committee member
 * @description Input payload for adding members to committees
 */
export interface CreateCommitteeMemberRequest {
  /** Member's first name (required) */
  first_name: string;
  /** Member's last name (required) */
  last_name: string;
  /** Member's email address (required) */
  email: string;
  /** Member's job title */
  job_title?: string;
  /** Member's organization name */
  organization?: string;
  /** Organization website URL */
  organization_url?: string;
  /** Member's role within the committee */
  role?: string;
  /** Voting status assignment */
  voting_status?: string;
  /** Who is appointing this member */
  appointed_by?: string;
  /** Start date of role assignment (ISO string) */
  role_start?: string;
  /** End date of role assignment (ISO string) */
  role_end?: string;
  /** Start date of voting status (ISO string) */
  voting_status_start?: string;
  /** End date of voting status (ISO string) */
  voting_status_end?: string;
}
