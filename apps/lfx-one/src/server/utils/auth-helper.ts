// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

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
