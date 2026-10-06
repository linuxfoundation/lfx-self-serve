// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE,
  EMPTY_MENTORSHIP_LF_PROJECTS_RESPONSE,
  MENTORSHIP_INVITABLE_USER_PAGE_SIZE,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiBadge,
  MentorshipInvitableUsersResponse,
  MentorshipLfProjectsResponse,
  MentorshipLfxProfileFields,
  MentorshipNameAvailability,
  MentorshipProgramDecisionRequest,
  MentorshipProgramReview,
  MentorshipProgramReviewDecision,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/*` endpoints.
 *
 * Shape mirrors `CrowdfundingService` deliberately: lookups degrade to an empty
 * response on error so the enroll flow never blocks on upstream faults.
 * The admin pages' reads live in `MentorshipAdminService` and the mentor pages' in `MentorshipMentorService`.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipService {
  private readonly http = inject(HttpClient);

  public isProgramNameAvailable(name: string): Observable<MentorshipNameAvailability> {
    return this.http.get<MentorshipNameAvailability>('/api/mentorship/programs/name-available', { params: new HttpParams().set('name', name) }).pipe(take(1));
  }

  /** One lazy-load page of LF projects; pass the previous page's `nextPageToken` as `pageToken` for the next one. */
  public getLfProjects(params?: { search?: string; pageToken?: string | null; limit?: number }): Observable<MentorshipLfProjectsResponse> {
    let httpParams = new HttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.pageToken) httpParams = httpParams.set('pageToken', params.pageToken);
    httpParams = httpParams.set('limit', String(params?.limit ?? MENTORSHIP_LF_PROJECT_PAGE_SIZE));

    return this.http
      .get<MentorshipLfProjectsResponse>('/api/mentorship/lf-projects', { params: httpParams })
      .pipe(catchError(this.handleError(EMPTY_MENTORSHIP_LF_PROJECTS_RESPONSE, 'getLfProjects')));
  }

  /** LFX users that can be invited as mentors. Not program-scoped. */
  public getInvitableUsers(params?: { search?: string; offset?: number; limit?: number }): Observable<MentorshipInvitableUsersResponse> {
    let httpParams = new HttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    httpParams = httpParams.set('limit', String(params?.limit ?? MENTORSHIP_INVITABLE_USER_PAGE_SIZE));

    return this.http
      .get<MentorshipInvitableUsersResponse>('/api/mentorship/invitable-users', { params: httpParams })
      .pipe(catchError(this.handleError(EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE, 'getInvitableUsers')));
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

  private rethrowError(label: string) {
    return (err: HttpErrorResponse): Observable<never> => {
      if (err.status !== 404) {
        console.error(`[MentorshipService] ${label} failed`, err);
      }
      return throwError(() => err);
    };
  }
}
