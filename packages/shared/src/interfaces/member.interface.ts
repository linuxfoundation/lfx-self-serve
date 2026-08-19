// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberAppointedBy, CommitteeMemberRole, CommitteeMemberStatus, CommitteeMemberVotingStatus } from '../enums';
import { CommitteeInvite, CommitteePermissionLevel, CreateCommitteeInviteRequest } from './committee.interface';

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
  /** Committee category (e.g. "Board", "Working Group") — returned by query service */
  committee_category?: string;
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
  /** Member's LinkedIn profile URL */
  linkedin_profile?: string;
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
  /** Member's LinkedIn profile URL */
  linkedin_profile?: string | null;
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
    /** b2b Salesforce Account SFID (18-char); null/omit when the org has no LF member account */
    id?: string | null;
    /** Organization name */
    name?: string | null;
    /** Organization website URL */
    website?: string | null;
  } | null;
}

/**
 * Client-side options for creating a committee member. Not part of the upstream
 * request body — the BFF translates these into request metadata.
 */
export interface CreateCommitteeMemberOptions {
  /** When true, the BFF sends X-Skip-Notification upstream so the member gets no invite/notification email. */
  skipNotification?: boolean;
}

/**
 * Raw form values from the member form dialog
 * @description Typed shape of the FormGroup.getRawValue() output in MemberFormComponent
 */
export interface MemberFormValue {
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  linkedin_profile: string;
  organization: string;
  organization_url: string;
  organization_id: string | null;
  role: CommitteeMemberRole | '';
  voting_status: CommitteeMemberVotingStatus | '';
  appointed_by: CommitteeMemberAppointedBy | '';
  role_start: Date | null;
  role_end: Date | null;
  voting_status_start: Date | null;
  voting_status_end: Date | null;
  permission: CommitteePermissionLevel;
}

/**
 * State types for tracking member changes
 * @description Tracks the lifecycle state of a committee member during editing
 */
export type CommitteeMemberState = 'existing' | 'new' | 'modified' | 'deleted';

/**
 * Enhanced committee member with state tracking
 * @description Extends CommitteeMember with metadata for local state management in forms
 */
export interface CommitteeMemberWithState extends CommitteeMember {
  /** Current state of this member */
  state: CommitteeMemberState;
  /** Original data from API (for existing members, used for change detection) */
  originalData?: CommitteeMember;
  /** Temporary ID for new members before API creates uid */
  tempId?: string;
}

/**
 * Pending changes summary for committee members
 * @description Tracks all member changes to be submitted as a batch
 */
export interface MemberPendingChanges {
  /** Members to be created via API */
  toAdd: CreateCommitteeMemberRequest[];
  /** Members to be updated via API (full member object) */
  toUpdate: { uid: string; changes: CreateCommitteeMemberRequest }[];
  /** Member UIDs to be deleted via API */
  toDelete: string[];
  /**
   * Bulk email invites staged during the create-group wizard. Collected client-side and
   * flushed on wizard completion (POST /invites) — never sent immediately, so cancelling
   * the wizard sends nothing (LFXV2-2606).
   */
  toInvite: CreateCommitteeInviteRequest[];
}

/** Kind of staged operation flushed by the committee-manage wizard (GH-1608). */
export type MemberOperationType = 'add' | 'update' | 'delete' | 'invite';

/**
 * Result of a single flushed member/invite operation.
 * @description `identifier` traces the result back to the staged item that produced it — the
 * member email for `add`, the member uid for `update`/`delete`, or the invitee email for
 * `invite` — so a failure can be re-staged instead of silently discarded (GH-1608).
 */
export interface MemberOperationResult {
  type: MemberOperationType;
  identifier: string;
  success: boolean;
}

/**
 * Identifiers of successfully-flushed operations, grouped by type, normalized (trimmed +
 * lowercased) where the identifier is an email. Used to prune already-applied changes out of the
 * wizard's staged state after a partial flush failure, so retry only resubmits what actually
 * failed (GH-1608).
 */
export interface SucceededMemberOperations {
  addedEmails: Set<string>;
  updatedUids: Set<string>;
  deletedUids: Set<string>;
  invitedEmails: Set<string>;
}

/**
 * Unified table row for the committee Members list.
 * Member rows carry a `CommitteeMember`; invite rows carry a `CommitteeInvite`.
 * The `rowType` discriminant drives conditional template rendering without nested ternaries.
 */
export type CommitteeTableRow = { rowType: 'member'; data: CommitteeMember } | { rowType: 'invite'; data: CommitteeInvite };
