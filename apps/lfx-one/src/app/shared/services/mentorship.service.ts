// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE, MENTORSHIP_INVITABLE_USER_PAGE_SIZE, MENTORSHIP_LF_PROJECT_PAGE_SIZE } from '@lfx-one/shared/constants';
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

import { strictHttpParams } from '../utils/http-params.utils';

/**
 * Talks to the LFX One BFF's `/api/mentorship/*` endpoints.
 *
 * Errors propagate to the caller, which owns the unavailable or retry state: the name check (the
 * wizard holds Next while it cannot confirm the name), the project picker's pages (Retry rather than
 * a failure shown as no projects, or a truncated list as complete), the CII badge (a 404 is `null`)
 * and the review and profile calls.
 * The invitable-user lookup is the exception: it degrades to an empty response, as in `CrowdfundingService`.
 * The admin pages' reads live in `MentorshipAdminService` and the mentor pages' in `MentorshipMentorService`.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipService {
  private readonly http = inject(HttpClient);

  public isProgramNameAvailable(name: string): Observable<MentorshipNameAvailability> {
    return this.http.get<MentorshipNameAvailability>('/api/mentorship/programs/name-available', { params: strictHttpParams().set('name', name) }).pipe(take(1));
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
