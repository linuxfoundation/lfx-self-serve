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

/**
 * Hard ceiling (ms) on `ProjectService.getWriterSummary()` — `WriterGrantsService`'s bootstrap
 * fast path (LFXV2-2857). Without a bound, a hung request never settles, which means the
 * `finalize` that schedules the deferred sweep never fires either — an indefinitely-stalled fast
 * path would silently starve the *only* other path that resolves inherited writer access for the
 * rest of the session. Generous relative to the endpoint's typical latency (sub-second) but well
 * under `IDLE_SWEEP_TIMEOUT_MS`, so there's still headroom left for the sweep afterward.
 */
export const WRITER_SUMMARY_TIMEOUT_MS = 10000;
