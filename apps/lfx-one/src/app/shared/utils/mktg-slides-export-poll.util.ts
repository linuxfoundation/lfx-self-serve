// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import { MktgSlidesExportDeckRecord, MktgSlidesExportPollResponse } from '@lfx-one/shared/interfaces';
import { mktgSlidesExportFailed } from '@lfx-one/shared/utils';
import { catchError, defer, exhaustMap, map, Observable, of, take, takeLast, takeWhile, tap, throwError, timer, TimeoutError } from 'rxjs';
import { isTransientHttpError } from './http-error.utils';

/** One deadline, attempt budget and failure policy for both browser export scopes. */
export function pollMktgSlidesExport<TRecord extends MktgSlidesExportDeckRecord>(
  read: () => Observable<MktgSlidesExportPollResponse<TRecord>>,
  sessionId: string
): Observable<MktgSlidesExportPollResponse<TRecord>> {
  return defer(() => {
    const deadline = Date.now() + MKTG_SLIDES_EXPORT_POLL.timeoutMs;
    return timer(MKTG_SLIDES_EXPORT_POLL.intervalMs, MKTG_SLIDES_EXPORT_POLL.intervalMs).pipe(
      tap(() => {
        if (Date.now() > deadline) throw new TimeoutError();
      }),
      exhaustMap(() =>
        read().pipe(
          catchError((error: unknown) => {
            if (isTransientHttpError(error)) {
              console.warn('[mktg-slides-export] poll failed, retrying', { sessionId, error });
              return of<MktgSlidesExportPollResponse<TRecord>>({ status: 'pending' });
            }
            console.error('[mktg-slides-export] poll refused', { sessionId, error });
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
          console.warn('[mktg-slides-export] poll ran past its deadline', { sessionId });
          return of(mktgSlidesExportFailed('timeout'));
        }
        return throwError(() => error);
      })
    );
  });
}
