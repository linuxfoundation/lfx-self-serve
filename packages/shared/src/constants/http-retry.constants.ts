// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Delay (ms) before retrying a transient HTTP failure (network drop, 429, 5xx) — used by
 * `retryTransientHttpError` in `apps/lfx-one/src/app/shared/utils/http-error.utils.ts`, the one
 * retry operator every transient-error retry in the app shares (`ProjectService.getProjects`,
 * `ProjectService.getWriterSummary`, `MeetupsListComponent`). Retry *count* is a per-call-site
 * argument to that operator and isn't part of this constant.
 */
export const TRANSIENT_RETRY_DELAY_MS = 1000;
