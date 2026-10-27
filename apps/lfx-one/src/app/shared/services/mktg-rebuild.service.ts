// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MKTG_REBUILD_API_PATH, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgRebuildAdvanceRequest, MktgRebuildRequest, MktgRebuildResponse, MktgRebuildStartRequest, MktgRunAnswer } from '@lfx-one/shared/interfaces';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import {
  catchError,
  defer,
  distinctUntilChanged,
  EMPTY,
  expand,
  mergeMap,
  Observable,
  of,
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
      const activeStep = new Subject<number>();
      return of(chain).pipe(
        expand((current) => {
          if (current.status !== 'running') return EMPTY;
          const index = current.steps.findIndex((step) => step.status !== 'draft');
          if (current.steps[index]?.status === 'queued') return this.advance({ ...this.request(current), stepIndex: index });
          return timer(MKTG_RUN_POLL.intervalMs).pipe(
            switchMap(() =>
              this.http.post<MktgRebuildResponse>(`${MKTG_REBUILD_API_PATH}/result`, this.request(current)).pipe(
                take(1),
                catchError((error: unknown) => {
                  if (!isTransientHttpError(error)) return throwError(() => error);
                  console.warn('Transient rebuild poll failure; retrying', error);
                  return of(current);
                })
              )
            )
          );
        }, 1),
        tap((current) => activeStep.next(current.steps.findIndex((step) => step.status !== 'draft'))),
        takeUntil(
          activeStep.pipe(
            distinctUntilChanged(),
            // Each active step gets a fresh deadline; same-step progress/retries never extend it.
            switchMap(() => timer(MKTG_RUN_POLL.timeoutMs)),
            mergeMap(() => throwError(() => new Error('Rebuild progress timed out. Earlier Drafts are saved; reload the family before trying again.')))
          )
        )
      );
    });
  }

  private advance(request: MktgRebuildAdvanceRequest): Observable<MktgRebuildResponse> {
    return this.http.post<MktgRebuildResponse>(`${MKTG_REBUILD_API_PATH}/advance`, request).pipe(take(1));
  }
  private request(chain: MktgRebuildResponse): MktgRebuildRequest {
    return { project: chain.project, chainId: chain.chainId, ownerToken: chain.ownerToken };
  }
}
