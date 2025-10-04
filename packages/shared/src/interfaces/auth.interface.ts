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

/**
 * Options for bearer token extraction middleware
 * @description Configuration for how bearer tokens should be handled in requests
 */
export interface BearerTokenOptions {
  /** Whether the token is optional (default: false) */
  optional?: boolean;
}

/**
 * Route type for authentication middleware
 * @description Differentiates between SSR routes and API endpoints
 */
export type RouteType = 'ssr' | 'api';

/**
 * Authentication level for authentication middleware
 * @description Different levels of authentication requirements
 */
export type AuthLevel = 'required' | 'optional' | 'public';

/**
 * Authentication decision actions
 * @description Actions the middleware can take based on authentication status
 */
export type AuthAction = 'allow' | 'redirect' | 'error' | 'logout';

/**
 * Route authentication configuration
 * @description Defines authentication requirements for specific route patterns
 */
export interface RouteAuthConfig {
  /** Route pattern (string prefix or regex) */
  pattern: string | RegExp;
  /** Route type - SSR routes redirect on auth failure, API routes return errors */
  type: RouteType;
  /** Authentication level required */
  auth: AuthLevel;
  /** Whether bearer token is required (for API routes) */
  tokenRequired?: boolean;
}

/**
 * Authentication decision result
 * @description Result of authentication decision making process
 */
export interface AuthDecision {
  /** Action to take */
  action: AuthAction;
  /** Redirect URL if action is 'redirect' */
  redirectUrl?: string;
  /** Error type if action is 'error' */
  errorType?: 'authentication' | 'authorization';
  /** HTTP status code if action is 'error' */
  statusCode?: number;
}

/**
 * Bearer token extraction result
 * @description Result of bearer token extraction attempt
 */
export interface TokenExtractionResult {
  /** Whether token extraction was successful */
  success: boolean;
  /** Whether user needs to be logged out due to refresh failure */
  needsLogout: boolean;
}

/**
 * Authentication middleware result
 * @description Result of authentication check and token extraction
 */
export interface AuthMiddlewareResult {
  /** Matched route configuration */
  route: RouteAuthConfig;
  /** Whether user is authenticated */
  authenticated: boolean;
  /** Whether bearer token is available */
  hasToken: boolean;
  /** Whether user needs to be logged out */
  needsLogout?: boolean;
}

/**
 * Configuration for authentication middleware
 * @description Complete configuration for all authentication scenarios
 */
export interface AuthConfig {
  /** Route-specific configurations */
  routes: RouteAuthConfig[];
  /** Default authentication level for unmatched routes */
  defaultAuth: AuthLevel;
  /** Default route type for unmatched routes */
  defaultType: RouteType;
}

/**
 * Error response from email to username NATS lookup
 * @description Response structure when user email is not found
 */
export interface EmailToUsernameErrorResponse {
  /** Success flag - always false for error responses */
  success: false;
  /** Error message describing the failure */
  error: string;
}
