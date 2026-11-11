// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mailing list type options (Groups.io API)
 * @description Maps to the 'type' field in the API
 */
export enum MailingListType {
  ANNOUNCEMENT = 'announcement',
  DISCUSSION_MODERATED = 'discussion_moderated',
  DISCUSSION_OPEN = 'discussion_open',
}

/**
 * Audience access options for mailing lists
 * @description Controls who can discover and join this mailing list
 */
export enum MailingListAudienceAccess {
  PUBLIC = 'public',
  APPROVAL_REQUIRED = 'approval_required',
  INVITE_ONLY = 'invite_only',
}

/**
 * Groups.io service type
 * @description Type of the Groups.io service
 */
export enum GroupsIOServiceType {
  PRIMARY = 'v2_primary',
  FORMATION = 'v2_formation',
  SHARED = 'v2_shared',
}

/**
 * Groups.io service status
 * @description Status of the Groups.io service
 */
export enum GroupsIOServiceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * Mailing list member type
 * @description Indicates how the member was added to the mailing list
 */
export enum MailingListMemberType {
  COMMITTEE = 'committee',
  DIRECT = 'direct',
}

/**
 * Mailing list member delivery mode
 * @description How emails are delivered to this member (Groups.io API values)
 */
export enum MailingListMemberDeliveryMode {
  NORMAL = 'email_delivery_single',
  DIGEST = 'email_delivery_digest',
  NONE = 'email_delivery_none',
  SPECIAL = 'email_delivery_special',
  HTML_DIGEST = 'email_delivery_html_digest',
  SUMMARY = 'email_delivery_summary',
}

/**
 * Mailing list member moderation status
 * @description The moderation role of the member
 */
export enum MailingListMemberModStatus {
  NONE = 'none',
  MODERATOR = 'moderator',
  OWNER = 'owner',
}

/**
 * Committee-to-mailing-list membership sync direction
 * @description Controls automatic membership synchronization between a mailing list and its linked committee. Only meaningful when a committee_uid is set; ITX is the system of record for this value (proxied through on the wire, not persisted locally).
 */
export enum MailingListSyncMode {
  MANUAL = 'manual',
  AUTO_COMMITTEE_TO_MAILING_LIST = 'auto_c_to_ml',
  AUTO_MAILING_LIST_TO_COMMITTEE = 'auto_ml_to_c',
}

/**
 * Sync-diff/sync-apply member type (committee ↔ mailing list sync)
 * @description Indicates which side of the sync a member originates from
 */
export enum SyncMemberType {
  COMMITTEE_MEMBER = 'committee_member',
  MAILING_LIST_MEMBER = 'mailing_list_member',
}

/**
 * Sync-apply per-row outcome
 * @description Result of applying a single add/remove row during sync-apply
 */
export enum SyncApplyOutcome {
  ADDED = 'added',
  INVITED = 'invited',
  REMOVED = 'removed',
  SKIPPED_CROSS_LIST = 'skipped_cross_list',
  FAILED = 'failed',
}
