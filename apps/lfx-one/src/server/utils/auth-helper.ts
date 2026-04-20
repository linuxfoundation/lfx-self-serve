// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { LfxAccessTokenClaims } from '@lfx-one/shared/interfaces';

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
  return getEffectiveSub(req);
}

/**
 * Checks if two usernames match, stripping any auth provider prefix before comparing.
 * e.g. "auth0|asitha" matches "asitha".
 */
export function usernameMatches(authUsername: string, storedUsername: string): boolean {
  return stripAuthPrefix(authUsername) === stripAuthPrefix(storedUsername);
}

/**
 * Gets the effective email for the current request context.
 * During impersonation, returns the target user's email from the impersonation session.
 * Otherwise returns the OIDC session user's email.
 */
export function getEffectiveEmail(req: Request): string | null {
  if (req.appSession?.['impersonationUser']?.email) {
    return (req.appSession['impersonationUser'].email as string).toLowerCase();
  }
  return (req.oidc?.user?.['email'] as string)?.toLowerCase() || null;
}

/**
 * Gets the effective username for the current request context.
 * During impersonation, returns the target user's username from the impersonation session.
 * Otherwise returns the OIDC session user's username/nickname.
 */
export function getEffectiveUsername(req: Request): string | null {
  if (req.appSession?.['impersonationUser']?.username) {
    return req.appSession['impersonationUser'].username as string;
  }
  return (req.oidc?.user?.['nickname'] as string) || (req.oidc?.user?.['username'] as string) || null;
}

/**
 * Gets the effective sub (user ID) for the current request context.
 * During impersonation, returns the target user's sub from the impersonation session.
 * Otherwise returns the OIDC session user's sub.
 */
export function getEffectiveSub(req: Request): string | null {
  if (req.appSession?.['impersonationUser']?.sub) {
    return req.appSession['impersonationUser'].sub as string;
  }
  return (req.oidc?.user?.['sub'] as string) || null;
}

/**
 * Gets the effective name for the current request context.
 * During impersonation, returns the target user's name from the impersonation session.
 * Otherwise returns the OIDC session user's name.
 */
export function getEffectiveName(req: Request): string | null {
  if (req.appSession?.['impersonationUser']) {
    return (req.appSession['impersonationUser'].name as string) || (req.appSession['impersonationUser'].username as string) || null;
  }
  return (req.oidc?.user?.['name'] as string) || null;
}

/**
 * Decodes the payload from a JWT token without verifying the signature.
 * Returns null if the token is malformed or cannot be decoded.
 */
export function decodeJwtPayload(token: string): LfxAccessTokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

/**
 * Clears all impersonation-related data from the request session.
 */
export function clearImpersonationSession(req: Request): void {
  if (!req.appSession) {
    return;
  }
  delete req.appSession['impersonationToken'];
  delete req.appSession['impersonationExpiresAt'];
  delete req.appSession['impersonationUser'];
  delete req.appSession['impersonator'];
  delete req.appSession['impersonationPersonaContext'];
}
