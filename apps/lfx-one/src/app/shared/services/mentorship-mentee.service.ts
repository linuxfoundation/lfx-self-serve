// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  MentorshipMenteeApplicationsResponse,
  MentorshipMenteeApplyTarget,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeProfileResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, shareReplay, throwError } from 'rxjs';

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

  public getMenteeProfile(): Observable<MentorshipMenteeProfileResponse> {
    return this.http.get<MentorshipMenteeProfileResponse>('/api/mentorship/mentee/profile').pipe(catchError(this.rethrowError('getMenteeProfile')));
  }

  /** Program name, project, and term name for the mentee apply header. Rethrows so the page can show a retry. */
  public getMenteeApplyTarget(programId: string, programTermId: string): Observable<MentorshipMenteeApplyTarget> {
    const params = new HttpParams().set('programId', programId).set('programTermId', programTermId);
    return this.http
      .get<MentorshipMenteeApplyTarget>('/api/mentorship/mentee/apply-target', { params })
      .pipe(catchError(this.rethrowError('getMenteeApplyTarget')));
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
