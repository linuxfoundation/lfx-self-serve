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
 * Backoff schedule (ms) for `retryPropagationLag` in
 * `apps/lfx-one/src/app/shared/utils/http-error.utils.ts` — retries a 403/404 that may be the
 * ITX index / FGA tuple for an entity this user just created still catching up with the write,
 * rather than a genuine permission/not-found response (#501). Each entry is the delay before that
 * attempt; the array length is the retry count, so trimming/extending the schedule changes both
 * at once.
 */
export const PROPAGATION_LAG_RETRY_DELAYS_MS = [1000, 2000];

/**
 * Window (ms) after a successful `MeetingService.createMeeting` during which a
 * `getMeetingDetail` read of that same meeting id is treated as a possible propagation-lag
 * 403/404 and retried via `retryPropagationLag` (#501). Bounded well past the retry
 * schedule's own total (`PROPAGATION_LAG_RETRY_DELAYS_MS` sums to 3s) so the window covers
 * the create response, the client-side navigation to the edit page, and the retry schedule
 * itself — not so long that a meeting the user genuinely loses access to minutes later still
 * pays the retry delay before its denial surfaces. Reads of any other meeting id never match
 * this window, so an unrelated or stale 403/404 still fails immediately.
 */
export const RECENTLY_CREATED_MEETING_WINDOW_MS = 15_000;

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
