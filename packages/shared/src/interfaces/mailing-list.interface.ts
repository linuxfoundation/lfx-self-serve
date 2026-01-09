// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GroupsIOServiceStatus,
  GroupsIOServiceType,
  MailingListAudienceAccess,
  MailingListMemberDeliveryMode,
  MailingListMemberModStatus,
  MailingListMemberType,
  MailingListType,
} from '../enums/mailing-list.enum';
import { CommitteeReference } from './committee.interface';

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
 * @deprecated Use CommitteeReference instead
 * Type alias for backward compatibility
 */
export type MailingListCommittee = CommitteeReference;

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
  committees?: CommitteeReference[];
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
  committees?: CommitteeReference[];
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

/**
 * Mailing list member entity (Groups.io member)
 * @description Represents a member of a mailing list
 */
export interface MailingListMember {
  /** Unique member identifier */
  uid: string;
  /** Parent mailing list UID */
  mailing_list_uid: string;
  /** Member's username/handle */
  username?: string;
  /** Member's first name */
  first_name?: string;
  /** Member's last name */
  last_name?: string;
  /** Member's email address */
  email: string;
  /** Member's organization */
  organization?: string;
  /** Member's job title */
  job_title?: string;
  /** How member was added (committee or direct) */
  member_type: MailingListMemberType;
  /** Email delivery mode (normal, digest, none) */
  delivery_mode: MailingListMemberDeliveryMode;
  /** Moderation status (none, moderator, owner) */
  mod_status: MailingListMemberModStatus;
  /** Member active status */
  status: string;
  /** Last review timestamp */
  last_reviewed_at?: string | null;
  /** User who last reviewed */
  last_reviewed_by?: string | null;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
}

/**
 * Request payload for creating a mailing list member
 * @description Input payload for adding members to mailing lists
 */
export interface CreateMailingListMemberRequest {
  /** Member's email address (required) */
  email: string;
  /** Member's username/handle */
  username?: string | null;
  /** Member's first name */
  first_name?: string | null;
  /** Member's last name */
  last_name?: string | null;
  /** Member's organization */
  organization?: string | null;
  /** Member's job title */
  job_title?: string | null;
  /** How member was added */
  member_type?: MailingListMemberType;
  /** Email delivery mode */
  delivery_mode?: MailingListMemberDeliveryMode;
  /** Moderation status */
  mod_status?: MailingListMemberModStatus;
}

/**
 * Request payload for updating a mailing list member
 * @description Partial update for existing members (email is immutable)
 */
export interface UpdateMailingListMemberRequest {
  /** Member's username/handle */
  username?: string | null;
  /** Member's first name */
  first_name?: string | null;
  /** Member's last name */
  last_name?: string | null;
  /** Member's organization */
  organization?: string | null;
  /** Member's job title */
  job_title?: string | null;
  /** Email delivery mode */
  delivery_mode?: MailingListMemberDeliveryMode;
  /** Moderation status */
  mod_status?: MailingListMemberModStatus;
}
