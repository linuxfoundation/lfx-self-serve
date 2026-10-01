// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  MentorshipMentorHasProfileResponse,
  MentorshipMentorProfileResponse,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramsResponse,
  MentorshipMentorRegisterRequest,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/mentor/*` endpoints. The page reads rethrow so each
 * page can render an explicit retry or not-found state; the has-profile check falls back instead.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipMentorService {
  private readonly http = inject(HttpClient);

  /**
   * Checks whether the signed-in user already has a mentor profile. A failed check reports no
   * profile, so the register page still opens and its own save refuses an existing profile.
   */
  public hasMentorProfile(): Observable<MentorshipMentorHasProfileResponse> {
    return this.http.get<MentorshipMentorHasProfileResponse>('/api/mentorship/mentor/has-profile').pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status !== 404) {
          console.error('[MentorshipMentorService] hasMentorProfile failed', err);
        }
        return of({ hasProfile: false });
      })
    );
  }

  /**
   * Creates the signed-in user's mentor profile from the register form. Failures propagate as the
   * raw `HttpErrorResponse` so the register page can read the status and code.
   */
  public registerMentorProfile(request: MentorshipMentorRegisterRequest): Observable<void> {
    return this.http.post<void>('/api/mentorship/mentor/profile', request).pipe(take(1));
  }

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
