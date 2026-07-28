// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Floor (ms) `WriterGrantsService` waits before even attempting `requestIdleCallback` for its
 * deferred full sweep (LFXV2-2857). `requestIdleCallback` has no minimum-delay guarantee of its
 * own — it can fire on the very next idle frame, which can be essentially immediately after the
 * fast path's XHR completes (processing a response typically leaves the main thread idle right
 * away). Datadog RUM's view-activity tracking only considers a view "done loading" after a settle
 * window with no new requests, and restarts that window when another request starts — so an
 * unfloored `requestIdleCallback` can fire inside that window and pull the deferred sweep's XHR
 * back into `@view.loading_time`, reproducing the exact regression this ticket fixes. This floor
 * exists to give that window a chance to close first; `IDLE_SWEEP_TIMEOUT_MS` below is a ceiling
 * on top of it, not a substitute for it.
 */
export const IDLE_SWEEP_MIN_DELAY_MS = 2000;

/**
 * `requestIdleCallback`'s `timeout` for `WriterGrantsService`'s deferred full sweep
 * (LFXV2-2857) — a ceiling, not a schedule, applied *after* {@link IDLE_SWEEP_MIN_DELAY_MS} has
 * already elapsed. On a genuinely idle page the sweep fires via normal idle detection well before
 * this is reached; it only bounds the worst case (a chronically busy/backgrounded tab that never
 * goes idle).
 *
 * Deliberately generous rather than short: on a busy foreground page, "busy main thread" tends
 * to correlate with "the view is still loading" (Datadog RUM's `@view.loading_time` window is
 * likely still open), so a short ceiling can force the sweep to fire while that window is still
 * open — reintroducing the exact regression this ticket fixes.
 */
export const IDLE_SWEEP_TIMEOUT_MS = 15000;

/**
 * `setTimeout` delay for `WriterGrantsService`'s deferred full sweep when `requestIdleCallback`
 * isn't available (LFXV2-2857) — e.g. Safari < 16.4. Unlike {@link IDLE_SWEEP_TIMEOUT_MS}, this
 * fires unconditionally with no idle detection behind it, so it carries the same
 * `@view.loading_time` re-entry risk that constant's ceiling is built to avoid. Kept short
 * anyway: this path only runs on a shrinking, already-legacy browser slice, and leaving
 * inherited-writer-grant resolution unresolved for 15s on every bootstrap there is the worse
 * trade-off. Revisit if that browser share stops being negligible.
 */
export const IDLE_SWEEP_FALLBACK_DELAY_MS = 2000;

/**
 * Hard ceiling (ms) on `ProjectService.getWriterSummary()` — `WriterGrantsService`'s bootstrap
 * fast path (LFXV2-2857). Bounds the whole retried call, not a single attempt: it must wrap
 * `retryTransientHttpError()` in the pipe (not sit upstream of it), otherwise each retry
 * resubscribes through a fresh timeout window instead of sharing this one. Without this bound, a
 * hung request never settles, which means the `finalize` that schedules the deferred sweep never
 * fires either — an indefinitely-stalled fast path would silently starve the *only* other path
 * that resolves inherited writer access for the rest of the session. Generous relative to the
 * endpoint's typical latency (sub-second), and this budget and {@link IDLE_SWEEP_TIMEOUT_MS} are
 * sequential, not shared — the sweep's own ceiling only starts once this one has already ended.
 */
export const WRITER_SUMMARY_TIMEOUT_MS = 10000;
