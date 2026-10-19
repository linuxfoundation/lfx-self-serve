// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MKTG_SLIDES_EXPORT_API_PATH, MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import {
  MktgSlidesExportLastResponse,
  MktgSlidesExportMode,
  MktgSlidesExportResultRequest,
  MktgSlidesExportResultResponse,
  MktgSlidesExportRunUpdate,
  MktgSlidesExportStartRequest,
  MktgSlidesExportStartResponse,
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import { mktgSlidesExportFailed } from '@lfx-one/shared/utils';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import {
  catchError,
  defer,
  exhaustMap,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeLast,
  takeWhile,
  tap,
  throwError,
  timer,
  TimeoutError,
} from 'rxjs';

/**
 * Export to Google Slides for the Marketing OS asset pages. The BFF reads
 * the asset from the document store and starts the exporter; this client
 * starts it, polls it until the deck lands, and reads a document's last
 * export. The deck's logo is the BFF's to draw from the stored kit.
 *
 * It also holds the exports this browser has under way, one per document:
 * a panel that goes (another version picked, the page left) does not stop
 * the export, and a panel that comes back to the document attaches to it
 * instead of offering Create while its deck is still being made.
 */
@Injectable({ providedIn: 'root' })
export class MktgSlidesExportService {
  private readonly http = inject(HttpClient);

  /** The exports under way, by document (project, document type and document id): the deck is the document's, whichever revision filled it. */
  private readonly inFlight = new Map<string, Observable<MktgSlidesExportRunUpdate>>();

  /**
   * The document's last export and its latest revision. A failed read is
   * logged and rethrown: the panel says the check failed and offers to
   * check again, never Create, since a deck may already exist.
   */
  public last(target: MktgSlidesExportTarget): Observable<MktgSlidesExportLastResponse> {
    const params = new HttpParams().set('project', target.project).set('agentKey', target.agentKey).set('documentId', target.documentId);
    return this.http.get<MktgSlidesExportLastResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/last`, { params }).pipe(
      take(1),
      catchError((error: unknown) => {
        console.error('[mktg-slides-export] last export read failed', { ...target, error });
        return throwError(() => error);
      })
    );
  }

  /**
   * Start an export and poll it to its end: its mode at once, the start's
   * logo note next, then the one result, every update carrying the mode so
   * a panel that attaches later retries it the same way. The export belongs
   * to its document until it ends,
   * whoever is watching: it keeps running when every subscriber goes, and
   * {@link running} hands it to the next panel on the same document. An
   * export already under way for the document is returned instead of a
   * second one.
   */
  public run(target: MktgSlidesExportTarget, mode: MktgSlidesExportMode): Observable<MktgSlidesExportRunUpdate> {
    const key = this.documentKey(target);
    const running = this.inFlight.get(key);
    if (running) {
      return running;
    }
    const run$ = this.start({ ...target, mode }).pipe(
      switchMap((started) =>
        this.poll(target, started).pipe(
          map((result): MktgSlidesExportRunUpdate => ({ mode, logoNote: started.logoNote, result })),
          startWith<MktgSlidesExportRunUpdate>({ mode, logoNote: started.logoNote, result: null })
        )
      ),
      startWith<MktgSlidesExportRunUpdate>({ mode, logoNote: null, result: null }),
      finalize(() => this.inFlight.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.inFlight.set(key, run$);
    return run$;
  }

  /** The export under way for the target's document, or null. */
  public running(target: MktgSlidesExportTarget): Observable<MktgSlidesExportRunUpdate> | null {
    return this.inFlight.get(this.documentKey(target)) ?? null;
  }

  /** Start an export: the session to poll and the revision it exports. */
  public start(request: MktgSlidesExportStartRequest): Observable<MktgSlidesExportStartResponse> {
    return this.http.post<MktgSlidesExportStartResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/start`, request).pipe(
      take(1),
      catchError((error: unknown) => {
        console.error('[mktg-slides-export] start refused', { agentKey: request.agentKey, documentId: request.documentId, mode: request.mode, error });
        return throwError(() => error);
      })
    );
  }

  /**
   * Poll an export until it is ready or failed; one emission. A transient
   * poll failure is a spent attempt, and an export still pending when the
   * attempts run out answers the timeout message (it may still finish).
   * `exhaustMap` drops the ticks a slow poll overlaps, so the attempts alone
   * would never run out behind a poll that never answers: the wall-clock
   * deadline is checked on every tick before it, and the tick past it tears
   * the request down and answers the timeout message too.
   */
  public poll(target: MktgSlidesExportTarget, started: MktgSlidesExportStartResponse): Observable<MktgSlidesExportResultResponse> {
    const body: MktgSlidesExportResultRequest = {
      project: target.project,
      agentKey: target.agentKey,
      documentId: target.documentId,
      revisionId: started.revision.id,
      sessionId: started.sessionId,
      ownerToken: started.ownerToken,
    };
    return defer(() => {
      const deadline = Date.now() + MKTG_SLIDES_EXPORT_POLL.timeoutMs;
      return timer(MKTG_SLIDES_EXPORT_POLL.intervalMs, MKTG_SLIDES_EXPORT_POLL.intervalMs).pipe(
        tap(() => {
          if (Date.now() > deadline) {
            throw new TimeoutError();
          }
        }),
        exhaustMap(() =>
          this.http.post<MktgSlidesExportResultResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/result`, body).pipe(
            catchError((error: unknown) => {
              if (isTransientHttpError(error)) {
                console.warn('[mktg-slides-export] poll failed, retrying', { sessionId: started.sessionId, error });
                return of<MktgSlidesExportResultResponse>({ status: 'pending' });
              }
              console.error('[mktg-slides-export] poll refused', { sessionId: started.sessionId, error });
              return throwError(() => error);
            })
          )
        ),
        take(MKTG_SLIDES_EXPORT_POLL.maxAttempts),
        takeWhile((result) => result.status === 'pending', true),
        takeLast(1),
        map((result) => (result.status === 'pending' ? mktgSlidesExportFailed('timeout') : result)),
        catchError((error: unknown) => {
          if (error instanceof TimeoutError) {
            console.warn('[mktg-slides-export] poll ran past its deadline', { sessionId: started.sessionId });
            return of(mktgSlidesExportFailed('timeout'));
          }
          return throwError(() => error);
        })
      );
    });
  }

  private documentKey(target: MktgSlidesExportTarget): string {
    return [target.project, target.agentKey, target.documentId].join('|');
  }
}
