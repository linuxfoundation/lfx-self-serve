// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

/**
 * Strips the auth provider prefix (e.g. "auth0|") from a username/sub claim.
 * Returns the raw username if no prefix is present.
 */
export function stripAuthPrefix(username: string): string {
  const pipeIndex = username.indexOf('|');
  return pipeIndex !== -1 ? username.substring(pipeIndex + 1) : username;
}

/**
 * Gets the username from the current authentication context
 * Supports both Authelia token authentication and OIDC claims authentication
 */
export async function getUsernameFromAuth(req: Request): Promise<string | null> {
  // Check if we have a bearer token
  const token = req.bearerToken;
  if (token) {
    // If token starts with "authelia", query the authelia userinfo endpoint
    if (token.startsWith('authelia')) {
      return req.oidc?.user?.['preferred_username'] || null;
    }
  }

  // Fall back to OIDC claims for non-authelia tokens
  return req.oidc?.user?.['sub'] || null;
}

/**
 * Checks if two usernames match, stripping any auth provider prefix before comparing.
 * e.g. "auth0|asitha" matches "asitha".
 */
export function usernameMatches(authUsername: string, storedUsername: string): boolean {
  return stripAuthPrefix(authUsername) === stripAuthPrefix(storedUsername);
}
