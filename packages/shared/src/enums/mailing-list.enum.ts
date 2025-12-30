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
