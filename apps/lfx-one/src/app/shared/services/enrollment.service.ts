// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EnrollmentsState, IndividualEnrollment } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, startWith } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class EnrollmentService {
  private readonly http = inject(HttpClient);

  public getEnrollments(): Observable<EnrollmentsState> {
    return this.http.get<IndividualEnrollment[]>('/api/enrollments').pipe(
      map((items): EnrollmentsState => ({ kind: 'loaded', items })),
      startWith<EnrollmentsState>({ kind: 'loading' }),
      catchError(
        (err: HttpErrorResponse): Observable<EnrollmentsState> =>
          of({
            kind: 'error',
            message: err.error?.error ?? err.error?.message ?? 'We could not load your enrollment products. Please retry.',
          })
      )
    );
  }
}
