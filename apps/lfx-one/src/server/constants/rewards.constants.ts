// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Service name used in structured logs and `MicroserviceError` metadata for the rewards service. */
export const REWARDS_SERVICE_NAME = 'rewards_service';

/** Bounded user-service page size used to require one exact impersonation target. */
export const REWARD_SUBJECT_LOOKUP_PAGE_SIZE = 2;

/** User-service page size used to retrieve a complete promotion collection. */
export const REWARD_PROMOTIONS_PAGE_SIZE = 500;

/**
 * Upstream user-service uses dates in the year 2050 as a "never expires" sentinel.
 * Normalize them to empty string at the boundary so consumers do not need to know.
 */
export const NEVER_EXPIRES_YEAR_PREFIX = '2050-';
