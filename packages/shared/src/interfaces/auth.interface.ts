// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * User profile information from Auth0/LFX SSO
 * @description Complete user data structure from authentication provider
 */
export interface User {
  /** Session identifier */
  sid: string;
  /** LFX SSO username claim (namespaced) */
  'https://sso.linuxfoundation.org/claims/username': string;
  /** User's first name from profile */
  given_name: string;
  /** User's last name from profile */
  family_name: string;
  /** User's nickname/display name */
  nickname: string;
  /** Full display name */
  name: string;
  /** Profile picture URL */
  picture: string;
  /** Timestamp of last profile update */
  updated_at: string;
  /** Primary email address */
  email: string;
  /** Whether email has been verified */
  email_verified: boolean;
  /** Subject identifier (unique user ID) */
  sub: string;
  /** Alternative first name field */
  first_name?: string;
  /** Alternative last name field */
  last_name?: string;
  /** Alternative username field */
  username?: string;
  /** Internal user ID */
  id?: string;
  /** Account creation timestamp */
  created_at?: string;
}

/**
 * Authentication context for the application
 * @description Current authentication state and user information
 */
export interface AuthContext {
  /** Whether user is currently authenticated */
  authenticated: boolean;
  /** User profile data (null if not authenticated) */
  user: User | null;
}

/**
 * Interface for M2M token response from Auth0
 * @description Response structure for machine-to-machine authentication
 */
export interface M2MTokenResponse {
  /** The access token for API calls */
  access_token: string;
  /** Type of token (typically "Bearer") */
  token_type: string;
  /** Token expiration time in seconds */
  expires_in: number;
  /** Optional scope for the token */
  scope?: string;
}
