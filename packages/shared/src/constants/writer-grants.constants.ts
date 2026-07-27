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
 * isn't available (LFXV2-2857) — unlike {@link IDLE_SWEEP_TIMEOUT_MS}, this is an unconditional
 * schedule with no idle detection behind it, so it stays short rather than reusing that ceiling.
 */
export const IDLE_SWEEP_FALLBACK_DELAY_MS = 2000;
