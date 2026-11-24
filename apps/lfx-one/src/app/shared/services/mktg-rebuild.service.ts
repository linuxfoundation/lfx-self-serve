// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { MKTG_NOT_AVAILABLE_TEXT, MKTG_POLL_MAX_BACKOFF_MS, MKTG_REBUILD_API_PATH, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgRebuildAdvanceRequest, MktgRebuildRequest, MktgRebuildResponse, MktgRebuildStartRequest, MktgRunAnswer } from '@lfx-one/shared/interfaces';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import { pollBackoffDelayMs, pollWake } from '@shared/utils/visibility-poll.util';
import {
  BehaviorSubject,
  catchError,
  defer,
  distinctUntilChanged,
  EMPTY,
  expand,
  filter,
  finalize,
  mergeMap,
  Observable,
  of,
  race,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timer,
} from 'rxjs';

/** One sequential request stream; unsubscribing stops polling/advancing, not a Guild run already accepted. */
@Injectable({ providedIn: 'root' })
export class MktgRebuildService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  /**
   * The chain's own checks cannot reach the server (network, 408, 429, 5xx): the panel shows one grey line, the steps
   * already shown stay, and the watch keeps checking. Cleared by the next good read and when a watch ends.
   */
  public readonly retrying = signal(false);

  public run(request: MktgRebuildStartRequest): Observable<MktgRebuildResponse> {
    return this.http.post<MktgRebuildResponse>(`${MKTG_REBUILD_API_PATH}/start`, request).pipe(
      take(1),
      switchMap((chain) => this.watch(chain))
    );
  }

  public answer(chain: MktgRebuildResponse, stepIndex: number, answers: MktgRunAnswer[]): Observable<MktgRebuildResponse> {
    const request: MktgRebuildAdvanceRequest = { ...this.request(chain), stepIndex, questionsId: chain.steps[stepIndex]?.questionsId, answers };
    return this.advance(request).pipe(switchMap((updated) => this.watch(updated)));
  }

  private watch(chain: MktgRebuildResponse): Observable<MktgRebuildResponse> {
    return defer(() => {
      const activeStep = new Subject<number | null>();
      const unreachable = new BehaviorSubject(false);
      let failures = 0;
      // A check that cannot reach the server is tried again by itself: jittered backoff from the poll interval up to the
      // shared cap, and at once on tab return, focus or reconnect. Any other failure is final and ends the watch.
      const check = (current: MktgRebuildResponse, request$: Observable<MktgRebuildResponse>): Observable<MktgRebuildResponse> =>
        request$.pipe(
          tap(() => (failures = 0)),
          catchError((error: unknown) => {
            if (!isTransientHttpError(error)) return throwError(() => error);
            // Status only: no upstream payload enters diagnostics.
            console.error('Rebuild check could not reach the server; trying again', { status: error instanceof HttpErrorResponse ? error.status : 0 });
            failures++;
            return of(current);
          })
        );
      return of(chain).pipe(
        expand((current) => {
          if (current.status !== 'running') return EMPTY;
          const index = current.steps.findIndex((step) => step.status !== 'draft');
          const queued = current.steps[index]?.status === 'queued';
          // A duplicate advance of a queued step has no side effects on the server, so it is retried like a poll.
          const request$ = queued ? this.advance({ ...this.request(current), stepIndex: index }) : this.result(current);
          if (!failures) return queued ? check(current, request$) : timer(MKTG_RUN_POLL.intervalMs).pipe(switchMap(() => check(current, request$)));
          const wait = timer(pollBackoffDelayMs(failures, MKTG_RUN_POLL.intervalMs, MKTG_POLL_MAX_BACKOFF_MS));
          return race(wait, pollWake(this.document)).pipe(
            take(1),
            switchMap(() => check(current, request$))
          );
        }, 1),
        tap((current) => {
          // The step first: a good read that shows a new step, or a chain that is no longer running (null), cancels a
          // deadline held back by an outage before the outage is declared over, so that read is never called a timeout.
          activeStep.next(current.status === 'running' ? current.steps.findIndex((step) => step.status !== 'draft') : null);
          unreachable.next(failures > 0);
          this.retrying.set(failures > 0);
        }),
        takeUntil(
          activeStep.pipe(
            distinctUntilChanged(),
            // Each active step gets a fresh deadline; same-step progress/retries never extend it. A deadline that passes
            // while the server cannot be reached is held until the next good read, since being offline is not the step
            // taking too long. The hold sits inside the step's own switchMap, so only a good read that still shows the
            // same step running releases it as a timeout; a step change or an ended chain drops it.
            switchMap(() =>
              timer(MKTG_RUN_POLL.timeoutMs).pipe(
                switchMap(() => unreachable.pipe(filter((failing) => !failing))),
                take(1)
              )
            ),
            mergeMap(() => throwError(() => new Error(MKTG_NOT_AVAILABLE_TEXT.rebuildTimeout)))
          )
        ),
        finalize(() => this.retrying.set(false))
      );
    });
  }

  private result(chain: MktgRebuildResponse): Observable<MktgRebuildResponse> {
    return this.http.post<MktgRebuildResponse>(`${MKTG_REBUILD_API_PATH}/result`, this.request(chain)).pipe(take(1));
  }

  private advance(request: MktgRebuildAdvanceRequest): Observable<MktgRebuildResponse> {
    return this.http.post<MktgRebuildResponse>(`${MKTG_REBUILD_API_PATH}/advance`, request).pipe(take(1));
  }
  private request(chain: MktgRebuildResponse): MktgRebuildRequest {
    return { project: chain.project, chainId: chain.chainId, ownerToken: chain.ownerToken };
  }
}
