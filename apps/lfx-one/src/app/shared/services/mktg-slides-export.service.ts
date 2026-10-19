// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MKTG_SLIDES_EXPORT_API_PATH, MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import {
  MktgSlidesExportLastResponse,
  MktgSlidesExportResultRequest,
  MktgSlidesExportResultResponse,
  MktgSlidesExportStartRequest,
  MktgSlidesExportStartResponse,
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import { mktgSlidesExportFailed } from '@lfx-one/shared/utils';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import { catchError, exhaustMap, map, Observable, of, take, takeLast, takeWhile, throwError, timer } from 'rxjs';

/**
 * Export to Google Slides for the Marketing OS asset pages. The BFF reads
 * the asset from the document store and starts the exporter; this client
 * starts it, polls it until the deck lands, and reads a document's last
 * export. The deck's logo is the BFF's to draw from the stored kit.
 */
@Injectable({ providedIn: 'root' })
export class MktgSlidesExportService {
  private readonly http = inject(HttpClient);

  /**
   * The document's last export and its latest revision. A failed read is
   * logged and answers no last export: Export still works and creates a new
   * deck, so the panel shows no stale "Open the last export".
   */
  public last(target: MktgSlidesExportTarget): Observable<MktgSlidesExportLastResponse> {
    const params = new HttpParams().set('project', target.project).set('agentKey', target.agentKey).set('documentId', target.documentId);
    return this.http.get<MktgSlidesExportLastResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/last`, { params }).pipe(
      take(1),
      catchError((error: unknown) => {
        console.error('[mktg-slides-export] last export read failed', { ...target, error });
        return of<MktgSlidesExportLastResponse>({ last: null, latestRevision: null });
      })
    );
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
    return timer(MKTG_SLIDES_EXPORT_POLL.intervalMs, MKTG_SLIDES_EXPORT_POLL.intervalMs).pipe(
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
      map((result) => (result.status === 'pending' ? mktgSlidesExportFailed('timeout') : result))
    );
  }
}
