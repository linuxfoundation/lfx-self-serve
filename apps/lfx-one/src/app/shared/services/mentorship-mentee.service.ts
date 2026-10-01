// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  MentorshipMenteeApplicationsResponse,
  MentorshipMenteeApplyIds,
  MentorshipMenteeApplyTarget,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeRegisterRequest,
  MentorshipMenteeProfileUpdateRequest,
  MentorshipMenteeProfileUpdateResponse,
  MentorshipMenteeTaskStatusUpdateRequest,
  MentorshipMenteeUpdatableTaskStatus,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, shareReplay, take, tap, throwError } from 'rxjs';

/** Talks to the LFX One BFF's `/api/mentorship/mentee/*` endpoints. */
@Injectable({ providedIn: 'root' })
export class MentorshipMenteeService {
  private readonly http = inject(HttpClient);

  /**
   * Session cache for the mentee's applications (with their tasks). The Overview, the My Tasks
   * tab and the shell's open-task badge all derive from this one payload, so a tab switch does
   * not re-fetch it. `shareReplay({ bufferSize: 1, refCount: false })` keeps the first
   * successful response and replays it to later subscribers; a failure clears the slot so the
   * next read fetches fresh.
   *
   * The slot lasts for the browser session. An identity swap is a full document load here, so
   * this cache is not torn down on user change the way `UserService` is. Call
   * `clearMenteeCaches()` after any write that changes an application or a task (apply,
   * withdraw, task status or file updates), and on a user Retry.
   */
  private menteeApplications$: Observable<MentorshipMenteeApplicationsResponse> | null = null;
  private readonly menteeApplicationsRevisionSignal = signal(0);

  /**
   * Bumped by `clearMenteeCaches()`. The shell and its routed tabs each re-read the applications
   * off this signal, so a Retry in one tab also refreshes the shell's badge and the other tab.
   */
  public readonly menteeApplicationsRevision = this.menteeApplicationsRevisionSignal.asReadonly();

  /** Checks whether the signed-in user already has a mentee profile. */
  public hasMenteeProfile(): Observable<MentorshipMenteeHasProfileResponse> {
    return this.http
      .get<MentorshipMenteeHasProfileResponse>('/api/mentorship/mentee/has-profile')
      .pipe(catchError(this.handleError({ hasProfile: false }, 'hasMenteeProfile')));
  }

  /**
   * Creates the signed-in user's mentee profile from the register form. Failures propagate as the
   * raw `HttpErrorResponse` so the register page can read the status and code. Nothing cached
   * changes (the profile is not cached and a new profile has no applications), so no cache is cleared.
   */
  public registerMenteeProfile(request: MentorshipMenteeRegisterRequest): Observable<void> {
    return this.http.post<void>('/api/mentorship/mentee/profile', request).pipe(take(1));
  }

  /** Drop the cached applications and tell every reader to fetch them again. */
  public clearMenteeCaches(): void {
    this.menteeApplications$ = null;
    this.menteeApplicationsRevisionSignal.update((revision) => revision + 1);
  }

  /** The signed-in mentee's applications with their tasks, cached for the session. Rethrows so pages can show a retry. */
  public getMenteeApplications(): Observable<MentorshipMenteeApplicationsResponse> {
    if (!this.menteeApplications$) {
      const params = new HttpParams().set('withTasks', 'true');
      this.menteeApplications$ = this.http.get<MentorshipMenteeApplicationsResponse>('/api/mentorship/mentee/applications', { params }).pipe(
        catchError((err: HttpErrorResponse) => {
          this.menteeApplications$ = null; // don't cache failures — the next read retries
          return this.rethrowError('getMenteeApplications')(err);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.menteeApplications$;
  }

  /**
   * Withdraws one of the signed-in mentee's pending applications. On success the cached
   * applications are dropped, so the Overview, My Tasks and the profile's history re-read.
   * A failure is left to the caller, which decides whether the list is stale.
   */
  public withdrawMenteeApplication(applicationId: string): Observable<void> {
    return this.http.post<void>(`/api/mentorship/mentee/applications/${encodeURIComponent(applicationId)}/withdraw`, null).pipe(
      take(1),
      tap(() => this.clearMenteeCaches())
    );
  }

  /**
   * Moves one of the signed-in mentee's tasks to `in_progress` or `submitted`. The body is only the
   * status: file upload is not wired, so no file is ever sent. On success the cached applications are
   * dropped, so the Overview, My Tasks and the open-task badge re-read. A failure is left to the caller,
   * which decides whether the tasks are stale.
   */
  public updateMenteeTaskStatus(taskId: string, status: MentorshipMenteeUpdatableTaskStatus): Observable<void> {
    const body: MentorshipMenteeTaskStatusUpdateRequest = { status };
    return this.http.patch<void>(`/api/mentorship/mentee/tasks/${encodeURIComponent(taskId)}`, body).pipe(
      take(1),
      tap(() => this.clearMenteeCaches())
    );
  }

  public getMenteeProfile(): Observable<MentorshipMenteeProfileResponse> {
    return this.http.get<MentorshipMenteeProfileResponse>('/api/mentorship/mentee/profile').pipe(catchError(this.rethrowError('getMenteeProfile')));
  }

  /**
   * Saves the changed groups of the signed-in mentee's profile and returns the saved profile. Unlike
   * a withdraw or an apply it leaves the cached applications alone: a profile edit changes no
   * application or task, so nothing else needs to re-read. Rethrows so the drawer can show the failure.
   */
  public updateMenteeProfile(request: MentorshipMenteeProfileUpdateRequest): Observable<MentorshipMenteeProfileUpdateResponse> {
    return this.http
      .patch<MentorshipMenteeProfileUpdateResponse>('/api/mentorship/mentee/profile', request)
      .pipe(take(1), catchError(this.rethrowError('updateMenteeProfile')));
  }

  /**
   * Program name, project, term name, and whether the term is taking applications, for the mentee
   * apply page. Rethrows so the page can tell a missing term (404) from a failure it can retry.
   */
  public getMenteeApplyTarget(programId: string, programTermId: string): Observable<MentorshipMenteeApplyTarget> {
    const params = new HttpParams().set('programId', programId).set('programTermId', programTermId);
    return this.http
      .get<MentorshipMenteeApplyTarget>('/api/mentorship/mentee/apply-target', { params })
      .pipe(catchError(this.rethrowError('getMenteeApplyTarget')));
  }

  /**
   * Applies the signed-in user as a mentee to a program term. On success the cached applications
   * are dropped, so the Overview and My Tasks show the new application. A failure is left to the
   * caller, which maps upstream's 422 (closed) and 409 (already applied) to their own states.
   */
  public applyToMenteeTerm(ids: MentorshipMenteeApplyIds): Observable<void> {
    return this.http.post<void>('/api/mentorship/mentee/apply', ids).pipe(
      take(1),
      tap(() => this.clearMenteeCaches())
    );
  }

  /** A 404 falls back silently; other failures log to the console and fall back too. */
  private handleError<T>(fallback: T, label: string) {
    return (err: HttpErrorResponse): Observable<T> => {
      if (err.status !== 404) {
        console.error(`[MentorshipMenteeService] ${label} failed`, err);
      }
      return of(fallback);
    };
  }

  private rethrowError(label: string) {
    return (err: HttpErrorResponse): Observable<never> => {
      if (err.status !== 404) {
        console.error(`[MentorshipMenteeService] ${label} failed`, err);
      }
      return throwError(() => err);
    };
  }
}
