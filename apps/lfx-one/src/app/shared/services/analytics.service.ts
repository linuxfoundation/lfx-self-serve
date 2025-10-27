// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ActiveWeeksStreakResponse, UserCodeCommitsResponse, UserProjectsResponse, UserPullRequestsResponse } from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

/**
 * Analytics service for fetching analytics data from Snowflake
 * Provides dashboard metrics and visualizations
 */
@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  /**
   * Get active weeks streak data for the current user
   * @returns Observable of active weeks streak response
   */
  public getActiveWeeksStreak(): Observable<ActiveWeeksStreakResponse> {
    return this.http.get<ActiveWeeksStreakResponse>('/api/analytics/active-weeks-streak').pipe(
      catchError((error) => {
        console.error('Failed to fetch active weeks streak:', error);
        return of({
          data: [],
          currentStreak: 0,
          totalWeeks: 0,
        });
      })
    );
  }

  /**
   * Get pull requests merged data for the current user
   * @returns Observable of pull requests merged response
   */
  public getPullRequestsMerged(): Observable<UserPullRequestsResponse> {
    return this.http.get<UserPullRequestsResponse>('/api/analytics/pull-requests-merged').pipe(
      catchError((error) => {
        console.error('Failed to fetch pull requests merged:', error);
        return of({
          data: [],
          totalPullRequests: 0,
          totalDays: 0,
        });
      })
    );
  }

  /**
   * Get code commits data for the current user
   * @returns Observable of code commits response
   */
  public getCodeCommits(): Observable<UserCodeCommitsResponse> {
    return this.http.get<UserCodeCommitsResponse>('/api/analytics/code-commits').pipe(
      catchError((error) => {
        console.error('Failed to fetch code commits:', error);
        return of({
          data: [],
          totalCommits: 0,
          totalDays: 0,
        });
      })
    );
  }

  /**
   * Get user's projects with activity data
   * @param page - Page number (1-based)
   * @param limit - Number of projects per page
   * @returns Observable of user projects response
   */
  public getMyProjects(page: number = 1, limit: number = 10): Observable<UserProjectsResponse> {
    const params = { page: page.toString(), limit: limit.toString() };
    return this.http.get<UserProjectsResponse>('/api/analytics/my-projects', { params }).pipe(
      catchError((error) => {
        console.error('Failed to fetch my projects:', error);
        return of({
          data: [],
          totalProjects: 0,
        });
      })
    );
  }
}
