// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { WRITER_SUMMARY_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { CreateProjectDocumentRequest, PendingActionItem, Project, ProjectDocument, WriterSummary } from '@lfx-one/shared/interfaces';
import { BehaviorSubject, catchError, map, Observable, of, shareReplay, take, tap, timeout } from 'rxjs';

import { retryTransientHttpError } from '@shared/utils/http-error.utils';

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
      // shareReplay(1) pins whatever lands here for the rest of the session — every caller shares
      // this cache key. One retry, transient errors only (isTransientHttpError), so a
      // session-expiry/permission 4xx fails fast instead of doubling the wait before the
      // fallback. On failure, evict the key rather than caching `[]`: the retry only lowers how
      // often a stuck cache happens, it can't rule it out.
      const projects$ = this.http.get<Project[]>('/api/projects', { params }).pipe(
        retryTransientHttpError(),
        catchError((error) => {
          console.error('Failed to fetch projects:', error);
          this.projectsCache.delete(cacheKey);
          return of([]);
        }),
        shareReplay(1)
      );
      this.projectsCache.set(cacheKey, projects$);
    }
    return this.projectsCache.get(cacheKey)!;
  }

  /**
   * Fail-closed on error, mirroring getProjects. One retry, transient errors only — this is the
   * bootstrap-critical fast path (LFXV2-2857), so a bare blip shouldn't leave the caller's lens
   * set narrowed until the (much slower) deferred sweep eventually resolves it instead.
   *
   * `timeout()` sits downstream of `retryTransientHttpError()` in the pipe, so the attempt, the
   * retry delay, and the retried attempt all share one `WRITER_SUMMARY_TIMEOUT_MS` budget rather
   * than each attempt getting its own — a transient failure followed by a stalled retry still
   * fails closed at that one bound, instead of running up to roughly twice it. `WriterGrantsService`
   * only schedules its deferred sweep once this call settles, so that bound matters: an unbounded
   * hang here would silently starve the sweep — the recovery path for a stalled fast path — for
   * the whole session.
   */
  public getWriterSummary(): Observable<WriterSummary> {
    return this.http.get<WriterSummary>('/api/projects/writer-summary').pipe(
      retryTransientHttpError(),
      timeout(WRITER_SUMMARY_TIMEOUT_MS),
      catchError((error) => {
        console.error('Failed to fetch writer summary:', error);
        return of({ hasWriterFoundation: false, hasWriterProject: false });
      })
    );
  }

  /**
   * Fetches a project by slug OR uid — the BFF `GET /api/projects/:slug` route sniffs UUIDs and
   * resolves them via getProjectById, so callers holding either identifier can use this method.
   * Note the two identifiers cache under separate keys for the same project.
   */
  public getProject(slugOrUid: string, current: boolean = true, options?: { meetingCoordinator?: boolean }): Observable<Project | null> {
    const cacheKey = `${slugOrUid}:${current}${options?.meetingCoordinator ? ':mc' : ''}`;
    if (!this.projectCache.has(cacheKey)) {
      const params = options?.meetingCoordinator ? new HttpParams().set('meeting_coordinator', 'true') : undefined;
      const project$ = this.http.get<Project>(`/api/projects/${slugOrUid}`, { params }).pipe(
        catchError((error) => {
          console.error('Failed to fetch project:', error);
          return of(null);
        }),
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

  /**
   * Slug lookup that propagates HTTP failures instead of mapping them to null,
   * for callers that must distinguish a missing project (400/404) from an
   * upstream outage (5xx) — e.g. the newsletter reader's SSR 404 signaling.
   * Uncached and side-effect free (does not touch the active-project state).
   */
  public getProjectStrict(slug: string): Observable<Project> {
    return this.http.get<Project>(`/api/projects/${encodeURIComponent(slug)}`);
  }

  public getProjectSfid(uid: string): Observable<string | null> {
    return this.http.get<{ sfid: string | null }>(`/api/projects/${encodeURIComponent(uid)}/sfid`).pipe(
      map((res) => res.sfid ?? null),
      catchError((error) => {
        console.error('Failed to fetch project sfid:', error);
        return of(null);
      })
    );
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

  // ── Project Documents ─────────────────────────────────────────────────────

  public getProjectDocuments(projectUid: string): Observable<ProjectDocument[]> {
    return this.http.get<ProjectDocument[]>(`/api/projects/${projectUid}/documents`).pipe(
      catchError((error) => {
        console.error('Failed to fetch project documents:', error);
        return of([]);
      })
    );
  }

  public createProjectDocument(projectUid: string, data: CreateProjectDocumentRequest): Observable<ProjectDocument> {
    return this.http.post<ProjectDocument>(`/api/projects/${projectUid}/documents`, data).pipe(take(1));
  }

  /**
   * Uploads a file document to a project. Sends the raw file as the request body
   * with metadata as query params. The BFF forwards as multipart/form-data to the
   * upstream project service.
   */
  public uploadProjectDocument(
    projectUid: string,
    file: File,
    metadata: { name: string; description?: string; folder_uid?: string }
  ): Observable<ProjectDocument> {
    let params = new HttpParams()
      .set('name', metadata.name)
      .set('file_name', file.name)
      .set('content_type', file.type || 'application/octet-stream')
      .set('file_size', file.size.toString());

    if (metadata.description) {
      params = params.set('description', metadata.description);
    }
    if (metadata.folder_uid) {
      params = params.set('folder_uid', metadata.folder_uid);
    }

    return this.http
      .post<ProjectDocument>(`/api/projects/${projectUid}/documents/upload`, file, {
        headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
        params,
      })
      .pipe(take(1));
  }

  /**
   * Deletes a project folder or link. Files are not deletable via this endpoint
   * — the BFF only accepts `'folder'` and `'link'` for the `type` parameter.
   */
  public deleteProjectDocument(projectUid: string, documentId: string, documentType: 'folder' | 'link'): Observable<void> {
    const params = new HttpParams().set('type', documentType);
    return this.http.delete<void>(`/api/projects/${projectUid}/documents/${documentId}`, { params }).pipe(take(1));
  }
}
