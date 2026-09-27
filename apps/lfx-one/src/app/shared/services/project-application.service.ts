// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Signal, signal } from '@angular/core';
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
import { upsertProjectApplication } from '@lfx-one/shared/utils';
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
   * Write results the index hasn't caught up with yet, per list mode. The list applies them to every read
   * (`reconcileProjectApplications`); {@link reconcile} prunes them once a read catches up. Root-scoped so it outlives a panel destroyed by a tab switch; entries are pruned once
   * a read returns the same or a newer revision (or confirms a deletion). In memory only — never browser
   * storage — and gone on any full navigation, including sign-out and impersonation changes.
   */
  private readonly overlays = {
    submitter: signal<ProjectApplication[]>([]),
    staff: signal<ProjectApplication[]>([]),
  };
  private readonly deletions = {
    submitter: signal<ReadonlySet<string>>(new Set()),
    staff: signal<ReadonlySet<string>>(new Set()),
  };

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

  /** The overlay for one list mode, as a signal so the list recomputes when a write lands. */
  public overlay(mode: ProjectApplicationViewMode): Signal<ProjectApplication[]> {
    return this.overlays[mode].asReadonly();
  }

  public deletedUids(mode: ProjectApplicationViewMode): Signal<ReadonlySet<string>> {
    return this.deletions[mode].asReadonly();
  }

  /** Records a successful write (including create) so every list shows it before the index does. */
  public recordWrite(mode: ProjectApplicationViewMode, application: ProjectApplication): void {
    this.overlays[mode].update((list) => upsertProjectApplication(list, application));
  }

  /** Records a deletion — the caller's own, or a 404 proving the application is gone. */
  public recordDeleted(mode: ProjectApplicationViewMode, uid: string): void {
    this.overlays[mode].update((list) => list.filter((application) => application.uid !== uid));
    this.deletions[mode].update((set) => new Set([...set, uid]));
  }

  /** Drops the overlay entry for one application so the next read wins (after a 412). */
  public forget(mode: ProjectApplicationViewMode, uid: string): void {
    this.overlays[mode].update((list) => list.filter((application) => application.uid !== uid));
  }

  /**
   * Prunes this mode's overlay against a fresh read: drops overlay entries the read now carries at the same or a
   * newer revision, and deletions the read no longer returns. It does not merge — the list applies the overlay
   * to each read itself, via `reconcileProjectApplications` (shared utils).
   */
  public reconcile(mode: ProjectApplicationViewMode, fetched: ProjectApplication[]): void {
    const byUid = new Map(fetched.map((application) => [application.uid, application]));
    this.overlays[mode].update((list) => list.filter((local) => (byUid.get(local.uid)?.revision ?? -1) < local.revision));
    this.deletions[mode].update((set) => new Set([...set].filter((uid) => byUid.has(uid))));
  }

  private applicationPath(uid: string): string {
    return `${PROJECT_APPLICATION_API_BASE_PATH}/${encodeURIComponent(uid)}`;
  }

  private ifMatch(application: ProjectApplication): { headers: Record<string, string> } {
    return { headers: { 'If-Match': String(application.revision) } };
  }
}
