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
  PRIMARY = 'primary',
  FORMATION = 'formation',
  SHARED = 'shared',
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
 * @description How emails are delivered to this member
 */
export enum MailingListMemberDeliveryMode {
  NORMAL = 'normal',
  DIGEST = 'digest',
  NONE = 'none',
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
