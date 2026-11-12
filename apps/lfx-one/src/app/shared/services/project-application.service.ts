// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  AcceptProjectApplicationRequest,
  CreateProjectApplicationRequest,
  Project,
  ProjectApplication,
  ProjectApplicationAccess,
  ProjectApplicationAccessState,
  ProjectApplicationAnswers,
  ProjectApplicationWriteResult,
  ProjectApplicationViewMode,
} from '@lfx-one/shared/interfaces';
import { PROJECT_APPLICATION_API_BASE_PATH } from '@lfx-one/shared/constants';
import { computeIsFoundation, countOpenProjectApplications, isUuid, reconcileProjectApplications, upsertProjectApplication } from '@lfx-one/shared/utils';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { catchError, distinctUntilChanged, map, Observable, of, skip, Subscription, take, throwError } from 'rxjs';

/**
 * Browser client for the project-application BFF (#3037). Answers are private: nothing here writes
 * to browser storage, and only the application UID ever appears in a URL. Every mutation sends the
 * held `revision` as `If-Match`; a 412 is surfaced to the caller to refresh, never replayed.
 */
@Injectable({ providedIn: 'root' })
export class ProjectApplicationService {
  private readonly http = inject(HttpClient);
  private readonly projectService = inject(ProjectService);
  private readonly userService = inject(UserService);

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

  private readonly staffFetched = signal<ProjectApplication[] | null>(null);
  private readonly staffLoadingState = signal(false);
  private readonly staffErrorState = signal(false);
  private staffRead: Subscription | null = null;

  /** The formation team's queue as last read, or `null` before the first successful read (or after an identity change). Never cleared by a failed read. */
  public readonly staffFetchedApplications: Signal<ProjectApplication[] | null> = this.staffFetched.asReadonly();
  /** A staff read is in flight. */
  public readonly staffLoading: Signal<boolean> = this.staffLoadingState.asReadonly();
  /** The latest staff read failed and none has succeeded since; the next {@link refreshStaff} tries again. */
  public readonly staffError: Signal<boolean> = this.staffErrorState.asReadonly();
  /** The staff queue as the panel shows it: the last read plus the write overlay, minus deletions. `null` until a read has succeeded. */
  public readonly staffApplications: Signal<ProjectApplication[] | null> = computed(() => {
    const fetched = this.staffFetched();
    return fetched === null ? null : reconcileProjectApplications(fetched, this.overlays.staff(), this.deletions.staff());
  });
  /**
   * Applications awaiting a decision over {@link staffApplications}, so the Formations tab and the panel agree and
   * an accept, deny or withdraw (recorded in the overlay) drops it without a refetch. `null` — never 0 — until
   * a read has succeeded, and from a failed read until the next one succeeds (a retry stays hidden). While a refresh
   * after a successful read is pending, the last good count stays visible, so the badge doesn't flicker.
   */
  public readonly pendingStaffCount: Signal<number | null> = computed(() => {
    const merged = this.staffApplications();
    return merged === null || this.staffErrorState() ? null : countOpenProjectApplications(merged);
  });

