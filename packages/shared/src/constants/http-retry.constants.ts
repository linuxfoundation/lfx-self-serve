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

/**
 * Minimum remaining wall-clock budget (ms) for issuing another upstream request inside a
 * budget-bounded retry/poll loop (GH-1637). Below this floor the request cannot complete a
 * round trip before the deadline, so it would abort as a 408 — masking the error the loop
 * actually observed (e.g. a 403) and skipping that error's handling. Loops re-check the budget
 * after a truncated backoff and, under this floor, surface the last real error instead of
 * issuing a request that cannot complete. Sized generously above a typical in-cluster round
 * trip; it only skips requests that were already doomed.
 */
export const MIN_VIABLE_REQUEST_BUDGET_MS = 1000;
