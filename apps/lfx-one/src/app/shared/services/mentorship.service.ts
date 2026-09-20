// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE,
  EMPTY_MENTORSHIP_LF_PROJECTS_RESPONSE,
  EMPTY_MENTORSHIP_PROGRAMS_RESPONSE,
  MENTORSHIP_INVITABLE_USER_PAGE_SIZE,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiBadge,
  MentorshipInvitableUsersResponse,
  MentorshipLfProjectsResponse,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePhase,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeTasksResponse,
  MentorshipMentorProfileResponse,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramsResponse,
  MentorshipNameAvailability,
  MentorshipProgramDetail,
  MentorshipProgramsResponse,
  MentorshipProgramStatus,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/*` endpoints.
 *
 * Shape mirrors `CrowdfundingService` deliberately: list degrades to an empty
 * response on error so the admin surface never blocks on upstream faults.
 * Mentor-program and profile reads rethrow so their callers can surface
 * explicit retry or failure states.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipService {
  private readonly http = inject(HttpClient);

  public getPrograms(params?: { search?: string; status?: MentorshipProgramStatus; offset?: number; limit?: number }): Observable<MentorshipProgramsResponse> {
    let httpParams = new HttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
    if (params?.limit !== undefined) httpParams = httpParams.set('limit', String(params.limit));

    return this.http
      .get<MentorshipProgramsResponse>('/api/mentorship/programs', { params: httpParams })
      .pipe(catchError(this.handleError(EMPTY_MENTORSHIP_PROGRAMS_RESPONSE, 'getPrograms')));
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

  /** Loads a program by id (default URL) or slug. */
  public getProgram(programId: string): Observable<MentorshipProgramDetail | null> {
    return this.http
      .get<MentorshipProgramDetail>(`/api/mentorship/programs/${encodeURIComponent(programId)}`)
      .pipe(catchError(this.handleError(null, 'getProgram')));
  }

  public isProgramNameAvailable(name: string): Observable<MentorshipNameAvailability> {
    return this.http.get<MentorshipNameAvailability>('/api/mentorship/programs/name-available', { params: new HttpParams().set('name', name) }).pipe(take(1));
  }

  public getLfProjects(params?: { search?: string; offset?: number; limit?: number }): Observable<MentorshipLfProjectsResponse> {
    let httpParams = new HttpParams();
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.offset !== undefined) httpParams = httpParams.set('offset', String(params.offset));
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

  // ---------------------------------------------------------------------------
  // Mentee endpoints
  // ---------------------------------------------------------------------------

  /** Checks whether the signed-in user already has a mentee profile. */
  public hasMenteeProfile(): Observable<MentorshipMenteeHasProfileResponse> {
    return this.http
      .get<MentorshipMenteeHasProfileResponse>('/api/mentorship/mentee/has-profile')
      .pipe(catchError(this.handleError({ hasProfile: false }, 'hasMenteeProfile')));
  }

  public getMenteeOverview(phase?: MentorshipMenteePhase): Observable<MentorshipMenteeOverviewResponse> {
    let params = new HttpParams();
    if (phase) params = params.set('phase', phase);
    return this.http
      .get<MentorshipMenteeOverviewResponse>('/api/mentorship/mentee/overview', { params })
      .pipe(catchError(this.rethrowError('getMenteeOverview')));
  }

  public getMenteeTasks(): Observable<MentorshipMenteeTasksResponse> {
    return this.http.get<MentorshipMenteeTasksResponse>('/api/mentorship/mentee/tasks').pipe(catchError(this.rethrowError('getMenteeTasks')));
  }

  public getMenteeProfile(): Observable<MentorshipMenteeProfileResponse> {
    return this.http.get<MentorshipMenteeProfileResponse>('/api/mentorship/mentee/profile').pipe(catchError(this.rethrowError('getMenteeProfile')));
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
