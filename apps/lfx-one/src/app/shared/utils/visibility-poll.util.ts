// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { VisibilityPollEvent, VisibilityPollOptions } from '@lfx-one/shared/interfaces';
import { defer, EMPTY, expand, fromEvent, map, merge, Observable, of, startWith, switchMap, timer, catchError } from 'rxjs';

/**
 * Retry delay for consecutive failure n ≥ 1: uniform jitter in [baseMs, min(maxMs, baseMs × 2^n)] — AWS "Full Jitter"
 * (Exponential Backoff and Jitter) offset to a floor at `baseMs`, by the operator's ruling; cf. Google Cloud's truncated
 * exponential backoff. Retry 1 ∈ [base, 2·base], retry 2 ∈ [base, 4·base], … up to the cap, so clients that failed
 * together do not retry together. A caller whose `maxMs === baseMs` has chosen a constant retry interval: the spread is
 * zero and every retry is the base (Kit, Family, the agent-run service and the active-run recheck do this on purpose).
 * `jitter: false` is the un-randomised doubling min(maxMs, baseMs × 2^(n−1)) that the Votes presenter has always used.
 * `random` is the jitter source in [0, 1); pass a constant in tests for exact timings (0 gives the floor, 1 the ceiling).
 */
export function pollBackoffDelayMs(failures: number, baseMs: number, maxMs: number, random: () => number = Math.random, jitter = true): number {
  const n = Math.max(1, failures);
  if (!jitter) return Math.min(maxMs, baseMs * 2 ** (n - 1));
  const ceiling = Math.min(maxMs, baseMs * 2 ** n);
  return Math.round(baseMs + random() * Math.max(0, ceiling - baseMs));
}

/**
 * Visibility-aware poller: `timer` + sequential `expand`, so a slow response can never overlap the next request.
 * @description Polls immediately, then every `intervalMs` while `document.visibilityState === 'visible'`. A hidden tab
 * cancels the pending timer and any in-flight request; the next `visible` event fetches immediately and restarts the
 * loop (including after `shouldContinue` stopped it — that is how a reopened vote is noticed). Window focus and the
 * network coming back (`online`) also re-read immediately, and only while visible (in the spirit of SWR's
 * `revalidateOnFocus` / `revalidateOnReconnect`; a hidden tab ignores both). Failures never end the stream and no
 * deadline stops them: they emit an `error` event and retry on capped exponential backoff with jitter floored at
 * `backoffBaseMs` (`pollBackoffDelayMs`), so recovery needs no reload and no button. A caller that must stop for good
 * (a denied read) latches that itself and returns `EMPTY` from `fetch`.
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
  const { intervalMs, backoffBaseMs, backoffMaxMs, shouldContinue = () => true, random = Math.random, jitter = true } = options;

  const visibility = fromEvent(doc, 'visibilitychange');
  const wake = doc.defaultView ? merge(visibility, fromEvent(doc.defaultView, 'focus'), fromEvent(doc.defaultView, 'online')) : visibility;
  const visible$ = wake.pipe(
    startWith(null),
    map(() => doc.visibilityState === 'visible')
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
        const delay = event.kind === 'ok' ? intervalMs : pollBackoffDelayMs(event.failures, backoffBaseMs, backoffMaxMs, random, jitter);
        return timer(delay).pipe(switchMap(() => attempt(true)));
      })
    );
  };

  return visible$.pipe(switchMap((visible) => (visible ? loop() : EMPTY)));
}
