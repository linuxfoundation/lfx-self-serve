// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MentorshipMentorProfileResponse, MentorshipMentorProgramDetail, MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { catchError, Observable, throwError } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/mentor/*` endpoints. Every read rethrows so its page
 * can render an explicit retry or not-found state.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipMentorService {
  private readonly http = inject(HttpClient);

  public getMentorPrograms(): Observable<MentorshipMentorProgramsResponse> {
    return this.http.get<MentorshipMentorProgramsResponse>('/api/mentorship/mentor/programs').pipe(catchError(this.rethrowError('getMentorPrograms')));
  }

  public getMentorProfile(): Observable<MentorshipMentorProfileResponse> {
    return this.http.get<MentorshipMentorProfileResponse>('/api/mentorship/mentor/profile').pipe(catchError(this.rethrowError('getMentorProfile')));
  }

  /** Loads a mentor program by id (default URL) or slug. */
  public getMentorProgram(programId: string): Observable<MentorshipMentorProgramDetail> {
    return this.http
      .get<MentorshipMentorProgramDetail>(`/api/mentorship/mentor/programs/${encodeURIComponent(programId)}`)
      .pipe(catchError(this.rethrowError('getMentorProgram')));
  }

  private rethrowError(label: string) {
    return (err: HttpErrorResponse): Observable<never> => {
      if (err.status !== 404) {
        console.error(`[MentorshipMentorService] ${label} failed`, err);
      }
      return throwError(() => err);
    };
  }
}
