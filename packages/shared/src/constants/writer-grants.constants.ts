// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Bound (ms) for `WriterGrantsService`'s deferred full sweep (LFXV2-2857): passed as
 * `requestIdleCallback`'s `timeout` so a backgrounded/busy tab can't defer it indefinitely, and
 * as the delay for the `setTimeout` fallback when `requestIdleCallback` isn't available.
 */
export const IDLE_SWEEP_FALLBACK_DELAY_MS = 2000;
