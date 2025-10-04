// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * NATS message subjects enum
 */
export enum NatsSubjects {
  PROJECT_SLUG_TO_UID = 'lfx.projects-api.slug_to_uid',
  USER_METADATA_UPDATE = 'lfx.auth-service.user_metadata.update',
  EMAIL_TO_USERNAME = 'lfx.auth-service.email_to_username',
}
