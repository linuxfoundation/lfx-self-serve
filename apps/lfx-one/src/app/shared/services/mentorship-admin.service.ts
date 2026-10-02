// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY_MENTORSHIP_PROGRAMS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipProgramDetail, MentorshipProgramsResponse, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/admin/*` endpoints behind the admin pages.
 *
 * Reads degrade to an empty response on error so the admin surface never blocks on upstream faults.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipAdminService {
  private readonly http = inject(HttpClient);

  public getPrograms(params?: { search?: string; status?: MentorshipProgramStatus; offset?: number; limit?: number }): Observable<MentorshipProgramsResponse> {
    let httpParams = new HttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    if (params?.limit !== undefined) httpParams = httpParams.set('limit', String(params.limit));

    return this.http
      .get<MentorshipProgramsResponse>('/api/mentorship/admin/programs', { params: httpParams })
      .pipe(catchError(this.handleError(EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, 'getPrograms')));
  }

  /** Loads a program by id (default URL) or slug. */
  public getProgram(programId: string): Observable<MentorshipProgramDetail | null> {
    return this.http
      .get<MentorshipProgramDetail>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}`)
      .pipe(catchError(this.handleError(null, 'getProgram')));
  }

  /**
   * Never re-throws to the UI; a 404 is silently swallowed as `fallback`, other
   * failures log to the console and also fall back so a transient BFF hiccup
   * doesn't wipe out the whole admin page.
   */
  private handleError<T>(fallback: T, label: string) {
    return (err: HttpErrorResponse): Observable<T> => {
      if (err.status !== 404) {
        console.error(`[MentorshipAdminService] ${label} failed`, err);
      }
      return of(fallback);
    };
  }
}
