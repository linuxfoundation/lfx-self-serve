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

// Training `Type` values surfaced publicly (myprofile parity): exam/subscription/bundle rows are
// dropped from trainings; completed certifications surface via `certification_activities`.
export const PUBLIC_PROFILE_TRAINING_TYPE_ALLOWLIST: ReadonlySet<string> = new Set(['E-Learning', 'Instructor-Led', 'edX']);

/** Enrollment `Status` values kept on the public trainings list (myprofile parity). */
export const PUBLIC_PROFILE_TRAINING_STATUS_ALLOWLIST: ReadonlySet<string> = new Set(['Enrolled', 'Completed', 'Started', 'Not started']);

/** Certification `Status` values kept on the public certifications list — completed only (myprofile parity). */
export const PUBLIC_PROFILE_CERTIFICATION_STATUS_ALLOWLIST: ReadonlySet<string> = new Set(['Completed']);

// Epoch-zero placeholder for a missing date, matched with `startsWith` (tighter than myprofile's
// `includes`). Training dates are blanked to ''; certifications drop such a StartDate (and absent ones).
export const PUBLIC_PROFILE_EPOCH_PLACEHOLDER = '1970';
