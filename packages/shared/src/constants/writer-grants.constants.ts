// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Bound (ms) for `WriterGrantsService`'s deferred full sweep (LFXV2-2857): passed as
 * `requestIdleCallback`'s `timeout` so a backgrounded/busy tab can't defer it indefinitely, and
 * as the delay for the `setTimeout` fallback when `requestIdleCallback` isn't available.
 *
 * Deliberately generous rather than short: on a busy foreground page, "busy main thread" tends
 * to correlate with "the view is still loading" (Datadog RUM's `@view.loading_time` window is
 * likely still open), so a short deadline can force the sweep to fire while that window is still
 * open — reintroducing the exact regression this ticket fixes. A long bound only changes the
 * worst-case (chronically busy/backgrounded tab) outcome; genuinely idle pages fire the sweep via
 * normal idle detection long before this deadline is ever reached.
 */
export const IDLE_SWEEP_FALLBACK_DELAY_MS = 15000;
