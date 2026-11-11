// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { VisibilityPollEvent, VisibilityPollOptions } from '@lfx-one/shared/interfaces';
import { defer, EMPTY, expand, fromEvent, map, merge, Observable, of, startWith, switchMap, timer, catchError } from 'rxjs';

/** Capped exponential backoff: base, 2×base, 4×base … never above `maxMs`. */
export function pollBackoffDelayMs(failures: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
}

/**
 * Visibility-aware poller: `timer` + sequential `expand`, so a slow response can never overlap the next request.
 * @description Polls immediately, then every `intervalMs` while `document.visibilityState === 'visible'`. A hidden tab
 * cancels the pending timer and any in-flight request; the next `visible` event fetches immediately and restarts the
 * loop (including after `shouldContinue` stopped it — that is how a reopened vote is noticed). Window focus also
 * re-reads while visible (optionally coalescing adjacent wake events). Initial reads and hidden cancellation are immediate. Failures never end the
 * stream: they emit an `error` event and retry on capped exponential backoff, so recovery needs no reload.
 * The fetch callback receives `false` on open/visible/focus and `true` on scheduled polls/retries;
 * callers that do not distinguish discovery from bounded polling can keep a no-argument callback.
 *
 * Browser-only: callers must not subscribe during SSR (`document` is passed in, never read from a global, so a server
 * render that never subscribes never touches it). Unsubscribe (e.g. `takeUntilDestroyed`) to stop all timers.
 */
export function createVisibilityPoll<T>(
  doc: Document,
  fetch: (poll: boolean) => Observable<T>,
  options: VisibilityPollOptions<T>
): Observable<VisibilityPollEvent<T>> {
  const { intervalMs, backoffBaseMs, backoffMaxMs, wakeDebounceMs = 0, shouldContinue = () => true } = options;

  const visibility = fromEvent(doc, 'visibilitychange');
  const wake = doc.defaultView ? merge(visibility, fromEvent(doc.defaultView, 'focus')) : visibility;
  const visible$ = wake.pipe(
    map(() => doc.visibilityState === 'visible'),
    switchMap((visible) => (!visible || !wakeDebounceMs ? of(visible) : timer(wakeDebounceMs).pipe(map(() => true)))),
    startWith(doc.visibilityState === 'visible')
  );

  const loop = (): Observable<VisibilityPollEvent<T>> => {
    let failures = 0;
    const attempt = (poll = false): Observable<VisibilityPollEvent<T>> =>
      defer(() => fetch(poll)).pipe(
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
        return timer(delay).pipe(switchMap(() => attempt(true)));
      })
    );
  };

  return visible$.pipe(switchMap((visible) => (visible ? loop() : EMPTY)));
}
