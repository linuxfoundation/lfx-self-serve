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
  USER_EMAILS_READ = 'lfx.auth-service.user_emails.read',
  USER_EMAILS_SET_PRIMARY = 'lfx.auth-service.user_emails.set_primary',
  PASSWORD_RESET_LINK = 'lfx.auth-service.password.reset_link',
  PASSWORD_UPDATE = 'lfx.auth-service.password.update',
  LOOKUP_V1_MAPPING = 'lfx.lookup_v1_mapping',
  PERSONAS_GET = 'lfx.personas-api.get',
  IMPERSONATION_TOKEN_EXCHANGE = 'lfx.auth-service.impersonation.token_exchange',
  // Preferred meeting-invitation email (meeting-service) — request carries the user's v1
  // API-gateway token in the `token` field (forwarded to v1 /v1/me), not the auth-service
  // { user: { auth_token } } wrapper used by the subjects above.
  MEETING_PREFERRED_EMAIL_GET = 'lfx.meeting-service.preferred_email.get',
  MEETING_PREFERRED_EMAIL_SET = 'lfx.meeting-service.preferred_email.set',
  INVITE_ACCEPTED = 'lfx.invite.accepted',
  // Alias claim (auth-service) — claims <alias>@<domain> as a system-managed linked identity
  ADD_ALIAS = 'lfx.auth-service.add_alias',
  // Email forwarding (forwards-service) — stateless proxy to forwardemail.net
  FORWARDS_CHECK_ALIAS = 'lfx.forwards-service.check_alias',
  FORWARDS_SET_TARGET = 'lfx.forwards-service.set_target',
  FORWARDS_GET_FORWARD = 'lfx.forwards-service.get_forward',
}
