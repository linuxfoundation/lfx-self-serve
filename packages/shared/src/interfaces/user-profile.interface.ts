// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
