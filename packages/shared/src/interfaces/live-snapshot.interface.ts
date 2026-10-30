// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Signal } from '@angular/core';
import type { Observable } from 'rxjs';

/** The latest value a live poll returned, stamped with the browser clock when it landed. */
export interface LiveSnapshotValue<T> {
  value: T;
  receivedAtMs: number;
}

/** Inputs for createLiveSnapshot. */
export interface LiveSnapshotOptions<T> {
  /** Identity of the polled resource; a null key pauses polling, a changed key drops the previous snapshot. */
  key: Signal<string | null>;
  fetch: (key: string) => Observable<T>;
  doc: Document;
  intervalMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** False (the server) builds the signals but never subscribes, so nothing touches `document`. Defaults to true. */
  enabled?: boolean;
}

/** Result of createLiveSnapshot. */
export interface LiveSnapshot<T> {
  snapshot: Signal<LiveSnapshotValue<T> | null>;
  /** Consecutive failed polls since the last success (0 when healthy). */
  failures: Signal<number>;
  /** Restarts the poll loop and returns the new generation; `resetFailures` also clears the failure count. */
  restart: (resetFailures?: boolean) => number;
  /** Generation of the poll that last succeeded, -1 before any. A restart settles once `landedGeneration() >= restart()`. */
  landedGeneration: Signal<number>;
}

/** Inputs for createHeldResults. */
export interface HeldResultsOptions<R> {
  /** Non-null only while results are wanted (for example while a vote is ended); each new non-null key loads once. */
  key: Signal<string | null>;
  load: (key: string) => Observable<R>;
  /** True when the payload is a placeholder that will be replaced, so it is re-requested after `retryMs`. */
  isHeld: (results: R) => boolean;
  retryMs: number;
  /** Cap on requests for one key, including the first. */
  maxAttempts: number;
  /** Logged with the error when a load fails. */
  errorMessage: string;
}

/** Result of createHeldResults. */
export interface HeldResults<R> {
  results: Signal<R | null>;
  loading: Signal<boolean>;
  error: Signal<boolean>;
}
