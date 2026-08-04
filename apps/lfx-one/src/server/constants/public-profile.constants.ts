// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Service name used in public profile logs and error contexts. */
export const PUBLIC_PROFILE_SERVICE_NAME = 'public_profile_service';

/**
 * Env var holding the S3 bucket base URL for public profile artifacts (no trailing slash).
 * No hard-coded default: when unset only this endpoint is inert (503), never serves wrong data.
 */
export const PUBLIC_PROFILES_BUCKET_URL_ENV = 'PUBLIC_PROFILES_BUCKET_URL';

/**
 * Timeout in milliseconds for the S3 fetch. Shorter than the API-gateway timeout — S3 is a
 * static object store, so a slow response indicates a problem rather than heavy compute.
 */
export const PUBLIC_PROFILE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Allowed username format in the public route. Anchored and restricted so it can be safely
 * interpolated into the S3 key without path traversal or probing unrelated keys.
 */
export const PUBLIC_PROFILE_USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
