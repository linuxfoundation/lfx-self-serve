// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { filter, map, Observable, switchMap, tap } from 'rxjs';

import { createVisibilityPoll } from './visibility-poll.util';

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

/**
 * Live snapshot of one keyed resource, polled with {@link createVisibilityPoll} (visibility-aware, sequential, backoff on error).
 * @description Must be called in an injection context. A changed key drops the previous snapshot and failure count before the
 * new resource is polled. Each event is tagged with its poll generation inside the `switchMap`, and `restart()` bumps the
 * generation before the loop restarts, so a result that was already in flight when the restart was requested (older
 * generation) can never settle it; callers compare `landedGeneration() >= restart()`.
 *
 * Browser-only: with `enabled: false` (SSR) only the signals exist and nothing subscribes or touches `document`.
 */
export function createLiveSnapshot<T>(options: LiveSnapshotOptions<T>): LiveSnapshot<T> {
  const { key, fetch, doc, intervalMs, backoffBaseMs, backoffMaxMs, enabled = true } = options;
  const destroyRef = inject(DestroyRef);

  const snapshot = signal<LiveSnapshotValue<T> | null>(null);
  const failures = signal(0);
  const generation = signal(0);
  const landedGeneration = signal(-1);
  let polledKey: string | null = null;

  if (enabled) {
    toObservable(computed(() => ({ key: key(), generation: generation() })))
      .pipe(
        filter((state): state is { key: string; generation: number } => !!state.key),
        tap(({ key: next }) => {
          if (next !== polledKey) {
            snapshot.set(null);
            failures.set(0);
          }
          polledKey = next;
        }),
        switchMap(({ key: next, generation: tagged }) =>
          createVisibilityPoll(doc, () => fetch(next), { intervalMs, backoffBaseMs, backoffMaxMs }).pipe(map((event) => ({ event, generation: tagged })))
        ),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(({ event, generation: tagged }) => {
        if (event.kind === 'ok') {
          failures.set(0);
          snapshot.set({ value: event.value, receivedAtMs: Date.now() });
          landedGeneration.set(tagged);
        } else {
          failures.set(event.failures);
        }
      });
  }

  return {
    snapshot: snapshot.asReadonly(),
    failures: failures.asReadonly(),
    landedGeneration: landedGeneration.asReadonly(),
    restart: (resetFailures = false) => {
      if (resetFailures) failures.set(0);
      generation.update((n) => n + 1);
      return generation();
    },
  };
}
