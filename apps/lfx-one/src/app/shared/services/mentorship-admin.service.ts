// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  MentorshipAdminMenteesQuery,
  MentorshipAdminMenteesResponse,
  MentorshipAdminProgramPage,
  MentorshipApplicantTask,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, throwError } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/admin/*` endpoints behind the admin pages.
 *
 * Every read logs the failure status and passes the error on: the caller shows an inline error with Retry, and tells
 * a 403 or a 404 apart from other failures by the status.
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

    return this.http.get<MentorshipProgramsResponse>('/api/mentorship/admin/programs', { params: httpParams }).pipe(this.logFailure('getPrograms'));
  }

  /** The program page: the header, the tab counts and the term options. `programId` is the program's UUID. */
  public getProgram(programId: string): Observable<MentorshipAdminProgramPage> {
    return this.http.get<MentorshipAdminProgramPage>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}`).pipe(this.logFailure('getProgram'));
  }

  /** One page of a program's mentees for one tab, filtered and searched upstream. */
  public getProgramMentees(programId: string, query: MentorshipAdminMenteesQuery): Observable<MentorshipAdminMenteesResponse> {
    let httpParams = new HttpParams().set('type', query.type);
    if (query.status) httpParams = httpParams.set('status', query.status);
    if (query.termId) httpParams = httpParams.set('termId', query.termId);
    if (query.search) httpParams = httpParams.set('search', query.search);
    if (query.offset !== undefined) httpParams = httpParams.set('offset', String(query.offset));
    if (query.limit !== undefined) httpParams = httpParams.set('limit', String(query.limit));

    return this.http
      .get<MentorshipAdminMenteesResponse>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/mentees`, { params: httpParams })
      .pipe(this.logFailure('getProgramMentees'));
  }

  /** Every task of one application. Read only when a row's View Tasks is first opened. */
  public getApplicationTasks(applicationId: string): Observable<MentorshipApplicantTask[]> {
    return this.http
      .get<MentorshipApplicantTask[]>(`/api/mentorship/admin/applications/${encodeURIComponent(applicationId)}/tasks`)
      .pipe(this.logFailure('getApplicationTasks'));
  }

  /** Logs the status only, since the error's URL carries the search text, then passes the error on. */
  private logFailure<T>(label: string) {
    return catchError<T, Observable<never>>((error: HttpErrorResponse) => {
      console.error(`[MentorshipAdminService] ${label} failed`, { status: error.status, statusText: error.statusText });
      return throwError(() => error);
    });
  }
}
