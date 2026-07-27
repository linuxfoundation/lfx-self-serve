// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * `requestIdleCallback`'s `timeout` for `WriterGrantsService`'s deferred full sweep
 * (LFXV2-2857) — a ceiling, not a schedule. On a genuinely idle page the sweep fires via normal
 * idle detection well before this is reached; it only bounds the worst case (a chronically
 * busy/backgrounded tab that never goes idle).
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
