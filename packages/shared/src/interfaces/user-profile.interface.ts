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
