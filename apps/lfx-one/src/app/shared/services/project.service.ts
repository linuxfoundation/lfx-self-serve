// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { PendingActionItem, Project } from '@lfx-one/shared/interfaces';
import { BehaviorSubject, catchError, Observable, of, shareReplay, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  public project: WritableSignal<Project | null> = signal(null);
  public project$: BehaviorSubject<Project | null> = new BehaviorSubject<Project | null>(null);

  private readonly http = inject(HttpClient);
  private readonly projectCache = new Map<string, Observable<Project | null>>();
  private readonly projectsCache = new Map<string, Observable<Project[]>>();

  public getProjects(params?: HttpParams): Observable<Project[]> {
    const cacheKey = params?.toString() || '';
    if (!this.projectsCache.has(cacheKey)) {
      const projects$ = this.http.get<Project[]>('/api/projects', { params }).pipe(
        catchError(() => of([])),
        shareReplay(1)
      );
      this.projectsCache.set(cacheKey, projects$);
    }
    return this.projectsCache.get(cacheKey)!;
  }

  public getProject(slug: string, current: boolean = true): Observable<Project | null> {
    const cacheKey = `${slug}:${current}`;
    if (!this.projectCache.has(cacheKey)) {
      const project$ = this.http.get<Project>(`/api/projects/${slug}`).pipe(
        catchError(() => of(null)),
        shareReplay(1),
        tap((project) => {
          if (current) {
            this.project$.next(project);
            this.project.set(project);
          }
        })
      );
      this.projectCache.set(cacheKey, project$);
    }
    return this.projectCache.get(cacheKey)!;
  }

  public searchProjects(query: string): Observable<Project[]> {
    const params = new HttpParams().set('q', query);

    return this.http.get<Project[]>('/api/projects/search', { params }).pipe(
      catchError((error) => {
        console.error('Failed to search projects:', error);
        return of([]);
      })
    );
  }

  /**
   * Get pending action surveys for the current user
   * @param projectSlug - Project slug to filter surveys
   * @returns Observable of pending action items with survey links
   */
  public getPendingActionSurveys(projectSlug: string): Observable<PendingActionItem[]> {
    const params = new HttpParams().set('projectSlug', projectSlug);

    return this.http.get<PendingActionItem[]>('/api/projects/pending-action-surveys', { params }).pipe(
      catchError((error) => {
        console.error('Failed to fetch pending action surveys:', error);
        return of([]);
      })
    );
  }

  /**
   * Get all pending actions (surveys + meetings + votes + RSVPs) for the current user.
   * Omit all arguments to run unscoped across all of the user's FGA grants (Me-lens — one
   * request instead of N project-scoped fan-outs). Provide `projectSlug` and `projectUid` to
   * scope to a single project (project/foundation-lens dashboards).
   * @param projectSlug - Optional project slug for survey filtering
   * @param projectUid - Optional project UID for meeting/vote filtering
   * @param persona - Optional persona for telemetry (no longer drives behavior)
   * @returns Observable of pending action items
   */
  public getPendingActions(projectSlug?: string, projectUid?: string, persona?: string): Observable<PendingActionItem[]> {
    let params = new HttpParams();
    if (projectSlug) params = params.set('projectSlug', projectSlug);
    if (projectUid) params = params.set('projectUid', projectUid);
    if (persona) params = params.set('persona', persona);

    return this.http.get<PendingActionItem[]>('/api/user/pending-actions', { params }).pipe(
      catchError((error) => {
        console.error('Failed to fetch pending actions:', error);
        return of([]);
      })
    );
  }
}
