// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { GroupsIOServiceStatus, GroupsIOServiceType, MailingListAudienceAccess, MailingListType } from '../enums/mailing-list.enum';

/**
 * Linked group reference for mailing lists
 * @description Represents a committee/group linked to a mailing list
 */
export interface LinkedGroup {
  /** Unique identifier for the group */
  uid: string;
  /** Display name of the group */
  name: string;
  /** Optional URL to the group page */
  url?: string;
}

/**
 * Committee reference for mailing lists
 * @description Represents a committee linked to a mailing list with allowed voting statuses
 */
export interface MailingListCommittee {
  /** Committee UID */
  uid: string;
  /** Committee display name */
  name?: string;
  /** Allowed voting statuses: Voting Rep, Alternate Voting Rep, Observer, Emeritus, None */
  allowed_voting_statuses?: CommitteeMemberVotingStatus[];
}

/**
 * Groups.io service entity
 * @description Represents a Groups.io service that mailing lists are associated with
 */
export interface GroupsIOService {
  /** Unique service identifier */
  uid: string;
  /** Service type (primary, formation, shared) */
  type: GroupsIOServiceType;
  /** Domain for the service */
  domain: string;
  /** Groups.io group ID */
  group_id: number;
  /** Service status */
  status: GroupsIOServiceStatus;
  /** Global owners email addresses */
  global_owners: string[];
  /** Prefix for mailing lists */
  prefix: string;
  /** Associated project slug */
  project_slug: string;
  /** Associated project UID */
  project_uid: string;
  /** Groups.io URL */
  url: string;
  /** Groups.io group name */
  group_name: string;
  /** Whether the service is public */
  public: boolean;
  /** Associated project name */
  project_name: string;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Groups.io mailing list entity
 * @description Full mailing list data for dashboard display
 */
export interface GroupsIOMailingList {
  /** Unique mailing list identifier */
  uid: string;
  /** Groups.io group name (3-34 chars) */
  group_name: string;
  /** Whether the mailing list is publicly accessible */
  public: boolean;
  /** Origin: api, webhook, or mock */
  source: string;
  /** Mailing list type (announcement, discussion_moderated, discussion_open) */
  type: MailingListType;
  /** Controls who can discover and join this mailing list (public, approval_required, invite_only) */
  audience_access: MailingListAudienceAccess;
  /** Description of the mailing list purpose (11-500 chars) */
  description: string;
  /** Display title for the mailing list (5-100 chars) */
  title: string;
  /** Email subject prefix (optional) */
  subject_tag?: string;
  /** Parent service UID */
  service_uid: string;
  /** Associated project UID (inherited from parent service) */
  project_uid: string;
  /** Associated project name (inherited from parent service) */
  project_name: string;
  /** Associated project slug (inherited from parent service) */
  project_slug: string;
  /** Audit timestamp (nullable) */
  last_reviewed_at?: string | null;
  /** Auditor user ID (nullable) */
  last_reviewed_by?: string | null;
  /** Users who can edit */
  writers?: string[];
  /** Users who can audit */
  auditors?: string[];
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Linked committees with names and allowed voting statuses */
  committees?: MailingListCommittee[];
  /** Parent service details (enriched from service lookup) */
  service?: GroupsIOService;
}

/**
 * Request payload for creating a new mailing list
 * @description Maps to Groups.io API create endpoint
 */
export interface CreateMailingListRequest {
  /** Groups.io group name (3-34 chars) */
  group_name: string;
  /** Whether the mailing list is publicly accessible */
  public: boolean;
  /** Mailing list type */
  type: MailingListType;
  /** Controls who can discover and join this mailing list */
  audience_access: MailingListAudienceAccess;
  /** Description of the mailing list (11-500 chars) */
  description: string;
  /** Display title for the mailing list (5-100 chars) */
  title?: string;
  /** Parent service UID (required) */
  service_uid: string;
  /** Linked committees with allowed voting statuses */
  committees?: MailingListCommittee[];
  /** Email subject prefix (optional) */
  subject_tag?: string;
}

/**
 * Request payload for creating a Groups.io service
 * @description Used when creating a new Groups.io service
 */
export interface CreateGroupsIOServiceRequest {
  /** Service type */
  type: string;
  /** Domain for the service */
  domain?: string;
  /** Prefix for mailing lists (optional) */
  prefix?: string;
  /** Associated project UID */
  project_uid: string;
  /** Groups.io group name */
  group_name?: string;
  /** Whether the service is publicly accessible */
  public?: boolean;
}

/**
 * Request payload for updating a Groups.io service
 * @description Used when updating an existing Groups.io service
 */
export interface UpdateGroupsIOServiceRequest {
  /** Domain for the service (optional) */
  domain?: string;
  /** Prefix for mailing lists (optional) */
  prefix?: string;
  /** Whether the service is publicly accessible (optional) */
  public?: boolean;
  /** Service status (optional) */
  status?: string;
}
