// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * NATS message subjects enum
 */
export enum NatsSubjects {
  PROJECT_SLUG_TO_UID = 'lfx.projects-api.slug_to_uid',
  PROJECT_GET_NAME = 'lfx.projects-api.get_name',
  USER_METADATA_UPDATE = 'lfx.auth-service.user_metadata.update',
  USER_METADATA_READ = 'lfx.auth-service.user_metadata.read',
  EMAIL_TO_USERNAME = 'lfx.auth-service.email_to_username',
  EMAIL_TO_SUB = 'lfx.auth-service.email_to_sub',
  USERNAME_TO_USER_INFO = 'lfx.auth-service.username_to_user_info',
  EMAIL_SEND_VERIFICATION = 'lfx.auth-service.email_linking.send_verification',
  EMAIL_VERIFY_OTP = 'lfx.auth-service.email_linking.verify',
  USER_IDENTITY_LINK = 'lfx.auth-service.user_identity.link',
  USER_IDENTITY_UNLINK = 'lfx.auth-service.user_identity.unlink',
  USER_IDENTITY_LIST = 'lfx.auth-service.user_identity.list',
  LOOKUP_V1_MAPPING = 'lfx.lookup_v1_mapping',
  PERSONAS_GET = 'lfx.personas-api.get',
  IMPERSONATION_TOKEN_EXCHANGE = 'lfx.auth-service.impersonation.token_exchange',
}