  public constructor() {
    // The queue, overlays and deletions belong to one signed-in identity: drop them when the user or the
    // impersonated persona changes, so a formation-team member's queue never shows for the next identity.
    toObservable(this.userService.meetingFeedIdentity)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed())
      .subscribe(() => this.resetForIdentityChange());
  }

  /**
   * Reads the staff queue into {@link staffFetchedApplications}. A read already in flight is joined rather than
   * duplicated, so the Formations page and the panel asking together make one request; pass `supersede` to
   * cancel it and read again (after a 412). A failed read keeps the last good list and sets {@link staffError}.
   */
  public refreshStaff(options: { supersede?: boolean } = {}): void {
    if (this.staffRead && !this.staffRead.closed) {
      if (!options.supersede) {
        return;
      }
      this.staffRead.unsubscribe();
    }
    // The error flag stays set until a read succeeds, so a retry never brings a hidden count back before it lands.
    this.staffLoadingState.set(true);
    // A response only counts for the identity the read started under; the identity-change reset also cancels the read.
    const identity = this.userService.meetingFeedIdentity();
    const current = (): boolean => identity === this.userService.meetingFeedIdentity();
    const read: Subscription = this.getApplications('staff').subscribe({
      next: (applications) => {
        if (!current()) {
          return;
        }
        this.reconcile('staff', applications);
        this.staffFetched.set(applications);
        this.staffErrorState.set(false);
      },
      error: () => {
        if (!current()) {
          return;
        }
        this.staffErrorState.set(true);
        this.staffLoadingState.set(false);
      },
      complete: () => {
        if (current()) {
          this.staffLoadingState.set(false);
        }
      },
    });
    this.staffRead = read;
  }

  /**
   * One raw read, uncached — the submitter list calls it directly; the staff queue goes through {@link refreshStaff}.
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
    return this.getAccessState().pipe(map((state) => state.isFormationTeam));
  }

  /**
   * Both access answers from one read (#5544): formation-team membership and LF-staff membership (the read-only Pipeline
   * view). Each fails closed to `false`, and an error answers `false` for both.
   */
  public getAccessState(): Observable<ProjectApplicationAccessState> {
    return this.http.get<ProjectApplicationAccess>(`${PROJECT_APPLICATION_API_BASE_PATH}/access`).pipe(
      map((access) => ({ isFormationTeam: access?.is_formation_team === true, isLfStaff: access?.is_lf_staff === true })),
      catchError((error: unknown) => {
        console.error('[ProjectApplicationService] Failed to load project-application access', error);
        return of({ isFormationTeam: false, isLfStaff: false });
      })
    );
  }

  /**
   * The project a proposal started from (#5187), for the formation team's "Started from" line and the accept
   * form's parent prefill, and for the propose page's "Proposing under" line. One cached read per uid
   * (`ProjectService.getProject`); resolves to `null` — never an error — for no hint, a value that is not a UUID, a
   * project the reader cannot load, or a project that is not a foundation. The BFF only checks the hint is a UUID,
   * so every consumer applies the same foundation rule the form applied when it sent it.
   */
  public getStartedFrom(targetParentUid: string | null | undefined): Observable<Project | null> {
    if (!targetParentUid || !isUuid(targetParentUid)) {
      return of(null);
    }
    return this.projectService
      .getProject(targetParentUid, false)
      .pipe(map((project) => (project && project.uid.toLowerCase() === targetParentUid.toLowerCase() && computeIsFoundation(project) ? project : null)));
  }

  /** `targetParentUid` is the foundation the applicant started from (#5187); omitted from the body when absent. */
  public create(application: ProjectApplicationAnswers, targetParentUid?: string | null): Observable<ProjectApplicationWriteResult> {
    const body: CreateProjectApplicationRequest = { application, ...(targetParentUid ? { target_parent_uid: targetParentUid } : {}) };
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

  /** Creates the project under the chosen parent with the chosen slug, then accepts (#1995). */
  public accept(application: ProjectApplication, parentProjectUid: string, projectSlug: string): Observable<ProjectApplicationWriteResult> {
    const body: AcceptProjectApplicationRequest = { parent_project_uid: parentProjectUid, project_slug: projectSlug, application: application.application };
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

  private resetForIdentityChange(): void {
    const readWasInFlight = !!this.staffRead && !this.staffRead.closed;
    this.staffRead?.unsubscribe();
    this.staffRead = null;
    this.staffFetched.set(null);
    this.staffLoadingState.set(false);
    this.staffErrorState.set(false);
    this.overlays.submitter.set([]);
    this.overlays.staff.set([]);
    this.deletions.submitter.set(new Set());
    this.deletions.staff.set(new Set());
    // Someone was waiting on the old identity's read; the new identity's view needs its own.
    if (readWasInFlight) {
      this.refreshStaff();
    }
  }

  private applicationPath(uid: string): string {
    return `${PROJECT_APPLICATION_API_BASE_PATH}/${encodeURIComponent(uid)}`;
  }

  private ifMatch(application: ProjectApplication): { headers: Record<string, string> } {
    return { headers: { 'If-Match': String(application.revision) } };
  }
}
