// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AcceptProjectApplicationRequest,
  CreateProjectApplicationRequest,
  ProjectApplication,
  ProjectApplicationAccess,
  ProjectApplicationAnswers,
  ProjectApplicationWriteResult,
  ProjectApplicationViewMode,
} from '@lfx-one/shared/interfaces';
import { PROJECT_APPLICATION_API_BASE_PATH } from '@lfx-one/shared/constants';
import { catchError, map, Observable, of, take, throwError } from 'rxjs';

/**
 * Browser client for the project-application BFF (#3037). Answers are private: nothing here writes
 * to browser storage, and only the application UID ever appears in a URL. Every mutation sends the
 * held `revision` as `If-Match`; a 412 is surfaced to the caller to refresh, never replayed.
 */
@Injectable({ providedIn: 'root' })
export class ProjectApplicationService {
  private readonly http = inject(HttpClient);

  /**
   * The application a just-finished submit returned, handed from the propose page to the
   * "Submitted proposals" list so it renders immediately — query-service lags a successful write.
   * In memory only, and consumed once.
   */
  private pendingCreated: ProjectApplication | null = null;

  /**
   * Rethrows rather than defaulting to `[]`: an empty list would read as "no proposals" when the read
   * actually failed; the list shows its error state instead.
   */
  public getApplications(mode: ProjectApplicationViewMode): Observable<ProjectApplication[]> {
    return this.http.get<ProjectApplication[]>(`${PROJECT_APPLICATION_API_BASE_PATH}/${mode === 'staff' ? 'queue' : 'mine'}`).pipe(
      catchError((error: unknown) => {
        console.error('[ProjectApplicationService] Failed to load project applications', error);
        return throwError(() => error);
      })
    );
  }

  /** Whether the caller is on the formation team. Fails closed to `false` on any error. */
  public getAccess(): Observable<boolean> {
    return this.http.get<ProjectApplicationAccess>(`${PROJECT_APPLICATION_API_BASE_PATH}/access`).pipe(
      map((access) => access?.is_formation_team === true),
      catchError((error: unknown) => {
        console.error('[ProjectApplicationService] Failed to load project-application access', error);
        return of(false);
      })
    );
  }

  public create(application: ProjectApplicationAnswers): Observable<ProjectApplicationWriteResult> {
    const body: CreateProjectApplicationRequest = { application };
    return this.http.post<ProjectApplicationWriteResult>(PROJECT_APPLICATION_API_BASE_PATH, body).pipe(take(1));
  }

  /** Replaces the complete answer map — pass every answer, including keys this UI does not know. */
  public revise(application: ProjectApplication, answers: ProjectApplicationAnswers): Observable<ProjectApplicationWriteResult> {
    return this.http
      .put<ProjectApplicationWriteResult>(this.applicationPath(application.uid), { application: answers }, this.ifMatch(application))
      .pipe(take(1));
  }

  public withdraw(application: ProjectApplication): Observable<ProjectApplicationWriteResult> {
    return this.http.post<ProjectApplicationWriteResult>(`${this.applicationPath(application.uid)}/withdraw`, {}, this.ifMatch(application)).pipe(take(1));
  }

  public deny(application: ProjectApplication): Observable<ProjectApplicationWriteResult> {
    return this.http.post<ProjectApplicationWriteResult>(`${this.applicationPath(application.uid)}/deny`, {}, this.ifMatch(application)).pipe(take(1));
  }

  /** Records the chosen parent and accepts; the backend then creates the project. */
  public accept(application: ProjectApplication, parentProjectUid: string): Observable<ProjectApplicationWriteResult> {
    const body: AcceptProjectApplicationRequest = { parent_project_uid: parentProjectUid, application: application.application };
    return this.http.post<ProjectApplicationWriteResult>(`${this.applicationPath(application.uid)}/accept`, body, this.ifMatch(application)).pipe(take(1));
  }

  public remove(application: ProjectApplication): Observable<void> {
    return this.http.delete<void>(this.applicationPath(application.uid), this.ifMatch(application)).pipe(take(1));
  }

  public setPendingCreated(application: ProjectApplication): void {
    this.pendingCreated = application;
  }

  public consumePendingCreated(): ProjectApplication | null {
    const pending = this.pendingCreated;
    this.pendingCreated = null;
    return pending;
  }

  private applicationPath(uid: string): string {
    return `${PROJECT_APPLICATION_API_BASE_PATH}/${encodeURIComponent(uid)}`;
  }

  private ifMatch(application: ProjectApplication): { headers: Record<string, string> } {
    return { headers: { 'If-Match': String(application.revision) } };
  }
}
