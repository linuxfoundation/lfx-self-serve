// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  MENTORSHIP_ENROLL_LOGO_AUTO_RETRY_DELAY_MS,
  MENTORSHIP_ENROLL_LOGO_NO_RETRY_STATUSES,
  MENTORSHIP_ENROLL_WRITE_RETRY_DELAYS_MS,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMentorCandidatesRequest,
  MentorshipAdminMentorCandidatesResponse,
  MentorshipAdminMentorInviteRequest,
  MentorshipAdminMentorStatusUpdate,
  MentorshipAdminMenteesQuery,
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorsQuery,
  MentorshipAdminMentorsResponse,
  MentorshipAdminProgramPage,
  MentorshipAdminTaskUpdate,
  MentorshipAdminTermInput,
  MentorshipAdminTermsQuery,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipEnrollCreateRequest,
  MentorshipEnrollImport,
  MentorshipEnrollProgramRef,
  MentorshipEnrollUpdateRequest,
  MentorshipMentorTaskCreateRequest,
  MentorshipMentorTaskCreateResponse,
  MentorshipProgramLogoUploadResult,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
  MentorshipProgramTermRow,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, retry, take, throwError, timer } from 'rxjs';

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

  /**
   * At most 10 people matching `search` who can be invited as a mentor of the program, with no email. A POST so the
   * search, which can be an email, travels in the body rather than a logged URL. The caller sends at least two trimmed
   * characters; the BFF answers 400 below that, and upstream for an unpublished program. A 503 means the account lookup
   * is down for now.
   */
  public getMentorCandidates(programId: string, search: string): Observable<MentorshipAdminMentorCandidatesResponse> {
    const body: MentorshipAdminMentorCandidatesRequest = { search };
    return this.http
      .post<MentorshipAdminMentorCandidatesResponse>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/mentor-candidates`, body)
      .pipe(take(1), this.logFailure('getMentorCandidates'));
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

  /**
   * Edits one task, or sets just its status, and returns it as the row reads it, so the caller patches the row in place.
   * Upstream's 400 (a submitted task that requires a file with none), 403 and 404 reach the caller as the error.
   */
  public updateTask(taskId: string, body: MentorshipAdminTaskUpdate): Observable<MentorshipApplicantTask> {
    return this.http
      .patch<MentorshipApplicantTask>(`/api/mentorship/admin/tasks/${encodeURIComponent(taskId)}`, body)
      .pipe(take(1), this.logFailure('updateTask'));
  }

  /**
   * Invites the picked candidate as a mentor of the program. Resolves on 204. A 409 (already on the program), 422 (no
   * LF account) and 503 (account lookup down) reach the caller as the error.
   */
  public inviteProgramMentor(programId: string, body: MentorshipAdminMentorInviteRequest): Observable<void> {
    return this.http
      .post<void>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/mentors`, body)
      .pipe(take(1), this.logFailure('inviteProgramMentor'));
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

  /** Reads the details of an existing program for the enroll wizard's import. A 403, a 404 or any other failure reaches the caller as the error. */
  public getEnrollTemplate(programId: string): Observable<MentorshipEnrollImport> {
    return this.http
      .get<MentorshipEnrollImport>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/enroll-template`)
      .pipe(take(1), this.logFailure('getEnrollTemplate'));
  }

  /**
   * Creates a program with its terms and prerequisites. Upstream leaves it `pending`, so this alone sends it to review.
   * Validation (400) and the rest reach the caller as the error; there is no retry here.
   */
  public createProgram(body: MentorshipEnrollCreateRequest): Observable<MentorshipEnrollProgramRef> {
    return this.http.post<MentorshipEnrollProgramRef>('/api/mentorship/admin/programs', body).pipe(take(1), this.logFailure('createProgram'));
  }

  /**
   * Saves the edit wizard's program fields; upstream leaves the program's status as it is. Terms go through the term methods and
   * the logo through `uploadProgramLogo`. Every failure reaches the caller as the error; there is no retry here.
   */
  public updateProgram(programId: string, body: MentorshipEnrollUpdateRequest): Observable<MentorshipEnrollProgramRef> {
    return this.http
      .patch<MentorshipEnrollProgramRef>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}`, body)
      .pipe(take(1), this.logFailure('updateProgram'));
  }

  /**
   * Uploads a program's logo as a raw `image/png` or `image/jpeg` body and resolves with its public URL. The BFF answers 415 for another
   * type and 413 above the size limit.
   *
   * A 403 right after the create can be the permission grant not having landed yet, so it is retried with a back-off (1 s, 2 s, 4 s)
   * unless it is the impersonation read-only refusal; `retryForbidden = false` turns that back-off off. Any other failure except a
   * refused file or sign-in (400, 401, 413, 415) is retried once after a short delay.
   */
  public uploadProgramLogo(programId: string, file: File, retryForbidden = true): Observable<MentorshipProgramLogoUploadResult> {
    return this.http
      .post<MentorshipProgramLogoUploadResult>(`/api/mentorship/admin/programs/${encodeURIComponent(programId)}/logo`, file, {
        headers: { 'Content-Type': file.type },
      })
      .pipe(
        retry({
          count: MENTORSHIP_ENROLL_WRITE_RETRY_DELAYS_MS.length,
          delay: (error: HttpErrorResponse, attempt: number) => {
            const forbidden = error.status === 403 && error.error?.code !== MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE;
            if (forbidden && retryForbidden) {
              return timer(MENTORSHIP_ENROLL_WRITE_RETRY_DELAYS_MS[attempt - 1]);
            }
            const fileRefused = (MENTORSHIP_ENROLL_LOGO_NO_RETRY_STATUSES as readonly number[]).includes(error.status);
            if (attempt === 1 && error.status !== 403 && !fileRefused) {
              return timer(MENTORSHIP_ENROLL_LOGO_AUTO_RETRY_DELAY_MS);
            }
            return throwError(() => error);
          },
        }),
        take(1),
        this.logFailure('uploadProgramLogo')
      );
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
