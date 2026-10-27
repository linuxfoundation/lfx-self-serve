// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { defer, EMPTY, expand, fromEvent, map, Observable, of, startWith, switchMap, timer, catchError } from 'rxjs';

/** Outcome of one poll attempt. `failures` counts consecutive failures so a caller can show "Reconnecting". */
export type VisibilityPollEvent<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: unknown; failures: number };

export interface VisibilityPollOptions<T> {
  /** Delay between a successful poll and the next. */
  intervalMs: number;
  /** First retry delay after a failure; doubles per consecutive failure. */
  backoffBaseMs: number;
  /** Ceiling for the retry delay. */
  backoffMaxMs: number;
  /** Returning false after a successful poll stops the loop until the tab next becomes visible. */
  shouldContinue?: (value: T) => boolean;
}

/** Capped exponential backoff: base, 2×base, 4×base … never above `maxMs`. */
export function pollBackoffDelayMs(failures: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
}

/**
 * Visibility-aware poller: `timer` + sequential `expand`, so a slow response can never overlap the next request.
 * @description Polls immediately, then every `intervalMs` while `document.visibilityState === 'visible'`. A hidden tab
 * cancels the pending timer and any in-flight request; the next `visible` event fetches immediately and restarts the
 * loop (including after `shouldContinue` stopped it — that is how a reopened vote is noticed). Failures never end the
 * stream: they emit an `error` event and retry on capped exponential backoff, so recovery needs no reload.
 *
 * Browser-only: callers must not subscribe during SSR (`document` is passed in, never read from a global, so a server
 * render that never subscribes never touches it). Unsubscribe (e.g. `takeUntilDestroyed`) to stop all timers.
 */
export function createVisibilityPoll<T>(doc: Document, fetch: () => Observable<T>, options: VisibilityPollOptions<T>): Observable<VisibilityPollEvent<T>> {
  const { intervalMs, backoffBaseMs, backoffMaxMs, shouldContinue = () => true } = options;

  const visible$ = fromEvent(doc, 'visibilitychange').pipe(
    startWith(null),
    map(() => doc.visibilityState === 'visible')
  );

  const loop = (): Observable<VisibilityPollEvent<T>> => {
    let failures = 0;
    const attempt = (): Observable<VisibilityPollEvent<T>> =>
      defer(fetch).pipe(
        map((value): VisibilityPollEvent<T> => {
          failures = 0;
          return { kind: 'ok', value };
        }),
        catchError((error) => of<VisibilityPollEvent<T>>({ kind: 'error', error, failures: ++failures }))
      );

    return attempt().pipe(
      expand((event) => {
        if (event.kind === 'ok' && !shouldContinue(event.value)) return EMPTY;
        const delay = event.kind === 'ok' ? intervalMs : pollBackoffDelayMs(event.failures, backoffBaseMs, backoffMaxMs);
        return timer(delay).pipe(switchMap(attempt));
      })
    );
  };

  return visible$.pipe(switchMap((visible) => (visible ? loop() : EMPTY)));
}
