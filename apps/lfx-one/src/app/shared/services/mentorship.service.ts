// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MENTORSHIP_LF_PROJECT_PAGE_SIZE } from '@lfx-one/shared/constants';
import {
  MentorshipApplicantTask,
  MentorshipCiiBadge,
  MentorshipLfProjectsResponse,
  MentorshipLfxProfileFields,
  MentorshipNameAvailability,
  MentorshipProgramDecisionRequest,
  MentorshipProgramReview,
  MentorshipProgramReviewDecision,
  MentorshipTaskCreateRequest,
  MentorshipTaskCreateResponse,
  MentorshipTaskUpdate,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

import { strictHttpParams } from '../utils/http-params.utils';

/**
 * Talks to the LFX One BFF's `/api/mentorship/*` endpoints.
 *
 * Errors propagate to the caller, which owns the unavailable or retry state: the name check (the
 * wizard holds Next while it cannot confirm the name), the project picker's pages (Retry rather than
 * a failure shown as no projects, or a truncated list as complete), the CII badge (a 404 is `null`),
 * the review and profile calls, and the task create and edit the admin and mentor program details share.
 * The admin pages' reads live in `MentorshipAdminService` and the mentor pages' in `MentorshipMentorService`.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipService {
  private readonly http = inject(HttpClient);

  /** `excludeProgramId` leaves that program out, so the edit wizard does not report a program's own name as taken. */
  public isProgramNameAvailable(name: string, excludeProgramId = ''): Observable<MentorshipNameAvailability> {
    let params = strictHttpParams().set('name', name);
    if (excludeProgramId) params = params.set('excludeProgramId', excludeProgramId);
    return this.http.get<MentorshipNameAvailability>('/api/mentorship/programs/name-available', { params }).pipe(take(1));
  }

  /** One lazy-load page of LF projects; pass the previous page's `page_token` as `pageToken` for the next one. Errors propagate. */
  public getLfProjects(params?: { search?: string; pageToken?: string | null; limit?: number }): Observable<MentorshipLfProjectsResponse> {
    // Strict codec: a `+` in a typed search (`C++`) or in the opaque cursor would otherwise reach Express as a space.
    let httpParams = strictHttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.pageToken) httpParams = httpParams.set('page_token', params.pageToken);
    httpParams = httpParams.set('page_size', String(params?.limit ?? MENTORSHIP_LF_PROJECT_PAGE_SIZE));

    return this.http
      .get<MentorshipLfProjectsResponse>('/api/mentorship/lf-projects', { params: httpParams })
      .pipe(take(1), catchError(this.rethrowError('getLfProjects')));
  }

  /** The program an approve/reject email link points at. Rethrows so the page can branch on the status code. */
  public getProgramReview(programId: string): Observable<MentorshipProgramReview> {
    return this.http
      .get<MentorshipProgramReview>(`/api/mentorship/program-review/${encodeURIComponent(programId)}`)
      .pipe(catchError(this.rethrowError('getProgramReview')));
  }

  /**
   * Records an approver's decision. Not caught here: 403 (not an approver) and 409 (already
   * decided) are expected outcomes the review page renders, not failures to log.
   */
  public submitProgramDecision(programId: string, decision: MentorshipProgramReviewDecision): Observable<MentorshipProgramReview> {
    const body: MentorshipProgramDecisionRequest = { decision };
    return this.http.post<MentorshipProgramReview>(`/api/mentorship/program-review/${encodeURIComponent(programId)}/decision`, body).pipe(take(1));
  }

  /**
   * Copies the LFX profile's name, email, logo and GitHub link onto the caller's mentor and mentee
   * profiles; the BFF resolves the email and the link. Not caught here: the profile card logs the failure and tells the user.
   */
  public syncLfxProfileFields(fields: MentorshipLfxProfileFields): Observable<void> {
    return this.http.patch<void>('/api/mentorship/me/lfx-profile', fields).pipe(take(1));
  }

  /**
   * Gives accepted mentees a task, for the admin and mentor program details alike. With one application a failure arrives as the
   * error; with several, the ones not created are in `failed`.
   */
  public createTasks(request: MentorshipTaskCreateRequest): Observable<MentorshipTaskCreateResponse> {
    return this.http.post<MentorshipTaskCreateResponse>('/api/mentorship/tasks', request).pipe(take(1), catchError(this.logStatusOnly('createTasks')));
  }

  /**
   * Edits one task, or sets just its status, and returns it as the row reads it, so the caller patches the row in place.
   * Upstream's 400 (a submitted task that requires a file with none), 403 and 404 reach the caller as the error.
   */
  public updateTask(taskId: string, body: MentorshipTaskUpdate): Observable<MentorshipApplicantTask> {
    return this.http
      .patch<MentorshipApplicantTask>(`/api/mentorship/tasks/${encodeURIComponent(taskId)}`, body)
      .pipe(take(1), catchError(this.logStatusOnly('updateTask')));
  }

  /**
   * Reads a task's submission file, for its mentee and its reviewers alike, with the response headers so the caller can
   * save it under the name upstream sends. A failure reaches the caller, whose error body is a Blob.
   */
  public downloadTaskFile(taskId: string): Observable<HttpResponse<Blob>> {
    return this.http
      .get(`/api/mentorship/tasks/${encodeURIComponent(taskId)}/file`, { responseType: 'blob', observe: 'response' })
      .pipe(take(1), catchError(this.logStatusOnly('downloadTaskFile')));
  }

  public getCiiBadge(projectId: string): Observable<MentorshipCiiBadge | null> {
    return this.http.get<MentorshipCiiBadge>(`/api/mentorship/cii/${encodeURIComponent(projectId)}`).pipe(
      take(1),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 404) return of(null);
        console.error('[MentorshipService] getCiiBadge failed', err);
        return throwError(() => err);
      })
    );
  }

  private rethrowError(label: string) {
    return (err: HttpErrorResponse): Observable<never> => {
      if (err.status !== 404) {
        console.error(`[MentorshipService] ${label} failed`, err);
      }
      return throwError(() => err);
    };
  }

  /** Logs the status only, since a task write's error can echo the task's text, then passes the error on. */
  private logStatusOnly(label: string) {
    return (err: HttpErrorResponse): Observable<never> => {
      console.error(`[MentorshipService] ${label} failed`, { status: err.status, statusText: err.statusText });
      return throwError(() => err);
    };
  }
}
