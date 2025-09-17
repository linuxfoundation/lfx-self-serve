// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * User profile data from public.users table
 */
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
 * Profile details data from public.profiles table
 */
export interface ProfileDetails {
  id: number;
  user_id: string; // UUID reference to auth.users.id
  title: string | null;
  organization: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  zipcode: string | null;
  phone_number: string | null;
  tshirt_size: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Combined user profile and details
 */
export interface CombinedProfile {
  user: UserProfile;
  profile: ProfileDetails | null;
}

/**
 * Update request for user profile data
 */
export interface UpdateUserProfileRequest {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  // Note: email updates may require special handling/verification
}

/**
 * Update request for profile details data
 */
export interface UpdateProfileDetailsRequest {
  title?: string | null;
  organization?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  address?: string | null;
  zipcode?: string | null;
  phone_number?: string | null;
  tshirt_size?: string | null;
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
