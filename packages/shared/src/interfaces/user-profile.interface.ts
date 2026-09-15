// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PREFERRED_EMAIL_ERROR_CODE, PREFERRED_EMAIL_ERROR_TYPE } from '../constants/user-profile.constants';

/**
 * Minimal user identity fields for displaying initials
 */
export interface UserInitialsInput {
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Combined user profile and details
 */
export interface CombinedProfile {
  user: UserProfile;
  profile: UserMetadata | null;
}

/**
 * User email entry from auth-service
 */
export interface UserEmail {
  email: string;
  verified: boolean;
  user_id?: string;
}

/**
 * Combined email management data from auth-service
 */
export interface EmailManagementData {
  primary_email: string;
  alternate_emails: UserEmail[];
}

/**
 * Preferred meeting-invitation email from the meeting-service.
 * Both fields are null when the user has no explicit override (i.e. meeting invitations
 * fall back to the primary email).
 */
export interface MeetingInviteEmail {
  email_id: string | null;
  email: string | null;
}

// Derived from PREFERRED_EMAIL_ERROR_TYPE (single source of truth shared with the runtime
// allow-list in asKnownErrorType). Not exhaustive forever — the meeting-service may add a value
// before self-serve knows about it — so callers must treat an unrecognized wire string as absent
// rather than trust it, see extractPreferredEmailError.
export type PreferredEmailErrorType = (typeof PREFERRED_EMAIL_ERROR_TYPE)[keyof typeof PREFERRED_EMAIL_ERROR_TYPE];

// Derived from PREFERRED_EMAIL_ERROR_CODE (single source of truth shared with the runtime checks
// in extractPreferredEmailError/classifyPreferredEmailError). The one case that needs finer
// resolution than `type` gives: "email not yet synced from Auth0 to SFDC" otherwise shares
// `type: 'unavailable'` with a generic outage.
export type PreferredEmailErrorCode = (typeof PREFERRED_EMAIL_ERROR_CODE)[keyof typeof PREFERRED_EMAIL_ERROR_CODE];

/**
 * Error reply from the meeting-service `preferred_email.get`/`.set` NATS RPCs. `type` and `code`
 * are optional because an older meeting-service deploy (or a malformed reply) may only send
 * `error` — see #2269/#2270. Self-serve currently classifies on `type`/`code` for the `set` path
 * only (see `classifyPreferredEmailError`); `get` failures are logged and treated as failure
 * regardless of `type`/`code`.
 */
export interface PreferredEmailErrorReply {
  error: string;
  type?: PreferredEmailErrorType;
  code?: PreferredEmailErrorCode;
}

/**
 * Email-settings state loaded as one unit. The address list and the meeting-invitation
 * preference must land together — a partially-loaded pair briefly guards the wrong
 * address (stale badge, stale delete guard).
 *
 * `invite: null` covers both "not loaded yet" and "confirmed no override" — `inviteLoadFailed`
 * is what distinguishes "unknown" from "confirmed none". Consumers must fail closed (block
 * delete/remove of any address) when `inviteLoadFailed` is true, since which address is actually
 * protected can't be determined.
 */
export interface EmailSettingsState {
  emails: EmailManagementData | null;
  invite: MeetingInviteEmail | null;
  inviteLoadFailed: boolean;
}

// Result of setting the preferred meeting-invitation email. `reason` maps a failure to an HTTP status:
// validation → 4xx; sync_pending (SFDC lag) and unavailable (transport) → 503; upstream → 502.
// `error` is the raw upstream message, retained for logging (not surfaced to end users).
export interface SetMeetingInviteResult {
  success: boolean;
  data?: MeetingInviteEmail;
  reason?: 'validation' | 'sync_pending' | 'unavailable' | 'upstream';
  error?: string;
}

/**
 * Request to send an OTP to a new email address (step 1 of add-email flow)
 */
export interface AddEmailRequest {
  email: string;
}

/**
 * Request to change user password
 */
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

/**
 * Request to send password reset email
 */
export interface PasswordResetRequest {
  email: string;
}

/**
 * Password strength analysis result
 */
export interface PasswordStrength {
  score: number; // 0-4 (weak to strong)
  label: 'weak' | 'fair' | 'good' | 'strong';
  requirements: {
    minLength: boolean;
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasNumbers: boolean;
    hasSpecialChars: boolean;
    meetsCriteria: boolean; // true if 3 of 4 character types are present
  };
}

/**
 * User metadata object for profile updates
 */
export interface UserMetadata {
  name?: string;
  given_name?: string;
  family_name?: string;
  job_title?: string;
  organization?: string;
  organization_domain?: string;
  country?: string;
  state_province?: string;
  city?: string;
  address?: string;
  postal_code?: string;
  phone_number?: string;
  t_shirt_size?: string;
  bio?: string;
  picture?: string;
  zoneinfo?: string;
}

/**
 * Frontend request for updating user profile via NATS
 * Only contains user_metadata - backend extracts token/user_id from OIDC
 */
export interface ProfileUpdateRequest {
  user_metadata: UserMetadata;
}

/**
 * User metadata update request payload
 */
export interface UserMetadataUpdateRequest {
  token: string;
  username: string;
  user_metadata?: UserMetadata;
}

/**
 * User metadata update response payload
 */
export interface UserMetadataUpdateResponse {
  success: boolean;
  username: string;
  message?: string;
  updated_fields?: string[];
  data?: UserMetadata;
  error?: string;
}

/**
 * Response payload for profile picture upload. The server only sends this on success, and only
 * once it has a CDN URL to persist — a null `public_url` (CDN unconfigured) is rejected upstream
 * as a config error before a response is ever built, so `public_url` is never null here in
 * practice. The type stays nullable to mirror ObjectStoreService.uploadProfilePicture's return
 * shape, which callers with a CDN dependency (like this one) must treat as a hard requirement.
 */
export interface ProfilePictureUploadResponse {
  success: boolean;
  public_url: string | null;
}
