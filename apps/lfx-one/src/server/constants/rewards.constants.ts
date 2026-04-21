// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Timeout for outbound calls to the user-service via the API gateway. */
export const API_GW_TIMEOUT_MS = 30_000;

/** Service name used in structured logs and `MicroserviceError` metadata for the rewards service. */
export const REWARDS_SERVICE_NAME = 'rewards_service';

/** Maximum number of bytes of an upstream error body to include in logs / errors. */
export const UPSTREAM_ERROR_BODY_LIMIT = 500;

/**
 * Upstream user-service uses dates in the year 2050 as a "never expires" sentinel.
 * Normalize them to empty string at the boundary so consumers do not need to know.
 */
export const NEVER_EXPIRES_YEAR_PREFIX = '2050-';
