// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Decoded claims from an LFX access token (JWT payload).
 */
export interface LfxAccessTokenClaims {
  sub: string;
  'http://lfx.dev/claims/email'?: string;
  'http://lfx.dev/claims/username'?: string;
  'http://lfx.dev/claims/can_impersonate'?: boolean;
  exp?: number;
  aud?: string | string[];
  iss?: string;
  [key: string]: unknown;
}

/**
 * Target user information during impersonation
 */
export interface ImpersonationUser {
  sub: string;
  email: string;
  username: string;
  name?: string;
  picture?: string;
}

/**
 * Information about the admin performing impersonation
 */
export interface Impersonator {
  sub: string;
  email: string;
  name: string;
}

/**
 * Request body for starting impersonation
 */
export interface ImpersonationStartRequest {
  targetUser: string;
}

/**
 * Response for impersonation status check
 */
export interface ImpersonationStatusResponse {
  impersonating: boolean;
  targetUser?: ImpersonationUser;
  impersonator?: Impersonator;
}

/**
 * Response after successfully starting impersonation
 */
export interface ImpersonationStartResponse {
  impersonating: boolean;
  targetUser: ImpersonationUser;
}
