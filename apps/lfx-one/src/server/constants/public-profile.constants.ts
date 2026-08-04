// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Service name used in public profile logs and error contexts. */
export const PUBLIC_PROFILE_SERVICE_NAME = 'public_profile_service';

/**
 * Environment variable holding the base URL of the S3 bucket that hosts per-user public
 * profile artifacts (`${bucket}/${username}.json`), published by the upstream
 * `GenerateUserPublicProfile` flow (no trailing slash). The bucket differs per environment and
 * is supplied entirely through this variable — the value is never hard-coded here.
 *
 * There is intentionally NO hard-coded default: a baked-in dev bucket would make a missing
 * production value silently serve dev data. When this var is unset, the app still boots and
 * only the public profile endpoint is inert (responds 503), so the misconfiguration surfaces
 * loudly and in isolation instead of leaking the wrong environment's data.
 */
export const PUBLIC_PROFILES_BUCKET_URL_ENV = 'PUBLIC_PROFILES_BUCKET_URL';

/**
 * Timeout in milliseconds for the S3 fetch. Shorter than the API-gateway timeout — S3 is a
 * static object store, so a slow response indicates a problem rather than heavy compute.
 */
export const PUBLIC_PROFILE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Username format allowed in the public profile route. Anchored and restricted to the
 * characters legacy usernames use, so the value can be safely interpolated into the S3 object
 * key without enabling path traversal or probing of unrelated keys.
 */
export const PUBLIC_PROFILE_USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
