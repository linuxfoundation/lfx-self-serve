// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMentorStatusUpdate,
  MentorshipAdminMenteesQuery,
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorsQuery,
  MentorshipAdminMentorsResponse,
  MentorshipAdminProgramPage,
  MentorshipAdminTermInput,
  MentorshipAdminTermsQuery,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipMentorTaskCreateRequest,
  MentorshipMentorTaskCreateResponse,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipProgramTermRow,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, take, throwError } from 'rxjs';

import { strictHttpParams } from '../utils/http-params.utils';

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
    // The strict codec keeps a `+` in the search text a `+`.
    let httpParams = strictHttpParams();
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
    let httpParams = strictHttpParams().set('type', query.type);
    if (query.status) httpParams = httpParams.set('status', query.status);
    if (query.termId) httpParams = httpParams.set('termId', query.termId);
    if (query.search) httpParams = httpParams.set('search', query.search);
    if (query.offset !== undefined) httpParams = httpParams.set('offset', String(query.offset));
    if (query.limit !== undefined) httpParams = httpParams.set('limit', String(query.limit));

    return this.http
      .get<MentorshipAdminMenteesResponse>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/mentees`, { params: httpParams })
      .pipe(this.logFailure('getProgramMentees'));
  }

  /** One page of a program's mentors, filtered and searched upstream. */
  public getProgramMentors(programId: string, query: MentorshipAdminMentorsQuery): Observable<MentorshipAdminMentorsResponse> {
    let httpParams = strictHttpParams();
    if (query.status) httpParams = httpParams.set('status', query.status);
    if (query.search) httpParams = httpParams.set('search', query.search);
    if (query.offset !== undefined) httpParams = httpParams.set('offset', String(query.offset));
    if (query.limit !== undefined) httpParams = httpParams.set('limit', String(query.limit));

    return this.http
      .get<MentorshipAdminMentorsResponse>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/mentors`, { params: httpParams })
      .pipe(this.logFailure('getProgramMentors'));
  }

  /** One page of a program's terms with their application counts. */
  public getProgramTerms(programId: string, query: MentorshipAdminTermsQuery): Observable<MentorshipAdminTermsResponse> {
    let httpParams = strictHttpParams();
    if (query.offset !== undefined) httpParams = httpParams.set('offset', String(query.offset));
    if (query.limit !== undefined) httpParams = httpParams.set('limit', String(query.limit));

    return this.http
      .get<MentorshipAdminTermsResponse>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/terms`, { params: httpParams })
      .pipe(this.logFailure('getProgramTerms'));
  }

  /** Every task of one application. Read only when a row's View Tasks is first opened. */
  public getApplicationTasks(applicationId: string): Observable<MentorshipApplicantTask[]> {
    return this.http
      .get<MentorshipApplicantTask[]>(`/api/mentorship/admin/applications/${encodeURIComponent(applicationId)}/tasks`)
      .pipe(this.logFailure('getApplicationTasks'));
  }

  /** Accepts (with an attendance type), declines or graduates one application. Resolves on 204. */
  public updateApplicationStatus(applicationId: string, body: MentorshipAdminApplicationStatusUpdate): Observable<void> {
    return this.http
      .patch<void>(`/api/mentorship/admin/applications/${encodeURIComponent(applicationId)}/status`, body)
      .pipe(take(1), this.logFailure('updateApplicationStatus'));
  }

  /** Saves, edits or clears (an empty `note`) the reviewer note of one application. Resolves on 204. */
  public updateApplicationNote(applicationId: string, note: string): Observable<void> {
    return this.http
      .put<void>(`/api/mentorship/admin/applications/${encodeURIComponent(applicationId)}/note`, { note })
      .pipe(take(1), this.logFailure('updateApplicationNote'));
  }

  /** Withdraws one application on the mentee's behalf. Resolves on 204. */
  public withdrawApplication(applicationId: string): Observable<void> {
    return this.http
      .post<void>(`/api/mentorship/admin/applications/${encodeURIComponent(applicationId)}/withdraw`, {})
      .pipe(take(1), this.logFailure('withdrawApplication'));
  }

  /** Gives accepted mentees a task. With one application a failure arrives as the error; with several, the ones not created are in `failed`. */
  public createTasks(request: MentorshipMentorTaskCreateRequest): Observable<MentorshipMentorTaskCreateResponse> {
    return this.http.post<MentorshipMentorTaskCreateResponse>('/api/mentorship/admin/tasks', request).pipe(take(1), this.logFailure('createTasks'));
  }

  /** Accepts, declines, revokes the invite of or removes one mentor of a program (the `status` it moves to). Resolves on 204. */
  public updateProgramMentor(programId: string, memberId: string, body: MentorshipAdminMentorStatusUpdate): Observable<void> {
    return this.http
      .patch<void>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/mentors/${encodeURIComponent(memberId)}`, body)
      .pipe(take(1), this.logFailure('updateProgramMentor'));
  }

  /** Declines every pending application of one term. */
  public declinePendingForTerm(programId: string, termId: string): Observable<MentorshipAdminDeclinePendingResponse> {
    return this.http
      .post<MentorshipAdminDeclinePendingResponse>(
        `/api/mentorship/admin/programs/${encodeURIComponent(programId)}/terms/${encodeURIComponent(termId)}/decline-pending`,
        {}
      )
      .pipe(take(1), this.logFailure('declinePendingForTerm'));
  }

  /** Creates an open term; the BFF refuses it with a 409 when the program already has four open terms. */
  public createTerm(programId: string, body: MentorshipAdminTermInput): Observable<MentorshipProgramTermRow> {
    return this.http
      .post<MentorshipProgramTermRow>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/terms`, body)
      .pipe(take(1), this.logFailure('createTerm'));
  }

  /** Edits a term's name and dates. */
  public updateTerm(programId: string, termId: string, body: MentorshipAdminTermInput): Observable<MentorshipProgramTermRow> {
    return this.http.patch<MentorshipProgramTermRow>(this.termUrl(programId, termId), body).pipe(take(1), this.logFailure('updateTerm'));
  }

  /** Closes a term. Resolves on 204. */
  public closeTerm(programId: string, termId: string): Observable<void> {
    return this.http.post<void>(`${this.termUrl(programId, termId)}/close`, {}).pipe(take(1), this.logFailure('closeTerm'));
  }

  /** Re-opens a closed term. Resolves on 204. */
  public reopenTerm(programId: string, termId: string): Observable<void> {
    return this.http.post<void>(`${this.termUrl(programId, termId)}/reopen`, {}).pipe(take(1), this.logFailure('reopenTerm'));
  }

  /** Deletes a term that has no applications. Resolves on 204. */
  public deleteTerm(programId: string, termId: string): Observable<void> {
    return this.http.delete<void>(this.termUrl(programId, termId)).pipe(take(1), this.logFailure('deleteTerm'));
  }

  private termUrl(programId: string, termId: string): string {
    return `/api/mentorship/admin/programs/${encodeURIComponent(programId)}/terms/${encodeURIComponent(termId)}`;
  }

  /** Logs the status only, since the error's URL carries the search text, then passes the error on. */
  private logFailure<T>(label: string) {
    return catchError<T, Observable<never>>((error: HttpErrorResponse) => {
      console.error(`[MentorshipAdminService] ${label} failed`, { status: error.status, statusText: error.statusText });
      return throwError(() => error);
    });
  }
}
