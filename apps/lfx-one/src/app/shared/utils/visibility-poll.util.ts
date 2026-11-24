// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_POLL_MAX_BACKOFF_MS, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import type { VisibilityPollEvent, VisibilityPollOptions } from '@lfx-one/shared/interfaces';
import { catchError, defer, EMPTY, expand, filter, fromEvent, map, merge, Observable, of, startWith, switchMap, take, tap, throwError, timer } from 'rxjs';
import { isTransientHttpError } from './http-error.utils';

/**
 * Retry delay for consecutive failure n ≥ 1: uniform jitter in [baseMs, min(maxMs, baseMs × 2^n)] — AWS "Full Jitter"
 * (Exponential Backoff and Jitter) offset to a floor at `baseMs`, by the operator's ruling; cf. Google Cloud's truncated
 * exponential backoff. Retry 1 ∈ [base, 2·base], retry 2 ∈ [base, 4·base], … up to the cap, so clients that failed
 * together do not retry together. A caller whose `maxMs === baseMs` has chosen a constant retry interval: the spread is
 * zero and every retry is the base (the agent-run service and the active-run recheck do this on purpose).
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
 * network coming back (`online`) also re-read, and only while visible (in the spirit of SWR's
 * `revalidateOnFocus` / `revalidateOnReconnect`; a hidden tab ignores both); `wakeDebounceMs` optionally coalesces
 * adjacent wake events, while initial reads and hidden cancellation stay immediate. Failures never end the stream and no
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
  const { intervalMs, backoffBaseMs, backoffMaxMs, wakeDebounceMs = 0, shouldContinue = () => true, random = Math.random, jitter = true } = options;

  const visibility = fromEvent(doc, 'visibilitychange');
  const wake = doc.defaultView ? merge(visibility, fromEvent(doc.defaultView, 'focus'), fromEvent(doc.defaultView, 'online')) : visibility;
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
        const delay = event.kind === 'ok' ? intervalMs : pollBackoffDelayMs(event.failures, backoffBaseMs, backoffMaxMs, random, jitter);
        return timer(delay).pipe(switchMap(() => attempt(true)));
      })
    );
  };

  return visible$.pipe(switchMap((visible) => (visible ? loop() : EMPTY)));
}

/**
 * The wake events of `createVisibilityPoll`, for a reader that keeps its own loop (the rebuild chain): tab return,
 * window focus and reconnect, each only while the tab is visible. Browser-only.
 */
export function pollWake(doc: Document): Observable<unknown> {
  const visibility = fromEvent(doc, 'visibilitychange');
  const wake = doc.defaultView ? merge(visibility, fromEvent(doc.defaultView, 'focus'), fromEvent(doc.defaultView, 'online')) : visibility;
  return wake.pipe(filter(() => doc.visibilityState === 'visible'));
}

/**
 * One read that keeps trying while the server cannot be reached, for the screens that read once rather than poll
 * (family details, the downstream panel, the run page's dependency check, the LinkedIn first load).
 * @description Runs `read` through `createVisibilityPoll`, so a transient failure (network, 408, 429, 5xx) is retried
 * on the same jittered backoff up to `MKTG_POLL_MAX_BACKOFF_MS`, never stops, and is re-read at once on tab return,
 * window focus and reconnect. `onRetrying(true)` is the caller's cue for the one grey line; `onRetrying(false)` clears
 * it when the read settles. A good read emits once and completes (a later wake sends nothing); a final refusal (any
 * other error: 400, 403, 404…) errors with it, so the caller shows its red one-liner. Browser-only, as the poller is.
 */
export function readUntilReachable<T>(doc: Document, read: () => Observable<T>, onRetrying: (retrying: boolean) => void): Observable<T> {
  const attempt = (): Observable<{ value: T } | { refused: unknown }> =>
    read().pipe(
      map((value) => ({ value })),
      catchError((error: unknown) => (isTransientHttpError(error) ? throwError(() => error) : of({ refused: error })))
    );
  return createVisibilityPoll(doc, attempt, {
    intervalMs: MKTG_RUN_POLL.intervalMs,
    backoffBaseMs: MKTG_RUN_POLL.intervalMs,
    backoffMaxMs: MKTG_POLL_MAX_BACKOFF_MS,
    shouldContinue: () => false,
  }).pipe(
    tap((event) => onRetrying(event.kind === 'error')),
    filter((event): event is Extract<typeof event, { kind: 'ok' }> => event.kind === 'ok'),
    take(1),
    map((event) => {
      if ('refused' in event.value) throw event.value.refused;
      return event.value.value;
    })
  );
}
