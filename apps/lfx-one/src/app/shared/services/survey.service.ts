// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Survey } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of, take, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SurveyService {
  private readonly http = inject(HttpClient);

  public getSurveys(params?: HttpParams): Observable<Survey[]> {
    return this.http.get<Survey[]>('/api/surveys', { params }).pipe(
      catchError((error) => {
        console.error('Failed to load surveys:', error);
        return of([]);
      })
    );
  }

  public getSurveysByProject(projectUid: string, limit?: number, orderBy?: string): Observable<Survey[]> {
    let params = new HttpParams().set('parent', `project:${projectUid}`);

    if (limit) {
      params = params.set('limit', limit.toString());
    }

    if (orderBy) {
      params = params.set('order', orderBy);
    }

    return this.getSurveys(params);
  }

  public getSurvey(surveyUid: string): Observable<Survey> {
    return this.http.get<Survey>(`/api/surveys/${surveyUid}`).pipe(
      catchError((error) => {
        console.error(`Failed to load survey ${surveyUid}:`, error);
        return throwError(() => error);
      })
    );
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
