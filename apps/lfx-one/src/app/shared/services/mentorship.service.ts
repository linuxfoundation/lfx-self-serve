// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY_MENTORSHIP_PROGRAMS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/*` endpoints.
 *
 * Shape mirrors `CrowdfundingService` deliberately: list + detail lookup, list
 * degrades to an empty response on error so the admin surface never blocks on
 * upstream faults, detail degrades to `null` so the caller can render a
 * "not found" state without a rethrown observable.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipService {
  private readonly http = inject(HttpClient);

  public getPrograms(params?: { search?: string; status?: MentorshipProgramStatus }): Observable<MentorshipProgramsResponse> {
    let httpParams = new HttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.status) httpParams = httpParams.set('status', params.status);

    return this.http
      .get<MentorshipProgramsResponse>('/api/mentorship/programs', { params: httpParams })
      .pipe(catchError(this.handleError(EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, 'getPrograms')));
  }

  /**
   * Never re-throws to the UI; a 404 is silently swallowed as `fallback`, other
   * failures log to the console and also fall back so a transient BFF hiccup
   * doesn't wipe out the whole admin page.
   */
  private handleError<T>(fallback: T, label: string) {
    return (err: HttpErrorResponse): Observable<T> => {
      if (err.status !== 404) {
        console.error(`[MentorshipService] ${label} failed`, err);
      }
      return of(fallback);
    };
  }
}
