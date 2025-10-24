// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
 * User email data from public.user_emails table
 */
export interface UserEmail {
  id: string;
  user_id: string;
  email: string;
  is_primary: boolean;
  is_verified: boolean;
  verification_token: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Email preferences data from public.email_preferences table
 */
export interface EmailPreferences {
  id: string;
  user_id: string;
  meeting_email_id: string | null;
  notification_email_id: string | null;
  billing_email_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Request to add a new email address
 */
export interface AddEmailRequest {
  email: string;
}

/**
 * Request to update email preferences
 */
export interface UpdateEmailPreferencesRequest {
  meeting_email_id?: string | null;
  notification_email_id?: string | null;
  billing_email_id?: string | null;
}

/**
 * Combined email management data
 */
export interface EmailManagementData {
  emails: UserEmail[];
  preferences: EmailPreferences | null;
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
 * Two-factor authentication settings
 */
export interface TwoFactorSettings {
  enabled: boolean;
  method: 'app' | 'sms' | 'email' | null;
  backup_codes_count: number;
  last_used: string | null;
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
  country?: string;
  state_province?: string;
  city?: string;
  address?: string;
  postal_code?: string;
  phone_number?: string;
  t_shirt_size?: string;
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
