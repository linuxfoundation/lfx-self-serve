// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  MentorshipMentorApplicationNoteUpdate,
  MentorshipMentorHasProfileResponse,
  MentorshipMentorInviteDecision,
  MentorshipMentorInviteResponseRequest,
  MentorshipMentorOpenProgramsQuery,
  MentorshipMentorOpenProgramsResponse,
  MentorshipMentorProfileResponse,
  MentorshipMentorProfileUpdateRequest,
  MentorshipMentorProfileUpdateResponse,
  MentorshipMentorProgramDetail,
  MentorshipMentorProgramRequestCreate,
  MentorshipMentorProgramRequestsResponse,
  MentorshipMentorProgramsResponse,
  MentorshipMentorRegisterRequest,
  MentorshipMentorTaskReviewDecision,
  MentorshipMentorTaskReviewUpdate,
} from '@lfx-one/shared/interfaces';
import { strictHttpParams } from '@shared/utils/http-params.utils';
import { catchError, Observable, of, shareReplay, take, tap, throwError } from 'rxjs';

/**
 * Talks to the LFX One BFF's `/api/mentorship/mentor/*` endpoints. The page reads rethrow so each
 * page can render an explicit retry or not-found state; the has-profile check falls back instead.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipMentorService {
  private readonly http = inject(HttpClient);

  /**
   * The signed-in mentor's program requests, kept so the register page and the profile drawer do not
   * each re-fetch them. `shareReplay({ bufferSize: 1, refCount: false })` replays the first successful
   * response; a failure clears the slot so the next read fetches fresh. Call `clearMentorCaches()`
   * after any write that changes a request (request, withdraw), and on a user Retry.
   */
  private mentorRequests$: Observable<MentorshipMentorProgramRequestsResponse> | null = null;
  private readonly mentorRequestsRevisionSignal = signal(0);

  /** Bumped by `clearMentorCaches()`, so a view showing the requests re-reads them after a write. */
  public readonly mentorRequestsRevision = this.mentorRequestsRevisionSignal.asReadonly();

  private readonly unavailableProgramIdsSignal = signal<string[]>([]);

  /** Programs a request found gone (404) this session. The picker lists them disabled, since a page it already read still holds them. */
  public readonly unavailableProgramIds = this.unavailableProgramIdsSignal.asReadonly();

  /**
   * Checks whether the signed-in user already has a mentor profile. A failed check reports no
   * profile, so the register page still opens and its own save refuses an existing profile.
   */
  public hasMentorProfile(): Observable<MentorshipMentorHasProfileResponse> {
    return this.http.get<MentorshipMentorHasProfileResponse>('/api/mentorship/mentor/has-profile').pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status !== 404) {
          console.error('[MentorshipMentorService] hasMentorProfile failed', err);
        }
        return of({ hasProfile: false });
      })
    );
  }

  /**
   * Creates the signed-in user's mentor profile from the register form. Failures propagate as the
   * raw `HttpErrorResponse` so the register page can read the status and code.
   */
  public registerMentorProfile(request: MentorshipMentorRegisterRequest): Observable<void> {
    return this.http.post<void>('/api/mentorship/mentor/profile', request).pipe(take(1));
  }

  public clearMentorCaches(): void {
    this.mentorRequests$ = null;
    this.mentorRequestsRevisionSignal.update((revision) => revision + 1);
  }

  public markProgramUnavailable(programId: string): void {
    this.unavailableProgramIdsSignal.update((programIds) => (programIds.includes(programId) ? programIds : [...programIds, programId]));
  }

  /**
   * One page of published programs for the request picker, optionally narrowed by name. Rethrows; the
   * picker shows the failure. The search is typed text, so it goes through `strictHttpParams`: the
   * default codec leaves `+` bare and Express would read `C++` as `C  `.
   */
  public getOpenPrograms(query: MentorshipMentorOpenProgramsQuery = {}): Observable<MentorshipMentorOpenProgramsResponse> {
    let params = strictHttpParams();
    if (query.search) params = params.set('search', query.search);
    if (query.offset) params = params.set('offset', String(query.offset));
    return this.http
      .get<MentorshipMentorOpenProgramsResponse>('/api/mentorship/mentor/open-programs', { params })
      .pipe(catchError(this.rethrowError('getOpenPrograms')));
  }

  /** The signed-in mentor's program requests, cached for the session. Rethrows so the profile drawer can show a failed state with Retry. */
  public getMentorRequests(): Observable<MentorshipMentorProgramRequestsResponse> {
    if (!this.mentorRequests$) {
      this.mentorRequests$ = this.http.get<MentorshipMentorProgramRequestsResponse>('/api/mentorship/mentor/requests').pipe(
        catchError((err: HttpErrorResponse) => {
          this.mentorRequests$ = null; // don't cache failures — the next read retries
          return this.rethrowError('getMentorRequests')(err);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }
    return this.mentorRequests$;
  }

  /**
   * Asks to join a program as a mentor; the request is for the whole program. Failures propagate
   * as the raw `HttpErrorResponse`. A success drops the cached requests.
   */
  public requestToMentor(programId: string): Observable<void> {
    const body: MentorshipMentorProgramRequestCreate = { programId };
    return this.http.post<void>('/api/mentorship/mentor/requests', body).pipe(
      take(1),
      tap(() => this.clearMentorCaches())
    );
  }

  /** Withdraws one of the signed-in mentor's pending requests. Failures propagate raw; a success drops the cached requests. */
  public withdrawMentorRequest(requestId: string): Observable<void> {
    return this.http.post<void>(`/api/mentorship/mentor/requests/${encodeURIComponent(requestId)}/withdraw`, null).pipe(
      take(1),
      tap(() => this.clearMentorCaches())
    );
  }

  /** Accepts or declines a mentor invitation with the token from the invite email. Failures propagate raw; a success drops the cached requests. */
  public respondToMentorInvite(token: string, decision: MentorshipMentorInviteDecision): Observable<void> {
    const body: MentorshipMentorInviteResponseRequest = { token };
    return this.http.post<void>(`/api/mentorship/mentor/invites/${decision}`, body).pipe(
      take(1),
      tap(() => this.clearMentorCaches())
    );
  }

  public getMentorPrograms(): Observable<MentorshipMentorProgramsResponse> {
    return this.http.get<MentorshipMentorProgramsResponse>('/api/mentorship/mentor/programs').pipe(catchError(this.rethrowError('getMentorPrograms')));
  }

  public getMentorProfile(): Observable<MentorshipMentorProfileResponse> {
    return this.http.get<MentorshipMentorProfileResponse>('/api/mentorship/mentor/profile').pipe(catchError(this.rethrowError('getMentorProfile')));
  }

  /** PATCHes the changed profile fields and emits the saved profile once. Rethrows so the edit drawer can show the failure inline. */
  public updateMentorProfile(request: MentorshipMentorProfileUpdateRequest): Observable<MentorshipMentorProfileUpdateResponse> {
    return this.http
      .patch<MentorshipMentorProfileUpdateResponse>('/api/mentorship/mentor/profile', request)
      .pipe(take(1), catchError(this.rethrowError('updateMentorProfile')));
  }

  /** Loads a mentor program by id (default URL) or slug. */
  public getMentorProgram(programId: string): Observable<MentorshipMentorProgramDetail> {
    return this.http
      .get<MentorshipMentorProgramDetail>(`/api/mentorship/mentor/programs/${encodeURIComponent(programId)}`)
      .pipe(catchError(this.rethrowError('getMentorProgram')));
  }

  /**
   * Saves the reviewer note on one application of a program the mentor mentors; an empty note clears it.
   * Failures propagate as the raw `HttpErrorResponse`.
   */
  public updateApplicationNote(applicationId: string, note: string): Observable<void> {
    const body: MentorshipMentorApplicationNoteUpdate = { note };
    return this.http.put<void>(`/api/mentorship/mentor/applications/${encodeURIComponent(applicationId)}/note`, body).pipe(take(1));
  }

  /**
   * Approves (`complete`) or requests changes on (`incomplete`) a mentee's submitted task. Failures propagate as the
   * raw `HttpErrorResponse`; a 409 means the task is no longer awaiting review.
   */
  public reviewMenteeTask(taskId: string, status: MentorshipMentorTaskReviewDecision): Observable<void> {
    const body: MentorshipMentorTaskReviewUpdate = { status };
    return this.http.patch<void>(`/api/mentorship/mentor/tasks/${encodeURIComponent(taskId)}/review`, body).pipe(take(1));
  }

  private rethrowError(label: string) {
    return (err: HttpErrorResponse): Observable<never> => {
      if (err.status !== 404) {
        console.error(`[MentorshipMentorService] ${label} failed`, err);
      }
      return throwError(() => err);
    };
  }
}
