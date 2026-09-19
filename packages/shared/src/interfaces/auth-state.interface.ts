// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Flow C's (profile Auth0 Management API) CSRF state, stored in its own Valkey record keyed by the
 * state nonce itself — see #1938. Kept out of `req.appSession` because express-openid-connect
 * blind-overwrites the whole session on every response, so a concurrent request finishing after
 * `/auth/start` can silently drop the nonce it wrote there.
 */
export interface AuthStateRecord {
  /** Auth0 `sub` of the user the nonce was issued to — re-checked at the callback. */
  sub: string;
  /** Validated in-app return path; absent means the caller's default. */
  returnTo?: string;
  /** Epoch ms the nonce was issued, for diagnostics only — expiry is enforced by the Valkey TTL. */
  createdAt: number;
}
