// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { LfxAccessTokenClaims, AuditUserProfile } from '@lfx-one/shared/interfaces';

/**
 * Strips the auth provider prefix (e.g. "auth0|") from a username/sub claim.
 * Returns the raw username if no prefix is present.
 */
export function stripAuthPrefix(username: string): string {
  const pipeIndex = username.indexOf('|');
  return pipeIndex !== -1 ? username.substring(pipeIndex + 1) : username;
}

/**
 * Normalizes a stored display-name value coming from upstream services. When the
 * upstream captured the raw OIDC `sub` (e.g. "auth0|manishdixitlfx") instead of a
 * friendly name claim, strip the provider prefix so the table shows "manishdixitlfx"
 * rather than the OAuth-style identifier. Returns undefined for empty / missing input.
 *
 * Note: this does not resolve to a full display name (e.g. "Manish Dixit"); doing so
 * requires a user-profile lookup which lives in a separate service.
 */
export function cleanUserDisplayName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = stripAuthPrefix(value).trim();
  return cleaned || undefined;
}

/**
 * Resolves a human-friendly Shared By label from an upstream audit user object,
 * with fallbacks for partial profiles and legacy flat username fields.
 */
export function resolveAuditUserDisplayName(user?: AuditUserProfile | null, legacyUsername?: string | null): string | undefined {
  const name = user?.name?.trim();
  if (name) return name;
  const fromUser = cleanUserDisplayName(user?.username);
  if (fromUser) return fromUser;
  return cleanUserDisplayName(legacyUsername);
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
  return getEffectiveUsername(req);
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
 * During impersonation, returns the target user's email from the impersonation session,
 * or null when the target has no stored email — it never falls back to the impersonator's
 * own OIDC email. Otherwise returns the OIDC session user's email.
 */
export function getEffectiveEmail(req: Request): string | null {
  // Never fall back to the impersonator's OIDC email: the stored target email can be
  // empty, so return null in that gap and let callers handle "no primary email".
  if (isImpersonating(req)) {
    return (req.appSession?.['impersonationUser']?.email as string)?.toLowerCase() || null;
  }
  return (req.oidc?.user?.['email'] as string)?.toLowerCase() || null;
}

/**
 * Gets the REAL (impersonator's own) email, deliberately ignoring impersonation state — the one
 * identity getter in this file that does NOT resolve to the impersonation target. `req.oidc.user`
 * is always the actual authenticated user's OIDC session, impersonation or not (impersonation is
 * layered on top via `req.appSession`, never by replacing `req.oidc.user`), so this is just
 * `getEffectiveEmail`'s non-impersonating branch, unconditionally.
 *
 * Use this only where the real actor's identity — not the target's — must be attributed for a
 * genuinely externally-visible, hard-to-retract action (e.g. weekly-brief mailing-list share,
 * LFXV2-3093). Most callers want `getEffectiveEmail` instead.
 */
export function getRealEmail(req: Request): string | null {
  return (req.oidc?.user?.['email'] as string)?.toLowerCase() || null;
}

/**
 * Gets the effective username for the current request context.
 * During impersonation, returns the target user's username from the impersonation session,
 * or null when the target has no stored username — it never falls back to the impersonator's
 * own OIDC username. Otherwise returns the OIDC session user's username/nickname.
 */
export function getEffectiveUsername(req: Request): string | null {
  // Never fall back to the impersonator's OIDC username: the stored target username can
  // be empty, so return null in that gap and let callers handle the missing identity.
  if (isImpersonating(req)) {
    return (req.appSession?.['impersonationUser']?.username as string) || null;
  }
  // `preferred_username` is the Authelia LFID-username fallback (#912) — additive last, so Auth0
  // (nickname/username) precedence is unchanged. Mirrors `getUsernameFromAuth`.
  return (req.oidc?.user?.['nickname'] as string) || (req.oidc?.user?.['username'] as string) || (req.oidc?.user?.['preferred_username'] as string) || null;
}

/**
 * Gets the effective sub (user ID) for the current request context.
 * During impersonation, returns the target user's sub from the impersonation session,
 * or null when unset — it never falls back to the impersonator's own OIDC sub.
 * Otherwise returns the OIDC session user's sub.
 *
 * @deprecated Prefer getEffectiveUsername for APIs that accept the LFID username.
 * The Auth0 sub claim is being phased out across backend APIs in favour of the LFID
 * username. Only use this function for call sites whose upstream handler has not yet
 * been migrated to accept a username.
 */
export function getEffectiveSub(req: Request): string | null {
  // Never fall back to the impersonator's OIDC sub: return the target's sub or null.
  if (isImpersonating(req)) {
    return (req.appSession?.['impersonationUser']?.sub as string) || null;
  }
  return (req.oidc?.user?.['sub'] as string) || null;
}

/**
 * Gets the effective name for the current request context.
 * During impersonation, returns the target user's name from the impersonation session.
 * Otherwise returns the OIDC session user's name.
 */
export function getEffectiveName(req: Request): string | null {
  if (isImpersonating(req)) {
    return (req.appSession?.['impersonationUser']?.name as string) || (req.appSession?.['impersonationUser']?.username as string) || null;
  }
  return (req.oidc?.user?.['name'] as string) || null;
}

/**
 * Returns true when the current request is running under an active impersonation session.
 *
 * Uses the authentication-time decision when the auth middleware has populated it, keeping
 * identity and write guards stable if the session expiry passes later in the same request.
 * Direct unit callers without the marker fall back to validating the session.
 * Use this to switch profile reads to the target's identity and to block profile writes (which
 * can only ever act on the real user's account).
 */
export function isImpersonating(req: Request): boolean {
  if (typeof req.impersonationActive === 'boolean') {
    return req.impersonationActive;
  }

  const token = req.appSession?.['impersonationToken'];
  const expiresAt = req.appSession?.['impersonationExpiresAt'];
  return typeof token === 'string' && !!token && typeof expiresAt === 'number' && Date.now() < expiresAt && !!req.appSession?.['impersonationUser'];
}

/**
 * Resolves the REAL (impersonator's own) bearer token, even while impersonating — for the same
 * narrow class of caller as `getRealEmail` (a write that must be authorized and attributed to the
 * actual actor, not the impersonation target).
 *
 * `req.bearerToken` is swapped to the impersonation token by `auth.middleware.ts` during
 * impersonation, but `req.oidc.accessToken` is never touched by that swap — it always reflects the
 * real user's own OIDC session. The catch: `auth.middleware.ts`'s normal refresh-if-expired logic
 * short-circuits before it runs whenever an impersonation token is active, so `req.oidc.accessToken`
 * can legitimately be expired by the time this is called on a long-lived impersonation session
 * (impersonation tokens can live up to ~24h; ordinary access tokens are typically shorter-lived).
 * This refreshes it itself when needed, mirroring `extractBearerToken`'s own refresh step.
 *
 * Returns null when there is no real session token to resolve, or the refresh attempt fails —
 * callers MUST treat null as "cannot safely attribute this action" and fail closed, never falling
 * back to the impersonation token.
 *
 * Deliberately NOT gated on `isImpersonating(req)` — that's a live, time-gated check re-evaluated
 * on every call, but `req.bearerToken` was set ONCE by `extractBearerToken` at the START of the
 * request. If impersonation was active when the middleware ran (setting `req.bearerToken` to the
 * impersonation token) but `impersonationExpiresAt` elapses before this runs later in the same
 * request — plausible for a caller like `shareBrief`, which awaits several upstream calls first —
 * `isImpersonating(req)` flips to false while `req.bearerToken` is still the STALE impersonation
 * token. Gating on it here would return that impersonation token as if it were the real one,
 * reintroducing the exact LFXV2-3093 misattribution in a narrow race window. Gated instead on the
 * mere presence of a stored impersonation token — a time-independent signal that `req.bearerToken`
 * might not be the real token, regardless of whether that token has since expired.
 */
export async function resolveRealAccessToken(req: Request): Promise<string | null> {
  const hadImpersonationToken = typeof req.appSession?.['impersonationToken'] === 'string' && !!req.appSession['impersonationToken'];
  if (!hadImpersonationToken) {
    return req.bearerToken ?? null;
  }
  const accessToken = req.oidc?.accessToken;
  if (!accessToken) {
    return null;
  }
  if (!accessToken.isExpired()) {
    return accessToken.access_token ?? null;
  }
  try {
    const refreshed = await accessToken.refresh();
    return refreshed?.access_token ?? null;
  } catch {
    return null;
  }
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
