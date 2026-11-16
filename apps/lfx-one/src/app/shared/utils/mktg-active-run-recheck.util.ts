// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgActiveRunGuardOptions, MktgActiveRunRecheckEvent } from '@lfx-one/shared/interfaces';
import { MKTG_RUN_POLL } from '@lfx-one/shared/constants/mktg-run.constants';
import { defer, EMPTY, Observable, ReplaySubject, Subscription } from 'rxjs';
import { createVisibilityPoll } from './visibility-poll.util';

/** A start POST is not a cancellable GET: focus reuses its in-flight ACK, never sends another start. */
export function watchMktgActiveRun<T>(doc: Document, options: MktgActiveRunGuardOptions<T>): Observable<MktgActiveRunRecheckEvent<T>> {
  return new Observable((observer) => {
    const subscriptions = new Subscription();
    let pending: ReplaySubject<boolean> | null = null;
    let accepted = false;
    const fetch = (): Observable<boolean> => {
      if (!options.current()) {
        observer.complete();
        return EMPTY;
      }
      if (accepted) return EMPTY;
      if (pending) return pending;
      const acknowledgement = new ReplaySubject<boolean>(1);
      pending = acknowledgement;
      observer.next({ type: 'checking' });
      subscriptions.add(
        defer(options.recheck).subscribe({
          next: (value) => {
            if (!options.current()) {
              observer.complete();
              return;
            }
            if (!accepted) {
              accepted = true;
              observer.next({ type: 'accepted' });
              acknowledgement.next(true);
              acknowledgement.complete();
            }
            observer.next({ type: 'value', value });
          },
          error: (error: unknown) => {
            pending = null;
            if (!options.current()) {
              observer.complete();
              return;
            }
            const conflict = options.classify(error);
            if (conflict) {
              observer.next({ type: 'conflict', conflict });
              acknowledgement.next(false);
            } else {
              // An uncertain start must never be retried automatically: its ACK may have been lost.
              accepted = true;
              observer.next({ type: 'error', error });
              acknowledgement.next(true);
              observer.complete();
            }
            acknowledgement.complete();
          },
          complete: () => {
            if (!accepted && options.current()) observer.next({ type: 'error', error: new Error('The start was not acknowledged.') });
            observer.complete();
          },
        })
      );
      return acknowledgement;
    };
    subscriptions.add(
      createVisibilityPoll(doc, fetch, {
        intervalMs: MKTG_RUN_POLL.intervalMs,
        backoffBaseMs: MKTG_RUN_POLL.intervalMs,
        backoffMaxMs: MKTG_RUN_POLL.intervalMs,
        shouldContinue: (started) => !started,
      }).subscribe()
    );
    return subscriptions;
  });
}
