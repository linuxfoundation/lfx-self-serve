// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SURVEY_DETAIL_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { CreateSurveyRequest, MySurveyResponse, Survey, SurveyResponsesPage } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, shareReplay, take, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SurveyService {
  private readonly http = inject(HttpClient);
  private readonly surveyDetailCache = new Map<string, { observable: Observable<Survey>; cachedAt: number }>();

  public getSurveys(params?: HttpParams): Observable<Survey[]> {
    return this.http.get<Survey[]>('/api/surveys', { params });
  }

  /** Fetches surveys scoped to a committee via `tags=committee_uid:{uid}` query parameter. */
  public getSurveysByCommittee(committeeUid: string, orderBy?: string): Observable<Survey[]> {
    let params = new HttpParams().set('tags', `committee_uid:${committeeUid}`);

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getSurveys(params);
  }

  public getSurveysByProject(projectUid: string, orderBy?: string): Observable<Survey[]> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getSurveys(params);
  }

  /** Returns surveys for the current user; foundation/project filtering is applied client-side. */
  public getMySurveys(): Observable<Survey[]> {
    return this.http.get<Survey[]>('/api/surveys/my-surveys').pipe(catchError(() => of([])));
  }

  /** Returns the current user's submitted response for a survey, or null if none. Used by the Me lens "View My Response" drawer. */
  public getMyResponse(surveyUid: string, responseUid?: string): Observable<MySurveyResponse | null> {
    const params = responseUid ? new HttpParams().set('response_uid', responseUid) : undefined;
    return this.http.get<MySurveyResponse>(`/api/surveys/${surveyUid}/my-response`, { params }).pipe(
      catchError((error) => {
        // 404 here means "no response on file" — that's a normal empty state, not an error.
        // Log non-404s so transient backend issues surface in DevTools without breaking the drawer.
        if (error?.status !== 404) {
          console.error(`Failed to load my-response for survey ${surveyUid}:`, error);
        }
        return of(null);
      })
    );
  }

  /**
   * Survey-detail fetch with a short-TTL shared cache: the writerGuard slug probe and
   * SurveyManageComponent's edit-mode fetch need the same payload within one navigation —
   * sharing the request avoids a duplicate fetch on every edit-page load (GH-1569).
   * Probe-friendly: no signal side-effects. Entries evict on error and on delete.
   * Mirrors MailingListService.getMailingList, including the skipCache escape hatch the
   * entity-project-context fallback uses for its fresh-fetch retry.
   */
  public getSurvey(surveyUid: string, projectId?: string, options?: { skipCache?: boolean }): Observable<Survey> {
    const cacheKey = `${surveyUid}:${projectId ?? ''}`;
    const cached = this.surveyDetailCache.get(cacheKey);
    if (!options?.skipCache && cached && Date.now() - cached.cachedAt < SURVEY_DETAIL_CACHE_TTL_MS) {
      return cached.observable;
    }
    if (cached) {
      this.surveyDetailCache.delete(cacheKey);
    }

    let params = new HttpParams();
    if (projectId) {
      params = params.set('project_id', projectId);
    }

    const request$ = this.http.get<Survey>(`/api/surveys/${surveyUid}`, { params }).pipe(
      tap({ error: () => this.surveyDetailCache.delete(cacheKey) }),
      catchError((error) => {
        console.error(`Failed to load survey ${surveyUid}:`, error);
        return throwError(() => error);
      }),
      shareReplay(1)
    );
    this.pruneExpiredSurveyDetailCache();
    this.surveyDetailCache.set(cacheKey, { observable: request$, cachedAt: Date.now() });
    return request$;
  }

  /**
   * Returns a paginated page of individual per-recipient responses for a survey.
   * Used by the PMO results drawer's Responses tab. Errors degrade to an empty
   * page so the tab renders an empty state instead of breaking the drawer.
   */
  public getSurveyResponses(surveyUid: string, pageSize?: number, pageToken?: string, projectUid?: string): Observable<SurveyResponsesPage> {
    let params = new HttpParams();
    if (pageSize) {
      params = params.set('per_page', pageSize.toString());
    }
    if (pageToken) {
      params = params.set('page_token', pageToken);
    }
    if (projectUid) {
      params = params.set('project_uid', projectUid);
    }

    return this.http.get<SurveyResponsesPage>(`/api/surveys/${surveyUid}/responses`, { params }).pipe(
      catchError((error) => {
        // 404 is expected when the upstream service release is not yet deployed —
        // degrade quietly. Log unexpected statuses so real failures surface in DevTools.
        if (error?.status !== 404) {
          console.error(`Failed to load responses for survey ${surveyUid}:`, error);
        }
        return of({ data: [], meta: {} } as SurveyResponsesPage);
      })
    );
  }

  public createSurvey(surveyData: CreateSurveyRequest): Observable<Survey> {
    return this.http.post<Survey>('/api/surveys', surveyData).pipe(take(1));
  }

  public deleteSurvey(surveyUid: string): Observable<void> {
    return this.http.delete<void>(`/api/surveys/${surveyUid}`).pipe(
      take(1),
      tap(() => this.evictSurveyDetailCache(surveyUid)),
      catchError((error) => {
        console.error(`Failed to delete survey ${surveyUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  /** Drops every cached detail entry for a survey (cache keys carry the project_id variant suffix). */
  private evictSurveyDetailCache(surveyUid: string): void {
    for (const key of this.surveyDetailCache.keys()) {
      if (key.startsWith(`${surveyUid}:`)) {
        this.surveyDetailCache.delete(key);
      }
    }
  }

  private pruneExpiredSurveyDetailCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.surveyDetailCache) {
      if (now - entry.cachedAt >= SURVEY_DETAIL_CACHE_TTL_MS) {
        this.surveyDetailCache.delete(key);
      }
    }
  }
}
