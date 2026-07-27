// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Delay (ms) before retrying a transient HTTP failure (network drop, 429, 5xx) — see
 * `isTransientHttpError` in `apps/lfx-one/src/app/shared/utils/http-error.utils.ts`. Shared so
 * call sites that agree on this delay (e.g. `ProjectService.getProjects`,
 * `MeetupsListComponent`) stay in sync structurally rather than by comment. Retry *count* is a
 * per-call-site choice and isn't part of this constant.
 */
export const TRANSIENT_RETRY_DELAY_MS = 1000;
