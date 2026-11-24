// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, EMPTY, expand, Observable, of, switchMap, tap, timer } from 'rxjs';

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

/**
 * Loads a keyed result once per period the key is non-null, re-requesting a held placeholder a bounded number of times.
 * @description Must be called in an injection context. The result is requested once for each new non-null key and never
 * while the key is null; a key that goes back to null drops the result, so a later non-null key loads again. A payload
 * for which `isHeld` is true is re-requested every `retryMs` for at most `maxAttempts` requests in total; a failed retry
 * keeps the held payload and cannot end the loop, while a failed first load sets `error`.
 */
export function createHeldResults<R>(options: HeldResultsOptions<R>): HeldResults<R> {
  const { key, load, isHeld, retryMs, maxAttempts, errorMessage } = options;
  const loading = signal(false);
  const error = signal(false);

  const attempt = (uid: string, heldResults: R | null = null): Observable<R | null> =>
    load(uid).pipe(
      catchError((err) => {
        console.error(errorMessage, err);
        // A failed retry cannot release the hold or end the bounded finalization loop.
        if (heldResults !== null && isHeld(heldResults)) return of(heldResults);
        error.set(true);
        return of(null);
      })
    );

  const results: Signal<R | null> = toSignal(
    toObservable(key).pipe(
      distinctUntilChanged(),
      tap((uid) => {
        error.set(false);
        loading.set(!!uid);
      }),
      switchMap((uid) =>
        uid
          ? attempt(uid).pipe(
              expand((current, index) =>
                current !== null && isHeld(current) && index + 1 < maxAttempts ? timer(retryMs).pipe(switchMap(() => attempt(uid, current))) : EMPTY
              ),
              tap(() => loading.set(false))
            )
          : of(null)
      )
    ),
    { initialValue: null }
  );

  return { results, loading: loading.asReadonly(), error: error.asReadonly() };
}
