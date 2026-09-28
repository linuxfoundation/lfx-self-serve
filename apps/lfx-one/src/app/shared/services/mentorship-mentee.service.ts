// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  MentorshipMenteeApplyTarget,
  MentorshipMenteeHasProfileResponse,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteePhase,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeTasksResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, shareReplay, throwError } from 'rxjs';

/** Talks to the LFX One BFF's `/api/mentorship/mentee/*` endpoints. */
@Injectable({ providedIn: 'root' })
export class MentorshipMenteeService {
  private readonly http = inject(HttpClient);

  /**
   * Session cache for the mentee overview/tasks reads. The Overview and the
   * "My Application Tasks" / "My Tasks" tabs read the same unparameterized
   * payload, so without this a plain overview↔tasks tab switch re-fetched the
   * whole response every time. `shareReplay({ bufferSize: 1, refCount: false })`
   * keeps the first successful response and replays it to later subscribers. A
   * failure clears that slot so the next read fetches fresh. A user Retry calls
   * `clearMenteeCaches()` so a successful-but-unusable payload (a non-applicant
   * phase on the applicant tab) is not replayed forever. Phase-scoped overview
   * reads (the dev phase switcher) bypass the cache and never fill it.
   *
   * The slots last for the browser session. An identity swap is a full document
   * load here, so this cache is not torn down on user change the way
   * `UserService` is. Server-side mentee updates stay stale until reload or
   * `clearMenteeCaches()`. Add write-path invalidation once real write
   * endpoints land.
   */
  private menteeOverview$: Observable<MentorshipMenteeOverviewResponse> | null = null;
  private menteeTasks$: Observable<MentorshipMenteeTasksResponse> | null = null;

  /** Checks whether the signed-in user already has a mentee profile. */
  public hasMenteeProfile(): Observable<MentorshipMenteeHasProfileResponse> {
    return this.http
      .get<MentorshipMenteeHasProfileResponse>('/api/mentorship/mentee/has-profile')
      .pipe(catchError(this.handleError({ hasProfile: false }, 'hasMenteeProfile')));
  }

  /** Drop cached mentee overview and tasks so the next read hits the network. */
  public clearMenteeCaches(): void {
    this.menteeOverview$ = null;
    this.menteeTasks$ = null;
  }

  public getMenteeOverview(phase?: MentorshipMenteePhase): Observable<MentorshipMenteeOverviewResponse> {
    // Phase-scoped reads (dev phase switcher) are one-off and must never be cached.
    if (phase) return this.fetchMenteeOverview(phase);
    if (!this.menteeOverview$) {
      this.menteeOverview$ = this.fetchMenteeOverview().pipe(
        catchError((err: unknown) => {
          this.menteeOverview$ = null; // don't cache failures — the next read retries
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.menteeOverview$;
  }

  public getMenteeTasks(): Observable<MentorshipMenteeTasksResponse> {
    if (!this.menteeTasks$) {
      this.menteeTasks$ = this.fetchMenteeTasks().pipe(
        catchError((err: unknown) => {
          this.menteeTasks$ = null; // don't cache failures — the next read retries
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.menteeTasks$;
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

  private fetchMenteeOverview(phase?: MentorshipMenteePhase): Observable<MentorshipMenteeOverviewResponse> {
    let params = new HttpParams();
    if (phase) params = params.set('phase', phase);
    return this.http
      .get<MentorshipMenteeOverviewResponse>('/api/mentorship/mentee/overview', { params })
      .pipe(catchError(this.rethrowError('getMenteeOverview')));
  }

  private fetchMenteeTasks(): Observable<MentorshipMenteeTasksResponse> {
    return this.http.get<MentorshipMenteeTasksResponse>('/api/mentorship/mentee/tasks').pipe(catchError(this.rethrowError('getMenteeTasks')));
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
