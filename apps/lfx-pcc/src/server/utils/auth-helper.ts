// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

/**
 * Gets the username from the current authentication context
 * Supports both Authelia token authentication and OIDC claims authentication
 */
export async function getUsernameFromAuth(req: Request): Promise<string | null> {
  // Check if we have a bearer token
  const token = req.oidc?.accessToken?.access_token;
  if (token) {
    // If token starts with "authelia", query the authelia userinfo endpoint
    if (token.startsWith('authelia')) {
      try {
        const response = await fetch('https://auth.k8s.orb.local/api/oidc/userinfo', {
          headers: {
            Authorization: `Bearer ${token}`,
            ['Content-Type']: 'application/json',
          },
        });

        if (response.ok) {
          const userInfo = await response.json();
          return userInfo.preferred_username || userInfo.username || null;
        }
        req.log.warn(
          {
            status: response.status,
            statusText: response.statusText,
          },
          'Failed to fetch authelia userinfo'
        );
        return null;
      } catch (error) {
        req.log.warn(
          {
            error: error instanceof Error ? error.message : error,
          },
          'Error fetching authelia userinfo'
        );
        return null;
      }
    }
  }

  // Fall back to OIDC claims for non-authelia tokens
  return req.oidc?.user?.['https://sso.linuxfoundation.org/claims/username'] || null;
}
