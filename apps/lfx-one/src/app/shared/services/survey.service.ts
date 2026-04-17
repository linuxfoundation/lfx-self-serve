// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CreateSurveyRequest, Survey } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SurveyService {
  private readonly http = inject(HttpClient);

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

  public getSurvey(surveyUid: string, projectId?: string): Observable<Survey> {
    let params = new HttpParams();
    if (projectId) {
      params = params.set('project_id', projectId);
    }

    return this.http.get<Survey>(`/api/surveys/${surveyUid}`, { params }).pipe(
      catchError((error) => {
        console.error(`Failed to load survey ${surveyUid}:`, error);
        return throwError(() => error);
      })
    );
  }

  public createSurvey(surveyData: CreateSurveyRequest): Observable<Survey> {
    return this.http.post<Survey>('/api/surveys', surveyData).pipe(take(1));
  }

  public deleteSurvey(surveyUid: string): Observable<void> {
    return this.http.delete<void>(`/api/surveys/${surveyUid}`).pipe(
      take(1),
      catchError((error) => {
        console.error(`Failed to delete survey ${surveyUid}:`, error);
        return throwError(() => error);
      })
    );
  }
}
